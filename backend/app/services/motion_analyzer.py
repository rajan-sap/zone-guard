"""
Motion-vector liveness analyzer.

Algorithm per person bbox
--------------------------
1. Detect Shi-Tomasi corner features inside the bbox (previous frame)
2. Track them with Lucas-Kanade optical flow (current frame)
3. Subtract global camera motion (median background flow) so that a
   photo on a shaking camera still reads ≈ 0
4. Analyze the compensated per-point motion vectors on three axes:

   Metric              Formula                     Static        Live
   ─────────────────── ─────────────────────────── ────────────  ─────────────
   Mean magnitude      mean(||v_i||)               ≈ 0 px/frame  ≥ threshold
   Magnitude variance  var(||v_i||)                ≈ 0           > 0 (body
                        body parts move at                        parts move
                        different speeds;                         unevenly)
                        uniform video = 0
   Direction diversity 1 − |mean(e^{iθ_i})|        ≈ 0 (all      > 0.3
                        organic motion vectors      same dir)     (varied)
                        point in varied directions

Decision
--------
  False  — mean_mag < MAG_THRESHOLD × 0.25   → clearly static, skip
  True   — mean_mag ≥ MAG_THRESHOLD AND
            (variance ≥ VAR_THRESHOLD OR diversity ≥ DIV_THRESHOLD) → live
  None   — first frame (no previous data) or too few tracked points → no verdict

Only True detections are passed to zone evaluation and alert creation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from app.core.config import settings

# Lucas-Kanade tracking parameters
_LK_PARAMS = dict(
    winSize=(15, 15),
    maxLevel=2,
    criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
)

# Corner detection inside person bbox
_CORNER_PARAMS = dict(
    maxCorners=40,
    qualityLevel=0.2,
    minDistance=7,
    blockSize=7,
)

# Corner detection in background (for camera motion estimation)
_BG_CORNER_PARAMS = dict(
    maxCorners=60,
    qualityLevel=0.1,
    minDistance=10,
    blockSize=7,
)


@dataclass
class _FrameBuffer:
    prev_gray: np.ndarray
    bg_pts: Optional[np.ndarray]   # background corner points from prev frame


class MotionAnalyzer:
    """
    Per-camera motion analysis using Lucas-Kanade optical flow.
    One shared instance; state is keyed by camera_id.
    """

    def __init__(self) -> None:
        self._bufs: Dict[str, _FrameBuffer] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def is_live(
        self,
        camera_id: str,
        gray: np.ndarray,
        bbox_pixel: Tuple[int, int, int, int],
    ) -> Optional[bool]:
        """
        Analyze motion inside *bbox_pixel* between the previous and current frame.

        Parameters
        ----------
        camera_id   : per-camera state key
        gray        : current frame (single-channel uint8)
        bbox_pixel  : (x1, y1, x2, y2) person bounding box in pixels

        Returns
        -------
        True   — motion above thresholds → live human
        False  — near-zero motion → static object (photo / screen / mannequin)
        None   — first frame or insufficient tracked points → no verdict
        """
        buf = self._bufs.get(camera_id)

        if buf is None:
            # First ever frame — store and return no verdict
            self._store(camera_id, gray, [bbox_pixel])
            return None

        # ── Step 1: estimate camera (global) motion ───────────────────
        cam_dx, cam_dy = self._camera_motion(buf.prev_gray, gray, buf.bg_pts)

        # ── Step 2: track feature points inside bbox ──────────────────
        h, w = gray.shape[:2]
        x1 = max(0, bbox_pixel[0])
        y1 = max(0, bbox_pixel[1])
        x2 = min(w, bbox_pixel[2])
        y2 = min(h, bbox_pixel[3])

        if (x2 - x1) < 20 or (y2 - y1) < 20:
            self._store(camera_id, gray, [bbox_pixel])
            return None

        roi_mask = np.zeros_like(gray)
        roi_mask[y1:y2, x1:x2] = 255

        pts = cv2.goodFeaturesToTrack(buf.prev_gray, mask=roi_mask, **_CORNER_PARAMS)

        if pts is None or len(pts) < settings.MOTION_MIN_VECTORS:
            self._store(camera_id, gray, [bbox_pixel])
            return None

        next_pts, status, _ = cv2.calcOpticalFlowPyrLK(
            buf.prev_gray, gray, pts, None, **_LK_PARAMS
        )

        ok = status.ravel().astype(bool)
        good_new = next_pts.reshape(-1, 2)[ok]
        good_old = pts.reshape(-1, 2)[ok]

        if len(good_new) < settings.MOTION_MIN_VECTORS:
            self._store(camera_id, gray, [bbox_pixel])
            return None

        # ── Step 3: subtract camera motion (egomotion compensation) ──
        flow = (good_new - good_old).astype(np.float32)
        flow[:, 0] -= cam_dx
        flow[:, 1] -= cam_dy

        # ── Step 4: compute motion metrics ───────────────────────────
        mags = np.linalg.norm(flow, axis=1)
        mean_mag      = float(np.mean(mags))
        mag_variance  = float(np.var(mags))

        # Direction diversity: 0 = all vectors same direction (shake / video pan)
        #                       1 = completely random directions (organic motion)
        angles    = np.arctan2(flow[:, 1], flow[:, 0]).astype(np.float64)
        mean_unit = np.mean(np.exp(1j * angles))
        diversity = 1.0 - float(abs(mean_unit))

        self._store(camera_id, gray, [bbox_pixel])

        # ── Step 5: decision ──────────────────────────────────────────
        # Static — magnitude near zero regardless of other metrics
        if mean_mag < settings.MOTION_MAGNITUDE_THRESHOLD * 0.25:
            return False

        # Live — meaningful magnitude AND non-uniform OR diverse motion
        if (
            mean_mag >= settings.MOTION_MAGNITUDE_THRESHOLD
            and (
                mag_variance >= settings.MOTION_VARIANCE_THRESHOLD
                or diversity  >= settings.MOTION_DIVERSITY_THRESHOLD
            )
        ):
            return True

        # Ambiguous frame — not enough signal either way
        return None

    def reset(self, camera_id: str) -> None:
        """Drop stored state for a camera (call on stream reconnect)."""
        self._bufs.pop(camera_id, None)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _store(
        self,
        camera_id: str,
        gray: np.ndarray,
        bboxes: List[Tuple[int, int, int, int]],
    ) -> None:
        bg_pts = self._sample_bg(gray, bboxes)
        self._bufs[camera_id] = _FrameBuffer(prev_gray=gray.copy(), bg_pts=bg_pts)

    @staticmethod
    def _camera_motion(
        prev: np.ndarray,
        curr: np.ndarray,
        bg_pts: Optional[np.ndarray],
    ) -> Tuple[float, float]:
        """Estimate global camera motion as median background optical flow."""
        if bg_pts is None or len(bg_pts) < 4:
            return 0.0, 0.0

        nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, curr, bg_pts, None, **_LK_PARAMS)
        ok = st.ravel().astype(bool)
        if ok.sum() < 4:
            return 0.0, 0.0

        flow = nxt.reshape(-1, 2)[ok] - bg_pts.reshape(-1, 2)[ok]
        return float(np.median(flow[:, 0])), float(np.median(flow[:, 1]))

    @staticmethod
    def _sample_bg(
        gray: np.ndarray,
        bboxes: List[Tuple[int, int, int, int]],
    ) -> Optional[np.ndarray]:
        """Sample Shi-Tomasi corners from everything OUTSIDE all bboxes."""
        mask = np.ones_like(gray, dtype=np.uint8) * 255
        h, w = gray.shape[:2]
        for x1, y1, x2, y2 in bboxes:
            mask[max(0, y1):min(h, y2), max(0, x1):min(w, x2)] = 0
        return cv2.goodFeaturesToTrack(gray, mask=mask, **_BG_CORNER_PARAMS)
