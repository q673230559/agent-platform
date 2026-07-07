from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.database import init_db
from backend.routers import providers, bots, tools
from backend.models.tool import BuiltinTool


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    BuiltinTool.seed()
    yield


app = FastAPI(title="Agent Platform", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(providers.router, prefix="/api")
app.include_router(bots.router, prefix="/api")
app.include_router(bots.router2, prefix="/api")
app.include_router(bots.chat_router, prefix="/api")
app.include_router(tools.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
