"""
ZoneGuard detection pipeline.

1. YOLOv10 detects person bounding boxes
2. For each bbox, crop and track feature points with Lucas-Kanade optical flow
3. Subtract global camera motion so static objects on a moving camera read ~= 0
4. Analyze compensated motion vectors:
     magnitude       -- is anything moving?
     variance        -- do different body parts move at different speeds?
     direction diversity -- is the motion organic (varied angles) vs uniform?
5. Live human  -> magnitude >= threshold AND (variance OR diversity above threshold)
   Static object -> magnitude ~= 0  -> skip
   No verdict yet -> first frame or too few tracked points -> skip
6. Confirmed live detections are returned for red-zone evaluation
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

import cv2
import numpy as np

from app.core.config import settings
from app.services.motion_analyzer import MotionAnalyzer


@dataclass
class Detection:
    confidence: float
    bbox_x: float    # normalised centre-x  (0-1)
    bbox_y: float    # normalised centre-y  (0-1)
    bbox_w: float    # normalised width     (0-1)
    bbox_h: float    # normalised height    (0-1)


class ZoneGuardDetector:
    """Runs the detection pipeline.  One singleton shared across all cameras."""

    PERSON_CLASS = 0

    def __init__(self) -> None:
        self._model = None
        self._motion = MotionAnalyzer()

    def load(self) -> None:
        """Eagerly load the YOLO model (called once at startup)."""
        from ultralytics import YOLO
        self._model = YOLO(settings.YOLO_MODEL_PATH)

    def detect(self, camera_id: str, frame: np.ndarray) -> List[Detection]:
        """
        Run the full pipeline on one BGR frame.
        Returns only confirmed live detections.
        """
        if self._model is None:
            self.load()

        h, w = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Stage A: YOLO person detection
        raw = self._model(frame, verbose=False)[0]

        detections: List[Detection] = []
        for box in raw.boxes:
            if int(box.cls[0]) != self.PERSON_CLASS:
                continue
            conf = float(box.conf[0])
            if conf < settings.YOLO_CONFIDENCE_THRESHOLD:
                continue

            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]

            # Stage B: motion-vector liveness
            # True  -> live human (magnitude + variance/diversity above thresholds)
            # False -> static object (near-zero motion) -> skip
            # None  -> first frame or too few corners -> skip (conservative)
            if self._motion.is_live(camera_id, gray, (x1, y1, x2, y2)) is not True:
                continue

            detections.append(Detection(
                confidence=conf,
                bbox_x=(x1 + x2) / 2 / w,
                bbox_y=(y1 + y2) / 2 / h,
                bbox_w=(x2 - x1) / w,
                bbox_h=(y2 - y1) / h,
            ))

        return detections

    def detect_persons(self, frame: np.ndarray) -> List[Detection]:
        """Shim for /api/detect -- single frame, no persistent state."""
        return self.detect("__manual__", frame)

    def reset_camera(self, camera_id: str) -> None:
        """Drop per-camera state (call on stream reconnect)."""
        self._motion.reset(camera_id)


# Singleton -- imported by camera_worker and detect route
detector = ZoneGuardDetector()
