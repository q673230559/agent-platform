from langchain.tools import tool
from backend.sandbox import SandboxExecutor, SandboxError
from backend.sandbox.executor import get_executor
from backend.config import get_workspace


@tool
def bash(command: str, timeout: int = 60) -> str:
    """
    Execute a shell command in an isolated sandbox container.
    Args:
        command: the shell command to execute
        timeout: maximum execution time in seconds (default 60)
    """
    try:
        executor: SandboxExecutor = get_executor()
        workspace = get_workspace()
        stdout, stderr, exit_code = executor.execute(command, timeout=timeout, working_dir=workspace)
        output_parts = []
        if stdout:
            output_parts.append(stdout.strip())
        if stderr:
            output_parts.append(f"[stderr]\n{stderr.strip()}")
        output_parts.append(f"[exit code: {exit_code}]")
        return "\n".join(output_parts)
    except SandboxError as e:
        return f"Sandbox error: {e}"
    except Exception as e:
        return f"Error executing command: {e}"
