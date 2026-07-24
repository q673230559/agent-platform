import time
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models.provider import ModelProvider
from backend.schemas.provider import ProviderCreate, ProviderUpdate, ProviderOut, ModelsResponse, FetchModelsRequest
from backend.services.crypto import encrypt, decrypt

router = APIRouter(prefix="/providers", tags=["providers"])

# In-memory cache: {provider_id: (models, timestamp)}
_model_cache: dict[int, tuple[list[str], float]] = {}
_CACHE_TTL = 7200  # 2 hours


async def _fetch_models(base_url: str, api_key: str) -> list[str]:
    url = f"{base_url.rstrip('/')}/models"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        resp.raise_for_status()
        data = resp.json()
    models = [m["id"] for m in data.get("data", []) if m.get("id")]
    models.sort()
    return models


def _cached_models(provider_id: int) -> list[str] | None:
    entry = _model_cache.get(provider_id)
    if entry:
        models, ts = entry
        if time.time() - ts < _CACHE_TTL:
            return models
        del _model_cache[provider_id]
    return None


@router.get("", response_model=list[ProviderOut])
async def list_providers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ModelProvider).order_by(ModelProvider.id))
    return result.scalars().all()


@router.post("", response_model=ProviderOut, status_code=201)
async def create_provider(data: ProviderCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(ModelProvider).where(ModelProvider.name == data.name))
    if existing.scalar():
        raise HTTPException(400, "Provider name already exists")
    provider = ModelProvider(
        name=data.name,
        base_url=data.base_url,
        api_key=encrypt(data.api_key),
        default_model=data.default_model,
    )
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return provider


@router.post("/models", response_model=ModelsResponse)
async def fetch_models(data: FetchModelsRequest):
    try:
        models = await _fetch_models(data.base_url, data.api_key)
        return {"models": models}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Failed to fetch models: {e}")


@router.get("/{provider_id}", response_model=ProviderOut)
async def get_provider(provider_id: int, db: AsyncSession = Depends(get_db)):
    provider = await db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(404, "Provider not found")
    return provider


@router.put("/{provider_id}", response_model=ProviderOut)
async def update_provider(provider_id: int, data: ProviderUpdate, db: AsyncSession = Depends(get_db)):
    provider = await db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(404, "Provider not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "api_key" and value:
            setattr(provider, field, encrypt(value))
        elif value is not None:
            setattr(provider, field, value)
    await db.commit()
    await db.refresh(provider)
    return provider


@router.delete("/{provider_id}", status_code=204)
async def delete_provider(provider_id: int, db: AsyncSession = Depends(get_db)):
    provider = await db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(404, "Provider not found")
    # Check if any bot uses this provider
    from backend.models.bot import Bot
    bot_count = await db.scalar(select(Bot.id).where(Bot.provider_id == provider_id).limit(1))
    if bot_count is not None:
        raise HTTPException(400, "Cannot delete: bots are still using this provider")

    # Clear system settings reference if this provider is the system model
    from backend.models.system_settings import SystemSettings
    sys_result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    sys_settings = sys_result.scalar_one_or_none()
    if sys_settings and sys_settings.provider_id == provider_id:
        sys_settings.provider_id = None
        sys_settings.model_name = None

    await db.delete(provider)
    await db.commit()


@router.get("/{provider_id}/models", response_model=ModelsResponse)
async def list_models(provider_id: int, db: AsyncSession = Depends(get_db)):
    provider = await db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(404, "Provider not found")
    cached = _cached_models(provider_id)
    if cached is not None:
        return {"models": cached}
    try:
        models = await _fetch_models(provider.base_url, decrypt(provider.api_key))
        _model_cache[provider_id] = (models, time.time())
        return {"models": models}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Failed to fetch models: {e}")
