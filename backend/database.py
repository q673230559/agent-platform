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
        await conn.run_sync(Base.metadata.create_all)
        # Add missing columns if any (idempotent migration)
        existing = await conn.execute(text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'bots'"))
        rows = existing.fetchall()
        existing_cols = {r[0] for r in rows}
        migrations = {
            "avatar_url": "ALTER TABLE bots ADD COLUMN avatar_url VARCHAR(500) NOT NULL DEFAULT ''",
            "bio": "ALTER TABLE bots ADD COLUMN bio VARCHAR(300) NOT NULL DEFAULT ''",
            "greeting_message": "ALTER TABLE bots ADD COLUMN greeting_message TEXT NOT NULL DEFAULT ''",
            "tags": "ALTER TABLE bots ADD COLUMN tags JSON NOT NULL DEFAULT ('[]')",
        }
        for col, sql in migrations.items():
            if col not in existing_cols:
                await conn.execute(text(sql))
