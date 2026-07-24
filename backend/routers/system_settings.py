from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models.system_settings import SystemSettings
from backend.models.provider import ModelProvider
from backend.schemas.system_settings import SystemSettingsUpdate, SystemSettingsOut

router = APIRouter(prefix="/system-settings", tags=["system_settings"])


@router.get("", response_model=SystemSettingsOut)
async def get_system_settings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = SystemSettings(id=1, provider_id=None, model_name=None)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return settings


@router.put("", response_model=SystemSettingsOut)
async def update_system_settings(data: SystemSettingsUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings:
        settings = SystemSettings(id=1)
        db.add(settings)

    if data.provider_id is not None:
        provider = await db.get(ModelProvider, data.provider_id)
        if not provider:
            raise HTTPException(404, "Provider not found")
        settings.provider_id = data.provider_id

    if data.model_name is not None:
        settings.model_name = data.model_name

    await db.commit()
    await db.refresh(settings)
    return settings
