from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import List
from datetime import datetime

from app.db.session import get_session
from app.db.models import Incident

router = APIRouter()


@router.get("/", response_model=List[Incident])
async def list_incidents(
    status: str = None,
    session: AsyncSession = Depends(get_session),
):
    query = select(Incident).order_by(Incident.created_at.desc())
    if status:
        query = query.where(Incident.status == status)
    result = await session.execute(query)
    return result.scalars().all()


@router.get("/{incident_id}", response_model=Incident)
async def get_incident(incident_id: str, session: AsyncSession = Depends(get_session)):
    incident = await session.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.patch("/{incident_id}/acknowledge", response_model=Incident)
async def acknowledge_incident(
    incident_id: str,
    operator: str = "operator",
    session: AsyncSession = Depends(get_session),
):
    incident = await session.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = "ACKNOWLEDGED"
    incident.acknowledged_by = operator
    incident.acknowledged_at = datetime.utcnow()
    session.add(incident)
    await session.commit()
    await session.refresh(incident)
    return incident


@router.patch("/{incident_id}/resolve", response_model=Incident)
async def resolve_incident(
    incident_id: str,
    status: str = "RESOLVED",
    session: AsyncSession = Depends(get_session),
):
    if status not in ("RESOLVED", "FALSE_POSITIVE"):
        raise HTTPException(status_code=400, detail="Invalid status")
    incident = await session.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = status
    incident.resolved_at = datetime.utcnow()
    session.add(incident)
    await session.commit()
    await session.refresh(incident)
    return incident
