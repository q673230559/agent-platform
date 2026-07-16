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
    category = Column(String(50), default="")

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
                        name="web_search",
                        display_name="Web Search",
                        description="Search the web using DuckDuckGo for up-to-date information",
                        category="网络搜索",
                    ),
                    BuiltinTool(
                        name="web_fetch",
                        display_name="Web Fetch",
                        description="Fetch and parse a web page, returning text content as markdown",
                        category="网络搜索",
                    ),
                    BuiltinTool(
                        name="read_file",
                        display_name="Read File",
                        description="Read file contents with optional line offset and limit",
                        category="文件操作",
                    ),
                    BuiltinTool(
                        name="write_file",
                        display_name="Write File",
                        description="Write content to a file, creating parent directories as needed",
                        category="文件操作",
                    ),
                    BuiltinTool(
                        name="edit_file",
                        display_name="Edit File",
                        description="Replace old_string with new_string in a file (must be unique match)",
                        category="文件操作",
                    ),
                    BuiltinTool(
                        name="glob_files",
                        display_name="Glob Files",
                        description="Match files by glob pattern (e.g. **/*.py) under the workspace",
                        category="文件操作",
                    ),
                    BuiltinTool(
                        name="grep_files",
                        display_name="Grep Files",
                        description="Search for a regex pattern in files under a given path",
                        category="文件操作",
                    ),
                    BuiltinTool(
                        name="poetry_search",
                        display_name="Poetry Search",
                        description="Search Chinese poems by keyword (Tang, Song, Yuan, nearly 400k poems)",
                        category="诗词",
                    ),
                    BuiltinTool(
                        name="poetry_random",
                        display_name="Poetry Random",
                        description="Get a random Chinese poem",
                        category="诗词",
                    ),
                    BuiltinTool(
                        name="poetry_get",
                        display_name="Poetry Get",
                        description="Get a specific poem by its ID number",
                        category="诗词",
                    ),
                    BuiltinTool(
                        name="poetry_authors",
                        display_name="Poetry Authors",
                        description="List Chinese poets/authors with their dynasty information",
                        category="诗词",
                    ),
                    BuiltinTool(
                        name="get_current_time",
                        display_name="Get Current Time",
                        description="Unified time tool: current time, weekday, solar terms, countdown, timezone conversion, lunar calendar, Chinese holidays",
                        category="时间工具",
                    ),
                    BuiltinTool(
                        name="bash",
                        display_name="Bash",
                        description="在 workspace 中执行本地 shell 命令，返回标准输出和错误输出",
                        category="命令执行",
                    ),
                ]
                db.add_all(tools)
                await db.commit()
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_seed())
        except RuntimeError:
            asyncio.run(_seed())
