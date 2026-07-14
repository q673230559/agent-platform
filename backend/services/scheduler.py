import json
import logging
from datetime import datetime, timezone

from croniter import croniter
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from backend.database import async_session
from backend.models.orchestration import Orchestration, OrchestrationRun, OrchestrationRunEvent

logger = logging.getLogger("scheduler")

scheduler: AsyncIOScheduler | None = None


def validate_cron(expression: str) -> bool:
    if not expression or not expression.strip():
        return False
    try:
        croniter(expression.strip())
        return True
    except (ValueError, KeyError):
        return False


def get_next_run(expression: str) -> datetime | None:
    expression = expression.strip() if expression else ""
    if not expression:
        return None
    try:
        return croniter(expression, datetime.now(timezone.utc)).get_next(datetime)
    except (ValueError, KeyError):
        return None


async def _execute_scheduled(orchestration_id: int) -> None:
    logger.info(f"Scheduled job fired for orchestration {orchestration_id}")

    from backend.services.orchestration import execute_orchestration_stream, CancelScope

    async with async_session() as db:
        orch = await db.get(Orchestration, orchestration_id)
        if not orch or not orch.is_active or not orch.schedule_enabled:
            logger.warning(f"Skipping scheduled run: orchestration {orchestration_id} not active/enabled")
            return

        max_retries = orch.max_retries if orch.max_retries is not None else 1
        default_input = ""
        if isinstance(orch.config, dict):
            default_input = str(orch.config.get("schedule_default_input", ""))

    final_status = "failed"
    final_result: dict = {}

    for attempt in range(max_retries + 1):
        run_id = None
        try:
            async with async_session() as db:
                run = OrchestrationRun(
                    orchestration_id=orchestration_id,
                    input_message=default_input or "(scheduled run)",
                    status="running",
                )
                db.add(run)
                await db.commit()
                await db.refresh(run)
                run_id = run.id

            cancel_scope = CancelScope()
            status = "completed"

            async for event in execute_orchestration_stream(orch, default_input, db, cancel_scope):
                # Persist significant events
                if event["type"] in ("node_start", "node_end", "tool_call", "node_error", "node_skip"):
                    node_id = event.get("node_id")
                    content = ""
                    metadata = None
                    if event["type"] == "node_error":
                        content = event.get("content", "")
                        metadata = {"error": content}
                    elif event["type"] == "node_skip":
                        content = event.get("reason", "")
                    elif event["type"] == "node_end":
                        content = json.dumps(event.get("output", ""), ensure_ascii=False)
                    else:
                        content = json.dumps(event.get("content", ""), ensure_ascii=False)
                    try:
                        async with async_session() as s:
                            s.add(OrchestrationRunEvent(
                                run_id=run_id,
                                node_id=node_id,
                                event_type=event["type"],
                                content=content,
                                metadata_=metadata or {},
                            ))
                            await s.commit()
                    except Exception:
                        logger.exception("Failed to persist run event")

                if event["type"] == "orchestration_done":
                    final_result = event.get("result", {})
                    if event.get("failed"):
                        status = "failed"

            if status == "completed":
                final_status = "completed"
                async with async_session() as db:
                    r = await db.get(OrchestrationRun, run_id)
                    if r:
                        r.status = "completed"
                        r.result = final_result
                        r.completed_at = datetime.now(timezone.utc)
                        await db.commit()
                logger.info(f"Scheduled orchestration {orchestration_id} completed successfully")
                return

            # Status is failed, will retry
            async with async_session() as db:
                r = await db.get(OrchestrationRun, run_id)
                if r:
                    r.status = "failed"
                    r.result = final_result
                    r.completed_at = datetime.now(timezone.utc)
                    await db.commit()

            if attempt < max_retries:
                logger.warning(
                    f"Scheduled orchestration {orchestration_id} failed, "
                    f"retrying ({attempt + 1}/{max_retries})"
                )

        except Exception as e:
            logger.exception(f"Scheduled orchestration {orchestration_id} attempt {attempt + 1} error")
            final_result = {"error": str(e)}
            if run_id:
                try:
                    async with async_session() as db:
                        r = await db.get(OrchestrationRun, run_id)
                        if r:
                            r.status = "failed"
                            r.result = final_result
                            r.completed_at = datetime.now(timezone.utc)
                            await db.commit()
                except Exception:
                    pass
            if attempt < max_retries:
                logger.warning(f"Retrying ({attempt + 1}/{max_retries})")

    logger.error(f"Scheduled orchestration {orchestration_id} failed after {max_retries} retries")


async def add_schedule(orch: Orchestration) -> None:
    global scheduler
    if scheduler is None:
        return

    job_id = f"orch_{orch.id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)

    if not orch.schedule_enabled or not orch.cron_expression:
        return

    if not validate_cron(orch.cron_expression):
        logger.warning(f"Invalid cron expression for orchestration {orch.id}: {orch.cron_expression}")
        return

    trigger = CronTrigger.from_crontab(orch.cron_expression.strip())
    scheduler.add_job(
        _execute_scheduled,
        trigger,
        id=job_id,
        kwargs={"orchestration_id": orch.id},
        replace_existing=True,
    )
    logger.info(f"Scheduled orchestration {orch.id} with cron '{orch.cron_expression}'")


async def remove_schedule(orchestration_id: int) -> None:
    global scheduler
    if scheduler is None:
        return
    job_id = f"orch_{orchestration_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info(f"Removed schedule for orchestration {orchestration_id}")


async def load_all_schedules() -> None:
    global scheduler
    if scheduler is None:
        return

    async with async_session() as db:
        result = await db.execute(
            select(Orchestration).where(
                Orchestration.schedule_enabled == True,
                Orchestration.cron_expression.isnot(None),
                Orchestration.cron_expression != "",
            )
        )
        orchestrations = result.unique().scalars().all()

    count = 0
    for orch in orchestrations:
        await add_schedule(orch)
        count += 1

    logger.info(f"Loaded {count} scheduled orchestrations")
