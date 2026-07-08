import pathlib
from langchain.tools import tool
from backend.config import WORKSPACE_ROOT


def _safe_path(path: str) -> pathlib.Path:
    """Resolve path and ensure it stays within the workspace root."""
    root = pathlib.Path(WORKSPACE_ROOT).resolve()
    resolved = (root / path).resolve()
    if not str(resolved).startswith(str(root)):
        raise ValueError(f"Path traversal denied: {path}")
    return resolved


@tool
def read_file(path: str, offset: int = 0, limit: int = 2000) -> str:
    """
    Read the contents of a file with optional line offset and limit.
    Args:
        path: file path relative to workspace root
        offset: starting line number (0-indexed, default 0)
        limit: maximum number of lines to read (default 2000)
    """
    try:
        file_path = _safe_path(path)
        if not file_path.exists():
            return f"File not found: {path}"
        if not file_path.is_file():
            return f"Not a file: {path}"
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        total = len(lines)
        end = min(offset + limit, total)
        if offset >= total:
            return f"File has {total} lines, offset {offset} is out of range."
        selected = lines[offset:end]
        result = []
        for i, line in enumerate(selected, start=offset):
            result.append(f"{i}\t{line.rstrip()}")
        output = "\n".join(result)
        if end < total:
            output += f"\n\n[Showing lines {offset}-{end - 1} of {total}, use offset={end} for more]"
        return output
    except ValueError as e:
        return str(e)
    except Exception as e:
        return f"Error reading file: {e}"
