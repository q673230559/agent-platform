import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from backend.database import get_db, async_session
from backend.models.orchestration import (
    Orchestration, OrchestrationNode, OrchestrationEdge,
    OrchestrationRun, OrchestrationRunEvent, OrchestrationType,
)
from backend.models.provider import ModelProvider
from backend.schemas.orchestration import (
    OrchestrationCreate, OrchestrationUpdate, OrchestrationOut,
    NodeCreate, NodeOut, EdgeOut,
    OrchestrationExecuteRequest, OrchestrationRunOut, RunEventOut,
)
from backend.services.orchestration import execute_orchestration_stream

logger = logging.getLogger("orchestrations")
router = APIRouter(prefix="/orchestrations", tags=["orchestrations"])


# ── Helpers ──

def _node_to_out(node: OrchestrationNode) -> NodeOut:
    return NodeOut(
        id=node.id,
        node_type=node.node_type or "agent",
        label=node.label,
        position_x=node.position_x or 0,
        position_y=node.position_y or 0,
        config=node.config or {},
    )


def _edge_to_out(edge: OrchestrationEdge) -> EdgeOut:
    return EdgeOut(
        id=edge.id,
        source_node_id=edge.source_node_id,
        target_node_id=edge.target_node_id,
        condition=edge.condition or "",
        label=edge.label or "",
        is_default=edge.is_default or False,
    )


def _orch_to_out(orch: Orchestration) -> OrchestrationOut:
    return OrchestrationOut(
        id=orch.id,
        name=orch.name,
        description=orch.description or "",
        orchestration_type=orch.orchestration_type,
        config=orch.config or {},
        is_active=orch.is_active,
        nodes=[_node_to_out(n) for n in (orch.nodes or [])],
        edges=[_edge_to_out(e) for e in (orch.edges or [])],
        created_at=orch.created_at,
        updated_at=orch.updated_at,
    )


async def _lookup_nodes_by_label(orch: Orchestration, db: AsyncSession) -> dict[str, int]:
    """Return {node_label: node_id} mapping after refreshing nodes."""
    await db.refresh(orch, ["nodes"])
    return {n.label: n.id for n in orch.nodes}


# ── Orchestration CRUD ──

@router.get("", response_model=list[OrchestrationOut])
async def list_orchestrations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Orchestration).order_by(Orchestration.id))
    return [_orch_to_out(o) for o in result.unique().scalars().all()]


@router.post("", response_model=OrchestrationOut, status_code=201)
async def create_orchestration(data: OrchestrationCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(Orchestration.id).where(Orchestration.name == data.name))
    if existing is not None:
        raise HTTPException(409, "Orchestration name already exists")

    # Validate agent node configs
    for nc in data.nodes:
        if nc.node_type == 'agent':
            pid = nc.config.get('provider_id', 0) if isinstance(nc.config, dict) else 0
            if pid:
                provider = await db.get(ModelProvider, pid)
                if not provider:
                    raise HTTPException(404, f"Provider {pid} not found")

    orch = Orchestration(
        name=data.name,
        description=data.description,
        orchestration_type=data.orchestration_type,
        config=data.config,
        is_active=data.is_active,
    )
    db.add(orch)
    await db.flush()

    # Create nodes, mapping temp_id -> real_id
    temp_to_real: dict[str, int] = {}
    for nc in data.nodes:
        node = OrchestrationNode(
            orchestration_id=orch.id,
            node_type=nc.node_type or "agent",
            label=nc.label or "",
            position_x=nc.position_x,
            position_y=nc.position_y,
            config=nc.config or {},
        )
        db.add(node)
        await db.flush()
        if nc.temp_id:
            temp_to_real[nc.temp_id] = node.id

    # Create edges — resolve source/target via temp_id mapping
    for ec in data.edges:
        src_real = temp_to_real.get(str(ec.source_node_id), ec.source_node_id if ec.source_node_id > 0 else None)
        tgt_real = temp_to_real.get(str(ec.target_node_id), ec.target_node_id if ec.target_node_id > 0 else None)
        if src_real is None or tgt_real is None:
            continue
        edge = OrchestrationEdge(
            orchestration_id=orch.id,
            source_node_id=src_real,
            target_node_id=tgt_real,
            condition=ec.condition or "",
            label=ec.label or "",
            is_default=ec.is_default,
        )
        db.add(edge)

    await db.commit()
    await db.refresh(orch)
    return _orch_to_out(orch)


