import uuid
from datetime import datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


class Camera(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    name: str
    stream_url: str
    location: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    zones: List["Zone"] = Relationship(back_populates="camera")
    incidents: List["Incident"] = Relationship(back_populates="camera")


class Zone(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    camera_id: str = Field(foreign_key="camera.id")
    name: str
    # JSON-encoded list of [x, y] polygon points (normalized 0–1)
    polygon_points: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    camera: Optional[Camera] = Relationship(back_populates="zones")


class Incident(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    camera_id: str = Field(foreign_key="camera.id")
    zone_id: Optional[str] = Field(default=None, foreign_key="zone.id")
    status: str = Field(default="OPEN")  # OPEN | ACKNOWLEDGED | RESOLVED | FALSE_POSITIVE
    confidence: float
    snapshot_path: Optional[str] = None
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    camera: Optional[Camera] = Relationship(back_populates="incidents")
