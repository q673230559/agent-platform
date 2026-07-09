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
def edit_file(path: str, old_string: str, new_string: str) -> str:
    """
    Replace old_string with new_string in a file. Fails if old_string is not unique.
    Args:
        path: file path relative to workspace root
        old_string: the exact text to be replaced (must be unique in the file)
        new_string: the text to replace it with
    """
    try:
        file_path = _safe_path(path)
        if not file_path.exists():
            return f"File not found: {path}"
        if not file_path.is_file():
            return f"Not a file: {path}"
        text = file_path.read_text(encoding="utf-8")
        count = text.count(old_string)
        if count == 0:
            return f"old_string not found in {path}"
        if count > 1:
            return f"old_string appears {count} times in {path}, must be unique. Provide more context to make it unique."
        new_text = text.replace(old_string, new_string)
        file_path.write_text(new_text, encoding="utf-8")
        return f"Successfully replaced 1 occurrence in {path}"
    except ValueError as e:
        return str(e)
    except Exception as e:
        return f"Error editing file: {e}"
