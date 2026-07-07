from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from backend.config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=10, max_overflow=20, pool_recycle=3600, pool_pre_ping=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        # Drop bot-related tables to rebuild with new schema
        await conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        await conn.execute(text("DROP TABLE IF EXISTS messages"))
        await conn.execute(text("DROP TABLE IF EXISTS conversations"))
        await conn.execute(text("DROP TABLE IF EXISTS bot_tools"))
        await conn.execute(text("DROP TABLE IF EXISTS bots"))
        await conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
        await conn.run_sync(Base.metadata.create_all)
