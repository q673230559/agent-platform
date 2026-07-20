import json
import logging
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from fastapi.responses import StreamingResponse, Response
from urllib.parse import quote
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
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
    PaginatedRunListOut, WorkspaceTreeItem,
    ImportPayload, ImportOrchestration, ImportNode, ImportEdge,
)
from backend.services.orchestration import execute_orchestration_stream, CancelScope
from backend.services.scheduler import add_schedule, remove_schedule, get_next_run
from backend.config import WORKSPACE_ROOT

logger = logging.getLogger("orchestrations")
router = APIRouter(prefix="/orchestrations", tags=["orchestrations"])


# ── Helpers ──

def _node_to_out(node: OrchestrationNode) -> NodeOut:
    return NodeOut(
        id=node.id,
        node_type=node.node_type or "agent",
        node_key=node.node_key or "",
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
    next_run = None
    if orch.schedule_enabled and orch.cron_expression:
        next_run = get_next_run(orch.cron_expression)

    return OrchestrationOut(
        id=orch.id,
        name=orch.name,
        description=orch.description or "",
        orchestration_type=orch.orchestration_type,
        config=orch.config or {},
        is_active=orch.is_active,
        cron_expression=orch.cron_expression,
        schedule_enabled=orch.schedule_enabled if orch.schedule_enabled is not None else False,
        max_retries=orch.max_retries if orch.max_retries is not None else 1,
        next_run_at=next_run,
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
        cron_expression=data.cron_expression,
        schedule_enabled=data.schedule_enabled,
        max_retries=data.max_retries,
    )
    db.add(orch)
    await db.flush()

    # Create nodes, mapping temp_id -> real_id
    temp_to_real: dict[str, int] = {}
    for nc in data.nodes:
        node = OrchestrationNode(
            orchestration_id=orch.id,
            node_type=nc.node_type or "agent",
            node_key=nc.node_key or "",
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
    await add_schedule(orch)
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
                node_key=nc.node_key or "",
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
    if orch.schedule_enabled and orch.cron_expression:
        await add_schedule(orch)
    else:
        await remove_schedule(orchestration_id)
    return _orch_to_out(orch)


@router.delete("/{orchestration_id}", status_code=204)
async def delete_orchestration(orchestration_id: int, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    await remove_schedule(orchestration_id)
    await db.delete(orch)
    await db.commit()


# ── Export / Import ──

@router.get("/{orchestration_id}/export")
async def export_orchestration(orchestration_id: int, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")

    await db.refresh(orch, ["nodes", "edges"])

    id_map: dict[int, str] = {}
    export_nodes: list[dict] = []
    for node in orch.nodes:
        temp_id = node.node_key or node.label or f"node_{node.id}"
        dedup = temp_id
        counter = 1
        while dedup in {n["temp_id"] for n in export_nodes}:
            dedup = f"{temp_id}_{counter}"
            counter += 1
        temp_id = dedup
        id_map[node.id] = temp_id
        export_nodes.append({
            "temp_id": temp_id,
            "node_type": node.node_type or "agent",
            "node_key": node.node_key or "",
            "label": node.label or "",
            "position_x": node.position_x or 0,
            "position_y": node.position_y or 0,
            "config": node.config or {},
        })

    export_edges: list[dict] = []
    for edge in orch.edges:
        src_temp = id_map.get(edge.source_node_id)
        tgt_temp = id_map.get(edge.target_node_id)
        if src_temp is None or tgt_temp is None:
            continue
        export_edges.append({
            "source_temp_id": src_temp,
            "target_temp_id": tgt_temp,
            "condition": edge.condition or "",
            "label": edge.label or "",
            "is_default": edge.is_default or False,
        })

    payload = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "orchestration": {
            "name": orch.name,
            "description": orch.description or "",
            "orchestration_type": orch.orchestration_type.value if isinstance(orch.orchestration_type, OrchestrationType) else orch.orchestration_type,
            "config": orch.config or {},
            "is_active": orch.is_active if orch.is_active is not None else True,
            "cron_expression": orch.cron_expression,
            "schedule_enabled": orch.schedule_enabled if orch.schedule_enabled is not None else False,
            "max_retries": orch.max_retries if orch.max_retries is not None else 1,
            "recursion_limit": orch.recursion_limit if orch.recursion_limit is not None else 50,
            "nodes": export_nodes,
            "edges": export_edges,
        },
    }

    content = json.dumps(payload, ensure_ascii=False, indent=2)
    filename = f"{orch.name}.json"
    encoded_filename = quote(filename, safe='')
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.post("/import", response_model=OrchestrationOut, status_code=201)
async def import_orchestration(payload: ImportPayload, db: AsyncSession = Depends(get_db)):
    data = payload.orchestration

    if not data.name.strip():
        raise HTTPException(400, "Orchestration name is required")
    if not data.nodes:
        raise HTTPException(400, "Orchestration must have at least one node")

    # Resolve name conflicts
    base_name = data.name.strip()
    name = base_name
    counter = 1
    while True:
        existing = await db.scalar(select(Orchestration.id).where(Orchestration.name == name))
        if existing is None:
            break
        counter += 1
        name = f"{base_name} ({counter})"

    orch = Orchestration(
        name=name,
        description=data.description,
        orchestration_type=data.orchestration_type,
        config=data.config,
        is_active=data.is_active,
        cron_expression=data.cron_expression,
        schedule_enabled=data.schedule_enabled,
        max_retries=data.max_retries,
        recursion_limit=data.recursion_limit,
    )
    db.add(orch)
    await db.flush()

    # Create nodes
    temp_to_real: dict[str, int] = {}
    for nc in data.nodes:
        node = OrchestrationNode(
            orchestration_id=orch.id,
            node_type=nc.node_type or "agent",
            node_key=nc.node_key or "",
            label=nc.label or "",
            position_x=nc.position_x,
            position_y=nc.position_y,
            config=nc.config or {},
        )
        db.add(node)
        await db.flush()
        if nc.temp_id:
            temp_to_real[nc.temp_id] = node.id

    # Create edges
    for ec in data.edges:
        src_real = temp_to_real.get(ec.source_temp_id)
        tgt_real = temp_to_real.get(ec.target_temp_id)
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
    await add_schedule(orch)
    return _orch_to_out(orch)


# ── Execution ──

@router.post("/{orchestration_id}/execute")
async def execute_orchestration(orchestration_id: int, req: OrchestrationExecuteRequest,
                                 request: Request,
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
    cancel_scope = CancelScope()

    async def event_stream():
        final_result: dict = {}
        final_status = "completed"

        try:
            async for event in execute_orchestration_stream(
                orch, req.message, db, cancel_scope, req.previous_outputs,
            ):
                if await request.is_disconnected():
                    cancel_scope.cancel("stopped")
                    final_status = "stopped"
                    break

                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

                if event["type"] == "orchestration_done":
                    final_result = event.get("result", {})
                    if event.get("failed"):
                        final_status = "failed"

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
                    async with async_session() as s:
                        s.add(OrchestrationRunEvent(
                            run_id=run_id,
                            node_id=node_id,
                            event_type=event["type"],
                            content=content,
                            metadata_=metadata or {},
                        ))
                        await s.commit()

        except Exception as e:
            logger.exception("Orchestration execution failed")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"
            final_status = "failed"

        finally:
            async with async_session() as s:
                r = await s.get(OrchestrationRun, run_id)
                if r and r.status == "running":
                    r.status = final_status
                    r.result = final_result
                    r.completed_at = datetime.now(timezone.utc)
                    await s.commit()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Run History ──

@router.get("/{orchestration_id}/runs", response_model=PaginatedRunListOut)
async def list_runs(
    orchestration_id: int,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")

    base_query = select(OrchestrationRun).where(OrchestrationRun.orchestration_id == orchestration_id)

    total_result = await db.execute(
        select(func.count()).select_from(OrchestrationRun).where(OrchestrationRun.orchestration_id == orchestration_id)
    )
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    result = await db.execute(
        base_query.order_by(OrchestrationRun.created_at.desc()).offset(offset).limit(page_size)
    )
    runs = result.unique().scalars().all()

    total_pages = max(1, (total + page_size - 1) // page_size)

    return PaginatedRunListOut(
        items=[_run_to_out(r) for r in runs],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


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


# ── Workspace ──

def _build_workspace_tree(dir_path: str) -> list[dict]:
    items = []
    try:
        entries = sorted(os.scandir(dir_path), key=lambda e: (not e.is_dir(), e.name))
    except OSError:
        return []
    for entry in entries:
        node: dict = {
            "name": entry.name,
            "path": entry.path,
            "type": "directory" if entry.is_dir() else "file",
            "children": [],
        }
        if entry.is_dir():
            node["children"] = _build_workspace_tree(entry.path)
        items.append(node)
    return items


@router.get("/{orchestration_id}/workspace", response_model=list[WorkspaceTreeItem])
async def get_workspace_tree(orchestration_id: int, db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    ws_dir = os.path.join(WORKSPACE_ROOT, orch.name)
    return _build_workspace_tree(ws_dir)


class TestScriptRequest(BaseModel):
    script: str = ""
    requirements: str = ""


@router.post("/{orchestration_id}/test-script")
async def test_python_script(orchestration_id: int, req: TestScriptRequest,
                              db: AsyncSession = Depends(get_db)):
    orch = await db.get(Orchestration, orchestration_id)
    if not orch:
        raise HTTPException(404, "Orchestration not found")
    from backend.services.orchestration import run_python_script
    ws_dir = os.path.join(WORKSPACE_ROOT, orch.name)
    os.makedirs(ws_dir, exist_ok=True)
    stdout_text, stderr_text, exit_code = await run_python_script(
        req.script, req.requirements, ws_dir,
    )
    return {"stdout": stdout_text, "stderr": stderr_text, "exit_code": exit_code}


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
