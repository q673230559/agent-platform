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
                    BuiltinTool(
                        name="read_file",
                        display_name="Read File",
                        description="Read file contents with optional line offset and limit",
                    ),
                    BuiltinTool(
                        name="write_file",
                        display_name="Write File",
                        description="Write content to a file, creating parent directories as needed",
                    ),
                    BuiltinTool(
                        name="edit_file",
                        display_name="Edit File",
                        description="Replace old_string with new_string in a file (must be unique match)",
                    ),
                    BuiltinTool(
                        name="glob_files",
                        display_name="Glob Files",
                        description="Match files by glob pattern (e.g. **/*.py) under the workspace",
                    ),
                    BuiltinTool(
                        name="grep_files",
                        display_name="Grep Files",
                        description="Search for a regex pattern in files under a given path",
                    ),
                    BuiltinTool(
                        name="web_fetch",
                        display_name="Web Fetch",
                        description="Fetch and parse a web page, returning text content as markdown",
                    ),
                ]
                db.add_all(tools)
                await db.commit()
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_seed())
        except RuntimeError:
            asyncio.run(_seed())
