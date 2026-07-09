import os
from contextvars import ContextVar
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+aiomysql://root:password@mysql:3306/agent_platform")
FERNET_KEY = os.getenv("FERNET_KEY", "")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", os.getcwd())

_workspace_override: ContextVar[str | None] = ContextVar("workspace_override", default=None)


def get_workspace() -> str:
    """Return the effective workspace root, respecting per-orchestration override."""
    return _workspace_override.get() or WORKSPACE_ROOT


def set_workspace_override(path: str) -> None:
    """Set a per-orchestration workspace directory (uses ContextVar for async safety)."""
    _workspace_override.set(path)
