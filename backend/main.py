import os
os.environ["LANGCHAIN_VERBOSE"] = "true"

import logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# Silence noisy third-party loggers
for lib in ("httpcore", "urllib3", "asyncio", "aiomysql"):
    logging.getLogger(lib).setLevel(logging.WARNING)

from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database import init_db, get_db
from backend.routers import providers, bots, tools, orchestrations, system_settings
from backend.models.tool import BuiltinTool
from backend.models.provider import ModelProvider
from backend.models.bot import Bot
from backend.models.orchestration import Orchestration, OrchestrationRun
from backend.services.scheduler import load_all_schedules
from apscheduler.schedulers.asyncio import AsyncIOScheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    BuiltinTool.seed()

    import backend.services.scheduler as sched_mod
    sched_mod.scheduler = AsyncIOScheduler()
    sched_mod.scheduler.start()
    await load_all_schedules()

    try:
        yield
    finally:
        sched_mod.scheduler.shutdown(wait=False)


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
app.include_router(orchestrations.router, prefix="/api")
app.include_router(system_settings.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    prov_count = (await db.execute(select(func.count(ModelProvider.id)))).scalar() or 0
    bot_count = (await db.execute(select(func.count(Bot.id)))).scalar() or 0
    orch_count = (await db.execute(select(func.count(Orchestration.id)))).scalar() or 0
    run_count = (await db.execute(select(func.count(OrchestrationRun.id)))).scalar() or 0
    return {
        "providers": prov_count,
        "bots": bot_count,
        "orchestrations": orch_count,
        "orchestration_runs": run_count,
    }
