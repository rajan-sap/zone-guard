"""Video capture abstraction for RTSP streams and video files."""

from __future__ import annotations

import logging
import time
from collections import deque
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class VideoCapture:
    """Wrapper around cv2.VideoCapture with reconnection logic."""

    def __init__(
        self,
        source: str | int,
        name: str = "camera",
        max_retries: int = 5,
        initial_backoff: float = 1.0,
        buffer_size: int = 2,
    ):
        self.source = source
        self.name = name
        self.max_retries = max_retries
        self.initial_backoff = initial_backoff
        self.buffer_size = buffer_size

        self._cap: cv2.VideoCapture | None = None
        self._frame_buffer: deque[bytes] = deque(maxlen=buffer_size)
        self._connected = False
        self._retry_count = 0
        self._last_frame_time: float = 0

        self.connect()

    def connect(self) -> bool:
        """Connect to video source with exponential backoff."""
        if self._cap is not None and self._cap.isOpened():
            return True

        for attempt in range(self.max_retries):
            try:
                self._cap = cv2.VideoCapture(self.source)
                if self._cap.isOpened():
                    self._connected = True
                    self._retry_count = 0
                    logger.info(f"Connected to {self.name}: {self.source}")
                    return True
            except Exception as e:
                logger.warning(f"Connection attempt {attempt + 1} failed for {self.name}: {e}")

            backoff = self.initial_backoff * (2**attempt)
            time.sleep(backoff)

        self._connected = False
        logger.error(f"Failed to connect to {self.name} after {self.max_retries} attempts")
        return False

    def read(self) -> tuple[bool, np.ndarray | None]:
        """Read a frame from the video source."""
        if not self._connected:
            if not self.connect():
                return False, None

        ret, frame = self._cap.read()  # type: ignore[union-attr]

        if ret:
            self._last_frame_time = time.time()
            self._frame_buffer.append(cv2.imencode(".jpg", frame)[1].tobytes())
            return True, frame
        else:
            logger.warning(f"Failed to read frame from {self.name}")
            self._connected = False
            return False, None

    def reconnect(self) -> bool:
        """Force reconnection to the video source."""
        if self._cap is not None:
            self._cap.release()
        self._retry_count += 1
        return self.connect()

    @property
    def connected(self) -> bool:
        """Check if camera is connected."""
        return self._connected

    @property
    def buffered_frames(self) -> int:
        """Number of frames in buffer."""
        return len(self._frame_buffer)

    def get(self, prop: int) -> float:
        """Get video property."""
        if self._cap is not None and self._cap.isOpened():
            return self._cap.get(prop)
        return 0.0

    def release(self) -> None:
        """Release video capture."""
        if self._cap is not None:
            self._cap.release()
            self._connected = False

    def __enter__(self) -> "VideoCapture":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release()


class VideoCaptureManager:
    """Manager for multiple video captures."""

    def __init__(self):
        self._captures: dict[str, VideoCapture] = {}
        self._status: dict[str, str] = {}

    def add_camera(self, name: str, source: str | int, **kwargs: Any) -> VideoCapture:
        """Add a camera to the manager."""
        cap = VideoCapture(source, name, **kwargs)
        self._captures[name] = cap
        self._status[name] = "connected" if cap.connected else "disconnected"
        return cap

    def get_capture(self, name: str) -> VideoCapture | None:
        """Get a capture by name."""
        return self._captures.get(name)

    def get_all_status(self) -> dict[str, str]:
        """Get status of all cameras."""
        return {
            name: "connected" if cap.connected else "disconnected"
            for name, cap in self._captures.items()
        }

    def read_all(self) -> dict[str, tuple[bool, np.ndarray | None]]:
        """Read from all cameras."""
        results = {}
        for name, cap in self._captures.items():
            ret, frame = cap.read()
            results[name] = (ret, frame)
            self._status[name] = "connected" if ret else "disconnected"
        return results

    def release_all(self) -> None:
        """Release all captures."""
        for cap in self._captures.values():
            cap.release()

    def __enter__(self) -> "VideoCaptureManager":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release_all()