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
def glob_files(pattern: str, path: str = ".") -> str:
    """
    Match files by glob pattern relative to the workspace.
    Args:
        pattern: glob pattern, e.g. "**/*.py" or "src/**/*.ts"
        path: base directory for the search, defaults to workspace root
    """
    try:
        base = _safe_path(path) if path != "." else pathlib.Path(get_workspace()).resolve()
        matches = sorted(base.glob(pattern))
        if not matches:
            return f"No files matched pattern: {pattern}"
        lines = []
        for m in matches[:200]:
            rel = str(m.relative_to(pathlib.Path(get_workspace()).resolve()))
            lines.append(rel)
        output = "\n".join(lines)
        if len(matches) > 200:
            output += f"\n\n[... and {len(matches) - 200} more results]"
        return output
    except ValueError as e:
        return str(e)
    except Exception as e:
        return f"Error during glob: {e}"
