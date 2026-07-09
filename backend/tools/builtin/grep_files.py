import pathlib
import subprocess
import re
from langchain.tools import tool
from backend.config import get_workspace


def _safe_path(path: str) -> pathlib.Path:
    root = pathlib.Path(get_workspace()).resolve()
    resolved = (root / path).resolve()
    if not str(resolved).startswith(str(root)):
        raise ValueError(f"Path traversal denied: {path}")
    return resolved


@tool
def grep_files(pattern: str, path: str = ".", glob: str = "", head_limit: int = 100) -> str:
    """
    Search for a regex pattern in files under the given path.
    Args:
        pattern: the regular expression to search for
        path: directory to search in, defaults to workspace root
        glob: optional glob filter, e.g. "*.py" or "*.{ts,tsx}"
        head_limit: max number of matching lines to return (default 100)
    """
    try:
        base = _safe_path(path) if path != "." else pathlib.Path(get_workspace()).resolve()

        # Try ripgrep first for performance
        try:
            cmd = ["rg", "--no-heading", "--line-number", "--color=never", pattern, str(base)]
            if glob:
                cmd.insert(1, "--glob")
                cmd.insert(2, glob)
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, encoding="utf-8")
            lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
        except (FileNotFoundError, subprocess.TimeoutExpired):
            # Fallback to pure Python re
            lines = []
            file_pattern = glob or "*"
            for file_path in base.rglob(file_pattern):
                if file_path.is_file():
                    try:
                        rel = str(file_path.relative_to(pathlib.Path(get_workspace()).resolve()))
                        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                            for i, line in enumerate(f, start=1):
                                if re.search(pattern, line):
                                    lines.append(f"{rel}:{i}:{line.rstrip()}")
                    except Exception:
                        continue

        if not lines:
            return f"No matches found for pattern: {pattern}"

        count = len(lines)
        output = "\n".join(lines[:head_limit])
        if count > head_limit:
            output += f"\n\n[Showing {head_limit} of {count} matches]"
        return output
    except ValueError as e:
        return str(e)
    except Exception as e:
        return f"Error during grep: {e}"
