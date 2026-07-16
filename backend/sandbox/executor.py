import os
import threading
import concurrent.futures

import docker
from docker.errors import NotFound

SANDBOX_CONTAINER = "agent-platform-sandbox"
DEFAULT_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT", "300"))


class SandboxError(Exception):
    """Raised when sandbox execution fails."""


class SandboxTimeoutError(SandboxError):
    """Raised when command execution exceeds timeout."""


class SandboxExecutor:

    def __init__(self, default_timeout: int = DEFAULT_TIMEOUT):
        self.default_timeout = default_timeout
        self._client: docker.DockerClient | None = None
        self._lock = threading.Lock()

    @property
    def client(self) -> docker.DockerClient:
        if self._client is None:
            with self._lock:
                if self._client is None:
                    self._client = docker.from_env()
        return self._client

    def _get_container(self):
        try:
            return self.client.containers.get(SANDBOX_CONTAINER)
        except NotFound:
            raise SandboxError(
                f"Sandbox container '{SANDBOX_CONTAINER}' not found. "
                "Ensure docker-compose is running."
            )

    def execute(self, command: str, timeout: int | None = None, working_dir: str | None = None) -> tuple[str, str, int]:
        timeout = timeout or self.default_timeout
        container = self._get_container()

        try:
            exec_handle = container.client.api.exec_create(
                container.id,
                cmd=["/bin/bash", "-c", command],
                workdir=working_dir or "/workspace",
            )
            exec_id = exec_handle["Id"]

            output = container.client.api.exec_start(exec_id, detach=False, demux=True)

            # exec_start returns a tuple of (stdout_bytes, stderr_bytes) when demux=True
            if isinstance(output, tuple):
                stdout = output[0].decode("utf-8", errors="replace") if output[0] else ""
                stderr = output[1].decode("utf-8", errors="replace") if output[1] else ""
            else:
                stdout = output.decode("utf-8", errors="replace") if output else ""
                stderr = ""

            inspect = container.client.api.exec_inspect(exec_id)
            exit_code = inspect.get("ExitCode", -1)

            return stdout, stderr, exit_code
        except docker.errors.APIError as e:
            raise SandboxError(f"Container execution error: {e}") from e


_executor: SandboxExecutor | None = None
_executor_lock = threading.Lock()


def get_executor() -> SandboxExecutor:
    global _executor
    if _executor is None:
        with _executor_lock:
            if _executor is None:
                _executor = SandboxExecutor()
    return _executor
