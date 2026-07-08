import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+aiomysql://root:password@mysql:3306/agent_platform")
FERNET_KEY = os.getenv("FERNET_KEY", "")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
WORKSPACE_ROOT = os.getenv("WORKSPACE_ROOT", os.getcwd())
