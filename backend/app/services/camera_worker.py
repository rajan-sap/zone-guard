"""
Camera worker — reads frames from an RTSP/HLS stream and runs detection
at DETECTION_FPS.  Alerts are fired for confirmed live humans inside red zones.

Pipeline per frame
-------------------
  Stage A  YOLOv10 → person bboxes
  Stage B  Motion-vector analysis → live / static / no-verdict
  Zone check → if centroid inside active zone → create Incident + broadcast
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime
from typing import Dict

import cv2

from app.core.config import settings
from app.db.models import Incident
from app.db.session import AsyncSessionLocal
from app.services.detector import detector
from app.services.websocket_manager import manager
from app.services.zone_evaluator import point_in_zone
from sqlmodel import select

# camera_id -> last incident timestamp (for cooldown dedup)
_last_incident: Dict[str, float] = {}
COOLDOWN_SECONDS = 10


async def run_camera(camera_id: str, stream_url: str):
    """Main loop for a single camera — runs detection at DETECTION_FPS."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _blocking_camera_loop, camera_id, stream_url)


def _blocking_camera_loop(camera_id: str, stream_url: str):
    cap = cv2.VideoCapture(stream_url)
    interval = 1.0 / settings.DETECTION_FPS

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(1)
            # Reset per-camera pipeline state on reconnect so stale LK
            # points and liveness history don't pollute the new stream.
            detector.reset_camera(camera_id)
            cap = cv2.VideoCapture(stream_url)
            continue

        t0 = time.time()
        detections = detector.detect(camera_id, frame)

        if detections:
            asyncio.run(_handle_detections(camera_id, frame, detections))

        elapsed = time.time() - t0
        time.sleep(max(0, interval - elapsed))

    cap.release()


async def _handle_detections(camera_id: str, frame, detections):
    async with AsyncSessionLocal() as session:
        # Load active zones for this camera
        from app.db.models import Zone
        result = await session.execute(
            select(Zone).where(Zone.camera_id == camera_id, Zone.is_active == True)
        )
        zones = result.scalars().all()

        for det in detections:
            for zone in zones:
                if not point_in_zone(det.bbox_x, det.bbox_y, zone.polygon_points):
                    continue

                now = time.time()
                key = f"{camera_id}:{zone.id}"
                if now - _last_incident.get(key, 0) < COOLDOWN_SECONDS:
                    continue
                _last_incident[key] = now

                # Save snapshot
                snapshot_path = _save_snapshot(frame, camera_id)

                incident = Incident(
                    camera_id=camera_id,
                    zone_id=zone.id,
                    confidence=det.confidence,
                    snapshot_path=snapshot_path,
                    bbox_x=det.bbox_x,
                    bbox_y=det.bbox_y,
                    bbox_w=det.bbox_w,
                    bbox_h=det.bbox_h,
                )
                session.add(incident)
                await session.commit()
                await session.refresh(incident)

                # Broadcast via WebSocket
                await manager.broadcast({
                    "event": "incident",
                    "incident_id": incident.id,
                    "camera_id": camera_id,
                    "zone_id": zone.id,
                    "confidence": det.confidence,
                    "snapshot_path": snapshot_path,
                    "created_at": incident.created_at.isoformat(),
                })


def _save_snapshot(frame, camera_id: str) -> str:
    os.makedirs(settings.SNAPSHOT_DIR, exist_ok=True)
    filename = f"{camera_id}_{uuid.uuid4().hex}.jpg"
    path = os.path.join(settings.SNAPSHOT_DIR, filename)
    cv2.imwrite(path, frame)
    return path
