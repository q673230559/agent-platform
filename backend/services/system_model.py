from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from langchain_openai import ChatOpenAI
from backend.models.system_settings import SystemSettings
from backend.models.provider import ModelProvider
from backend.services.llm_factory import create_llm


async def get_system_llm(db: AsyncSession, temperature: float = 0.7) -> ChatOpenAI | None:
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    settings = result.scalar_one_or_none()
    if not settings or not settings.provider_id or not settings.model_name:
        return None

    result = await db.execute(
        select(ModelProvider).where(ModelProvider.id == settings.provider_id)
    )
    provider = result.scalar_one_or_none()
    if not provider:
        return None

    return create_llm(provider, settings.model_name, temperature=temperature)
