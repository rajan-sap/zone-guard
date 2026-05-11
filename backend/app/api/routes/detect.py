import base64
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel
import numpy as np
import cv2

from app.services.detector import detector
from app.services.zone_evaluator import point_in_zone
from app.db.session import AsyncSessionLocal
from app.db.models import Zone, Incident
from sqlmodel import select

router = APIRouter()


class FrameRequest(BaseModel):
    # base64-encoded JPEG/PNG (data URL prefix stripped)
    frame: str
    camera_id: str = "device"


class BBox(BaseModel):
    cx: float
    cy: float
    w: float
    h: float
    confidence: float
    in_zone: bool
    zone_id: str | None = None


class FrameResponse(BaseModel):
    detections: List[BBox]
    violation: bool


@router.post("/frame", response_model=FrameResponse)
async def detect_frame(req: FrameRequest):
    # Decode base64 → numpy BGR frame
    img_bytes = base64.b64decode(req.frame)
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if frame is None:
        return FrameResponse(detections=[], violation=False)

    raw = detector.detect_persons(frame)

    # Load zones for this camera_id
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Zone).where(Zone.camera_id == req.camera_id, Zone.is_active == True)
        )
        zones = result.scalars().all()

    bboxes: List[BBox] = []
    violation = False

    for det in raw:
        matched_zone = None
        for zone in zones:
            if point_in_zone(det.bbox_x, det.bbox_y, zone.polygon_points):
                matched_zone = zone
                violation = True
                break

        bboxes.append(BBox(
            cx=det.bbox_x,
            cy=det.bbox_y,
            w=det.bbox_w,
            h=det.bbox_h,
            confidence=det.confidence,
            in_zone=matched_zone is not None,
            zone_id=matched_zone.id if matched_zone else None,
        ))

    return FrameResponse(detections=bboxes, violation=violation)
