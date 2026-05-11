from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlmodel import select

from app.api.routes import cameras, incidents, zones, alerts, detect
from app.core.config import settings
from app.db.session import create_db_and_tables, AsyncSessionLocal
from app.db.models import Camera

SEED_CAMERAS = [
    {"id": "cam-001", "name": "Camera 1", "location": "Deck 1",      "stream_url": "rtsp://localhost/cam1"},
    {"id": "cam-002", "name": "Camera 2", "location": "Unload Deck", "stream_url": "rtsp://localhost/cam2"},
    {"id": "cam-003", "name": "Camera 3", "location": "Engine Room", "stream_url": "rtsp://localhost/cam3"},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_db_and_tables()
    async with AsyncSessionLocal() as session:
        for seed in SEED_CAMERAS:
            existing = await session.get(Camera, seed["id"])
            if not existing:
                session.add(Camera(**seed))
        await session.commit()
    yield


app = FastAPI(
    title="Safety-First API",
    description="Red-Zone Human Detection & Alert System",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cameras.router, prefix="/api/cameras", tags=["cameras"])
app.include_router(incidents.router, prefix="/api/incidents", tags=["incidents"])
app.include_router(zones.router, prefix="/api/zones", tags=["zones"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(detect.router, prefix="/api/detect", tags=["detect"])


@app.get("/health")
async def health():
    return {"status": "ok"}
