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
    # Import orchestration models so they are registered on Base.metadata
    import backend.models.orchestration  # noqa: F401

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

        # Migrate orchestration_nodes: drop old Agent-specific columns, keep config JSON
        orch_nodes_cols = await conn.execute(
            text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orchestration_nodes'")
        )
        orch_col_names = {r[0] for r in orch_nodes_cols.fetchall()}
        if orch_col_names:
            # Drop FK first
            try:
                await conn.execute(text("ALTER TABLE orchestration_nodes DROP FOREIGN KEY fk_orch_node_provider"))
            except Exception:
                pass
            # Drop old agent-specific columns if they exist
            for old_col in ["provider_id", "model_name", "system_prompt", "temperature", "tools"]:
                if old_col in orch_col_names:
                    try:
                        await conn.execute(text(f"ALTER TABLE orchestration_nodes DROP COLUMN {old_col}"))
                    except Exception:
                        pass
            # Add node_type if missing
            if "node_type" not in orch_col_names:
                await conn.execute(text("ALTER TABLE orchestration_nodes ADD COLUMN node_type VARCHAR(20) NOT NULL DEFAULT 'agent'"))
            if "node_key" not in orch_col_names:
                await conn.execute(text("ALTER TABLE orchestration_nodes ADD COLUMN node_key VARCHAR(50) NOT NULL DEFAULT ''"))

        # Add category to builtin_tools
        tool_cols = await conn.execute(
            text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'builtin_tools'")
        )
        tool_col_names = {r[0] for r in tool_cols.fetchall()}
        if "category" not in tool_col_names:
            await conn.execute(text("ALTER TABLE builtin_tools ADD COLUMN category VARCHAR(50) NOT NULL DEFAULT ''"))

        # Migrate orchestrations: add scheduling columns
        orch_cols = await conn.execute(
            text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orchestrations'")
        )
        orch_col_names_set = {r[0] for r in orch_cols.fetchall()}
        if orch_col_names_set:
            for col_name, col_def in [
                ("cron_expression", "VARCHAR(100) NULL"),
                ("schedule_enabled", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("max_retries", "INTEGER NOT NULL DEFAULT 1"),
                ("recursion_limit", "INTEGER NOT NULL DEFAULT 50"),
            ]:
                if col_name not in orch_col_names_set:
                    await conn.execute(text(f"ALTER TABLE orchestrations ADD COLUMN {col_name} {col_def}"))
