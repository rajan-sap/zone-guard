"""Configuration management using YAML files."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


def load_yaml(config_path: Path) -> dict[str, Any]:
    """Load YAML configuration file."""
    with open(config_path, "r") as f:
        return yaml.safe_load(f) or {}


class CameraConfig(BaseModel):
    """Camera configuration."""

    name: str
    url: str
    enabled: bool = True
    width: int | None = None
    height: int | None = None
    fps: int = 30


class ZoneConfig(BaseModel):
    """Zone configuration."""

    name: str
    camera: str
    polygon: list[tuple[float, float]]
    enabled: bool = True


class AlertConfig(BaseModel):
    """Alert configuration."""

    name: str
    type: str = "webhook"
    url: str | None = None
    topic: str | None = None
    enabled: bool = True
    cooldown_seconds: int = 60


class DetectionConfig(BaseModel):
    """Detection configuration."""

    model_path: str = "yolov8n.pt"
    confidence_threshold: float = 0.5
    iou_threshold: float = 0.45
    device: str = "cpu"


class SystemConfig(BaseModel):
    """System configuration."""

    storage_dir: str = "./storage"
    save_video_clips: bool = True
    clip_duration_seconds: float = 10.0
    fps: int = 30


class Config(BaseModel):
    """Main configuration."""

    cameras: list[CameraConfig] = Field(default_factory=list)
    zones: list[ZoneConfig] = Field(default_factory=list)
    alerts: list[AlertConfig] = Field(default_factory=list)
    detection: DetectionConfig = Field(default_factory=DetectionConfig)
    system: SystemConfig = Field(default_factory=SystemConfig)

    @classmethod
    def from_yaml(cls, config_dir: Path = Path("config")) -> Config:
        """Load configuration from YAML files."""
        config = cls()

        cameras_path = config_dir / "cameras.yaml"
        if cameras_path.exists():
            data = load_yaml(cameras_path)
            config.cameras = [CameraConfig(**c) for c in data.get("cameras", [])]
            logger.info(f"Loaded {len(config.cameras)} camera(s)")

        zones_path = config_dir / "zones.yaml"
        if zones_path.exists():
            data = load_yaml(zones_path)
            config.zones = [ZoneConfig(**z) for z in data.get("zones", [])]
            logger.info(f"Loaded {len(config.zones)} zone(s)")

        alerts_path = config_dir / "alerts.yaml"
        if alerts_path.exists():
            data = load_yaml(alerts_path)
            config.alerts = [AlertConfig(**a) for a in data.get("alerts", [])]
            logger.info(f"Loaded {len(config.alerts)} alert config(s)")

        detection_path = config_dir / "detection.yaml"
        if detection_path.exists():
            data = load_yaml(detection_path)
            config.detection = DetectionConfig(**data)
        else:
            logger.info("Using default detection configuration")

        system_path = config_dir / "system.yaml"
        if system_path.exists():
            data = load_yaml(system_path)
            config.system = SystemConfig(**data)

        return config