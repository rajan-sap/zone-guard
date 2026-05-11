import asyncio
import base64

import cv2
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import List, Optional
from pydantic import BaseModel

from app.db.session import get_session
from app.db.models import Camera

router = APIRouter()


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    stream_url: Optional[str] = None
    location: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/", response_model=List[Camera])
async def list_cameras(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Camera))
    return result.scalars().all()


@router.post("/", response_model=Camera, status_code=201)
async def create_camera(camera: Camera, session: AsyncSession = Depends(get_session)):
    session.add(camera)
    await session.commit()
    await session.refresh(camera)
    return camera


@router.get("/{camera_id}", response_model=Camera)
async def get_camera(camera_id: str, session: AsyncSession = Depends(get_session)):
    camera = await session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera


@router.patch("/{camera_id}", response_model=Camera)
async def update_camera(
    camera_id: str,
    data: CameraUpdate,
    session: AsyncSession = Depends(get_session),
):
    camera = await session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(camera, field, value)
    session.add(camera)
    await session.commit()
    await session.refresh(camera)
    return camera


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(camera_id: str, session: AsyncSession = Depends(get_session)):
    camera = await session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    await session.delete(camera)
    await session.commit()


@router.get("/{camera_id}/snapshot")
async def camera_snapshot(camera_id: str, session: AsyncSession = Depends(get_session)):
    """Grab a single JPEG frame from the camera's stream_url via OpenCV."""
    camera = await session.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    def _grab() -> str | None:
        cap = cv2.VideoCapture(camera.stream_url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ret, frame = cap.read()
        cap.release()
        if not ret or frame is None:
            return None
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return None
        return base64.b64encode(buf).decode()

    b64 = await asyncio.get_event_loop().run_in_executor(None, _grab)
    if b64 is None:
        raise HTTPException(status_code=503, detail="Could not capture frame from stream")
    return {"data_url": f"data:image/jpeg;base64,{b64}"}
