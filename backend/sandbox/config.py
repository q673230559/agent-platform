import os


SANDBOX_IMAGE = os.getenv("SANDBOX_IMAGE", "mcr.microsoft.com/playwright/python:v1.44.0-jammy")
SANDBOX_NETWORK = os.getenv("SANDBOX_NETWORK", "agent_network")
SANDBOX_MEMORY_LIMIT = os.getenv("SANDBOX_MEMORY_LIMIT", "512m")
SANDBOX_CPU_LIMIT = float(os.getenv("SANDBOX_CPU_LIMIT", "1.0"))
SANDBOX_DEFAULT_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT", "300"))
HOST_WORKSPACE_ROOT = os.getenv("HOST_WORKSPACE_ROOT", "")
SANDBOX_NO_NETWORK = os.getenv("SANDBOX_NO_NETWORK", "false").lower() == "true"
