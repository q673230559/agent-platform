import pathlib
from langchain.tools import tool
from backend.config import get_workspace


def _safe_path(path: str) -> pathlib.Path:
    root = pathlib.Path(get_workspace()).resolve()
    resolved = (root / path).resolve()
    if not str(resolved).startswith(str(root)):
        raise ValueError(f"Path traversal denied: {path}")
    return resolved


@tool
def write_file(path: str, content: str) -> str:
    """
    Write content to a file, creating parent directories as needed.
    Args:
        path: file path relative to workspace root
        content: the text content to write to the file
    """
    try:
        file_path = _safe_path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        return f"Successfully wrote {len(content)} bytes to {path}"
    except ValueError as e:
        return str(e)
    except Exception as e:
        return f"Error writing file: {e}"
