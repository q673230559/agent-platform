from sqlalchemy import Column, Integer, String, Boolean, Text, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import Base, async_session


class BuiltinTool(Base):
    __tablename__ = "builtin_tools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    is_active = Column(Boolean, default=True)

    @staticmethod
    def seed():
        """Insert default tools if table is empty. Called synchronously during init_db."""
        import asyncio
        async def _seed():
            async with async_session() as db:
                result = await db.execute(select(BuiltinTool.id).limit(1))
                if result.first() is not None:
                    return
                tools = [
                    BuiltinTool(
                        name="calculator",
                        display_name="Calculator",
                        description="Perform arithmetic operations: add, sub, mul, div on two numbers",
                    ),
                    BuiltinTool(
                        name="web_search",
                        display_name="Web Search",
                        description="Search the web using DuckDuckGo for up-to-date information",
                    ),
                ]
                db.add_all(tools)
                await db.commit()
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_seed())
        except RuntimeError:
            asyncio.run(_seed())
