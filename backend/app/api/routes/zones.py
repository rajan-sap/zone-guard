from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import List
from pydantic import BaseModel

from app.db.session import get_session
from app.db.models import Zone

router = APIRouter()


class ZoneCreate(BaseModel):
    camera_id: str
    name: str
    polygon_points: str
    is_active: bool = True


@router.get("/", response_model=List[Zone])
async def list_zones(
    camera_id: str = None,
    session: AsyncSession = Depends(get_session),
):
    query = select(Zone)
    if camera_id:
        query = query.where(Zone.camera_id == camera_id)
    result = await session.execute(query)
    return result.scalars().all()


@router.post("/", response_model=Zone, status_code=201)
async def create_zone(data: ZoneCreate, session: AsyncSession = Depends(get_session)):
    import uuid
    zone = Zone(
        id=str(uuid.uuid4()),
        camera_id=data.camera_id,
        name=data.name,
        polygon_points=data.polygon_points,
        is_active=data.is_active,
    )
    session.add(zone)
    await session.commit()
    await session.refresh(zone)
    return zone


@router.put("/{zone_id}", response_model=Zone)
async def update_zone(
    zone_id: str, zone_data: Zone, session: AsyncSession = Depends(get_session)
):
    zone = await session.get(Zone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    zone.name = zone_data.name
    zone.polygon_points = zone_data.polygon_points
    zone.is_active = zone_data.is_active
    session.add(zone)
    await session.commit()
    await session.refresh(zone)
    return zone


@router.delete("/{zone_id}", status_code=204)
async def delete_zone(zone_id: str, session: AsyncSession = Depends(get_session)):
    zone = await session.get(Zone, zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    await session.delete(zone)
    await session.commit()