@router.get("/{orchestration_id}", response_model=OrchestrationOut)
async def get_orchestration(orchestration_id: int, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    return _orch_to_out(orch)


@router.put("/{orchestration_id}", response_model=OrchestrationOut)
async def update_orchestration(orchestration_id: int, data: OrchestrationUpdate, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")

    if data.name is not None:
        existing = await db.scalar(
            select(Orchestration.id).where(Orchestration.name == data.name, Orchestration.id != orchestration_id)
        )
        if existing is not None:
            raise HTTPException(409, "Orchestration name already exists")

    for field, value in data.model_dump(exclude_unset=True, exclude={"nodes", "edges"}).items():
        if value is not None:
            setattr(orch, field, value)

    if data.nodes is not None:
        await db.execute(delete(OrchestrationEdge).where(OrchestrationEdge.orchestration_id == orchestration_id))
        await db.execute(delete(OrchestrationNode).where(OrchestrationNode.orchestration_id == orchestration_id))
        temp_to_real: dict[str, int] = {}
        for nc in data.nodes:
            node = OrchestrationNode(
                orchestration_id=orch.id,
                label=nc.label or "",
                position_x=nc.position_x,
                position_y=nc.position_y,
                config=nc.config or {},
                node_type=nc.node_type or "agent",
            )
            db.add(node)
            await db.flush()
            if nc.temp_id:
                temp_to_real[nc.temp_id] = node.id

        if data.edges is not None:
            for ec in data.edges:
                src = temp_to_real.get(str(ec.source_node_id), ec.source_node_id if ec.source_node_id > 0 else None)
                tgt = temp_to_real.get(str(ec.target_node_id), ec.target_node_id if ec.target_node_id > 0 else None)
                if src is None or tgt is None:
                    continue
                edge = OrchestrationEdge(
                    orchestration_id=orch.id,
                    source_node_id=src,
                    target_node_id=tgt,
                    condition=ec.condition or "",
                    label=ec.label or "",
                    is_default=ec.is_default,
                )
                db.add(edge)

    await db.commit()
    await db.refresh(orch)
    return _orch_to_out(orch)


@router.delete("/{orchestration_id}", status_code=204)
async def delete_orchestration(orchestration_id: int, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    await db.delete(orch)
    await db.commit()


# ── Execution ──

@router.post("/{orchestration_id}/execute")
async def execute_orchestration(orchestration_id: int, req: OrchestrationExecuteRequest,
                                 db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    if not orch.is_active:
        raise HTTPException(400, "Orchestration is not active")

    nodes = list(orch.nodes)
    if not nodes:
        raise HTTPException(400, "Orchestration has no nodes")

    run = OrchestrationRun(orchestration_id=orch.id, input_message=req.message, status="running")
    db.add(run)
    await db.commit()
    await db.refresh(run)
    run_id = run.id

    async def event_stream():
        final_result = {}
        try:
            async for event in execute_orchestration_stream(orch, req.message, db):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event["type"] == "orchestration_done":
                    final_result = event.get("result", {})
                # Persist significant events
                if event["type"] in ("node_start", "node_end", "tool_call", "node_error"):
                    node_id = event.get("node_id")
                    async with async_session() as s:
                        s.add(OrchestrationRunEvent(
                            run_id=run_id,
                            node_id=node_id,
                            event_type=event["type"],
                            content=json.dumps(event.get("content", event.get("output", "")), ensure_ascii=False),
                        ))
                        await s.commit()

            # Mark run completed
            async with async_session() as s:
                r = await s.get(OrchestrationRun, run_id)
                if r:
                    r.status = "completed"
                    r.result = final_result
                    await s.commit()

        except Exception as e:
            logger.exception("Orchestration execution failed")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
            async with async_session() as s:
                r = await s.get(OrchestrationRun, run_id)
                if r:
                    r.status = "failed"
                    await s.commit()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Run History ──

@router.get("/{orchestration_id}/runs", response_model=list[OrchestrationRunOut])
async def list_runs(orchestration_id: int, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    result = await db.execute(
        select(OrchestrationRun).where(OrchestrationRun.orchestration_id == orchestration_id).order_by(
            OrchestrationRun.created_at.desc())
    )
    runs = result.unique().scalars().all()
    return [_run_to_out(r) for r in runs]


@router.get("/runs/{run_id}", response_model=OrchestrationRunOut)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(OrchestrationRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return _run_to_out(run)


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(OrchestrationRun, run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    await db.delete(run)
    await db.commit()


def _run_to_out(run: OrchestrationRun) -> OrchestrationRunOut:
    return OrchestrationRunOut(
        id=run.id,
        orchestration_id=run.orchestration_id,
        input_message=run.input_message or "",
        status=run.status or "unknown",
        result=run.result or None,
        events=[_event_to_out(e) for e in (run.events or [])],
        created_at=run.created_at,
        completed_at=run.completed_at,
    )


def _event_to_out(event: OrchestrationRunEvent) -> RunEventOut:
    return RunEventOut(
        id=event.id,
        node_id=event.node_id,
        event_type=event.event_type,
        content=event.content or "",
        metadata=event.metadata_ or None,
        created_at=event.created_at,
    )
