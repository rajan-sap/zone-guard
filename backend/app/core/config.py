from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./safety_first.db"

    # CORS
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # YOLO detection (Stage A)
    YOLO_MODEL_PATH: str = "weights/yolov10m.pt"
    YOLO_CONFIDENCE_THRESHOLD: float = 0.65
    DETECTION_FPS: int = 10

    # Motion-vector liveness (Stage B)
    # ─────────────────────────────────────────────────────────────────
    # Mean magnitude of egomotion-compensated LK flow vectors (px/frame)
    # Static photo / screen with no motion : 0.0 – 0.3
    # Screen playing video                 : 0.3 – 1.0  (uniform motion)
    # Real person standing still           : 1.5 – 3.0  (breathing, micro-sway)
    # Real person walking                  : 3.0+
    MOTION_MAGNITUDE_THRESHOLD: float = 1.5

    # Variance of per-vector magnitudes (body parts move at different speeds)
    # Uniform video / rigid object : ≈ 0.0
    # Real person                  : > 0.8
    MOTION_VARIANCE_THRESHOLD: float = 0.8

    # Direction diversity = 1 − |mean unit vector|  (0 = coherent, 1 = random)
    # Camera shake / uniform video pan : ≈ 0.0 – 0.2
    # Organic human motion             : > 0.3
    MOTION_DIVERSITY_THRESHOLD: float = 0.3

    # Minimum number of LK-tracked points inside bbox to issue a verdict
    MOTION_MIN_VECTORS: int = 10

    # Storage
    SNAPSHOT_DIR: str = "snapshots"

    # Alerts (optional — set in .env for real deployment)
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
