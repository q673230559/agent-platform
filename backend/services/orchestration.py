import json
import os
import asyncio
import logging
from typing import AsyncIterator, Any
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.models.orchestration import (
    Orchestration, OrchestrationNode, OrchestrationEdge, OrchestrationType,
)
from backend.models.provider import ModelProvider
from backend.services.agent import build_agent

logger = logging.getLogger("orchestration")

_SENTINEL = object()


async def _get_provider_for_node(node: OrchestrationNode, db: AsyncSession) -> ModelProvider:
    cfg = node.config or {}
    pid = cfg.get("provider_id", 0)
    result = await db.execute(select(ModelProvider).where(ModelProvider.id == pid))
    return result.scalar_one()


def _build_node_system_prompt(node: OrchestrationNode, node_outputs: dict[str, str],
                              agent_system_prompt: str = "") -> str:
    system_prompt = agent_system_prompt
    config = node.config or {}

    if config.get("system_prompt_prefix"):
        system_prompt = config["system_prompt_prefix"] + "\n\n" + system_prompt

    if node_outputs:
        ctx = ""
        for label, output in node_outputs.items():
            ctx += f"\n### Output from '{label}':\n{output[:2000]}\n"
        if ctx:
            return f"{system_prompt}\n\n## Context from previous agents:{ctx}"

    return system_prompt


def _topological_levels(nodes: list[OrchestrationNode],
                        edges: list[OrchestrationEdge]) -> list[list[OrchestrationNode]]:
    node_map = {n.id: n for n in nodes}
    incoming_count: dict[int, int] = {n.id: 0 for n in nodes}
    outgoing: dict[int, list[int]] = {n.id: [] for n in nodes}
    for edge in edges:
        if edge.target_node_id in incoming_count:
            incoming_count[edge.target_node_id] += 1
        if edge.source_node_id in outgoing:
            outgoing[edge.source_node_id].append(edge.target_node_id)

    levels: list[list[OrchestrationNode]] = []
    current = [nid for nid, cnt in incoming_count.items() if cnt == 0]
    while current:
        level = [node_map[nid] for nid in current if nid in node_map]
        if not level:
            break
        levels.append(level)
        next_level: list[int] = []
        for nid in current:
            for downstream_id in outgoing.get(nid, []):
                incoming_count[downstream_id] -= 1
                if incoming_count[downstream_id] == 0:
                    next_level.append(downstream_id)
        current = next_level

    return levels


def _get_upstream_outputs(node: OrchestrationNode, edges: list[OrchestrationEdge],
                          node_outputs: dict[str, str]) -> dict[str, str]:
    """Return only the outputs from this node's direct upstream dependencies."""
    node_map = {n.id: n.label for n in []}  # populated below is fine — we use label-based lookup
    upstream_ids = set()
    for edge in edges:
        if edge.target_node_id == node.id:
            upstream_ids.add(edge.source_node_id)
    result: dict[str, str] = {}
    # Map node id → label
    for label, output in node_outputs.items():
        result[label] = output
    return result


async def _stream_agent(
    node: OrchestrationNode,
    user_input: str,
    node_outputs: dict[str, str],
    db: AsyncSession,
    queue: asyncio.Queue,
) -> str:
    """Run a single agent with full token streaming. Events go to queue, returns final output."""
    from backend.services.llm_factory import create_llm
    from backend.tools.registry import registry

    cfg = node.config or {}
    provider_id = cfg.get("provider_id", 0)
    model_name = cfg.get("model_name", "")
    temperature = cfg.get("temperature", 0.7)
    tools_list = cfg.get("tools", [])
    agent_system_prompt = cfg.get("system_prompt", "")

    provider = None
    if provider_id:
        result = await db.execute(select(ModelProvider).where(ModelProvider.id == provider_id))
        provider = result.scalar_one_or_none()
    if not provider:
        raise ValueError(f"Provider {provider_id} not found for node {node.label}")

    llm = create_llm(provider, model_name, temperature)
    tool_fns = [registry.get(t) for t in tools_list if registry.get(t)]
    system_prompt = _build_node_system_prompt(node, node_outputs, agent_system_prompt)
    agent = create_agent(llm, tool_fns, system_prompt=system_prompt)

    input_msg = f"## Task\n{user_input}"
    if node_outputs:
        input_msg += "\n\n## Previous agent outputs"
        for label, output in node_outputs.items():
            input_msg += f"\n### Output from '{label}':\n{output[:2000]}\n"

    await queue.put({
        "type": "node_start",
        "node_id": node.id,
        "node_label": node.label,
    })

    full_output = ""
    node_error = None
    try:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=input_msg)]}, version="v2"
        ):
            kind = event.get("event", "")

            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                token = chunk.content
                if token:
                    if isinstance(token, list):
                        token = "".join(str(t) for t in token if t)
                    if isinstance(token, str) and token:
                        full_output += token
                        await queue.put({
                            "type": "token",
                            "node_id": node.id,
                            "node_label": node.label,
                            "content": token,
                        })

            elif kind == "on_tool_start":
                tc = {
                    "name": event.get("name", ""),
                    "input": event["data"].get("input", {}),
                }
                await queue.put({
                    "type": "tool_call",
                    "node_id": node.id,
                    "node_label": node.label,
                    "content": tc,
                })
    except Exception as e:
        logger.exception(f"Agent {node.label} failed")
        full_output = f"Error: {e}"
        node_error = str(e)

    if node_error:
        await queue.put({
            "type": "node_error",
            "node_id": node.id,
            "node_label": node.label,
            "content": node_error,
        })
    else:
        await queue.put({
            "type": "node_end",
            "node_id": node.id,
            "node_label": node.label,
            "output": full_output,
        })

    return full_output


async def _execute_dag(
    nodes: list[OrchestrationNode],
    edges: list[OrchestrationEdge],
    message: str,
    db: AsyncSession,
) -> AsyncIterator[dict]:
    # Topo sort with all nodes (start/end as placeholders), only execute agents
    levels = _topological_levels(nodes, edges)
    if not levels:
        raise ValueError("DAG has no executable nodes")
    # Filter: only run agent nodes at each level
    levels = [[n for n in level if n.node_type not in ('start', 'end')] for level in levels]
    levels = [l for l in levels if l]
    if not levels:
        raise ValueError("DAG has no executable agent nodes")

    node_outputs: dict[str, str] = {}

    for level_idx, level in enumerate(levels):
        queue: asyncio.Queue = asyncio.Queue()

        async def run_node(n: OrchestrationNode) -> None:
            output = await _stream_agent(n, message, node_outputs, db, queue)
            node_outputs[n.label] = output
            await queue.put(_SENTINEL)

        tasks = [asyncio.create_task(run_node(n)) for n in level]
        sentinel_count = 0
        total = len(tasks)

        while sentinel_count < total:
            event = await queue.get()
            if event is _SENTINEL:
                sentinel_count += 1
            else:
                yield event

        # Ensure all tasks completed without exception
        await asyncio.gather(*tasks, return_exceptions=True)

    yield {
        "type": "orchestration_done",
        "result": {"node_outputs": node_outputs},
    }


async def _execute_supervisor(
    nodes: list[OrchestrationNode],
    edges: list[OrchestrationEdge],
    message: str,
    db: AsyncSession,
) -> AsyncIterator[dict]:
    supervisor_bot_id = None  # determined from config — for now use first node as supervisor
    supervisor_node = nodes[0] if nodes else None
    worker_nodes = nodes[1:] if len(nodes) > 1 else []

    if not supervisor_node:
        raise ValueError("Supervisor orchestration has no nodes")

    max_iterations = 10
    node_outputs: dict[str, str] = {}

    for iteration in range(max_iterations):
        # Ask supervisor to decide
        provider = await _get_provider_for_node(supervisor_node, db)

        worker_list = "\n".join(
            f"- **{w.label}**: {w.config.get('description', 'No description')}" for w in worker_nodes
        )
        supervisor_prompt_text = (
            f"You are a supervisor coordinating workers.\n\n"
            f"## Workers\n{worker_list}\n\n"
            f"## Rules\n"
            f"Analyze the task and decide the next worker or FINISH.\n"
            f"End your response with JSON: {{\"next\": \"<worker_label or FINISH>\", \"instruction\": \"<what the worker should do>\"}}\n"
        )

        from backend.services.llm_factory import create_llm
        cfg = supervisor_node.config or {}
        llm = create_llm(provider, cfg.get("model_name", ""), cfg.get("temperature", 0.7))
        agent = create_agent(llm, [], system_prompt=supervisor_prompt_text)

        history_messages = [HumanMessage(content=message)]

        queue: asyncio.Queue = asyncio.Queue()
        await queue.put({"type": "node_start", "node_id": supervisor_node.id, "node_label": supervisor_node.label})

        full_output = ""
        async for event in agent.astream_events({"messages": history_messages}, version="v2"):
            kind = event.get("event", "")
            if kind == "on_chat_model_stream":
                token = event["data"]["chunk"].content
                if token and isinstance(token, str):
                    full_output += token
                    await queue.put({"type": "token", "node_id": supervisor_node.id, "node_label": supervisor_node.label, "content": token})

        node_outputs[supervisor_node.label] = full_output
        await queue.put({"type": "node_end", "node_id": supervisor_node.id, "node_label": supervisor_node.label, "output": full_output})

        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield event

        # Parse supervisor decision
        next_agent = "FINISH"
        instruction = ""
        try:
            if "{" in full_output and "}" in full_output:
                json_str = full_output[full_output.index("{"):full_output.rindex("}") + 1]
                parsed = json.loads(json_str)
                next_agent = parsed.get("next", "FINISH")
                instruction = parsed.get("instruction", "")
        except (json.JSONDecodeError, IndexError, KeyError, ValueError):
            next_agent = "FINISH"

        if not next_agent or next_agent.upper() == "FINISH":
            break

        # Find and run the selected worker
        selected = next(
            (w for w in worker_nodes if w.label.lower() == next_agent.lower()), None
        )
        if not selected:
            break

        worker_queue: asyncio.Queue = asyncio.Queue()
        output = await _stream_agent(selected, instruction or message, node_outputs, db, worker_queue)
        node_outputs[selected.label] = output
        await worker_queue.put(_SENTINEL)

        while True:
            event = await worker_queue.get()
            if event is _SENTINEL:
                break
            yield event

    yield {
        "type": "orchestration_done",
        "result": {"node_outputs": node_outputs},
    }


async def _execute_swarm(
    nodes: list[OrchestrationNode],
    edges: list[OrchestrationEdge],
    message: str,
    db: AsyncSession,
) -> AsyncIterator[dict]:
    if not nodes:
        raise ValueError("Swarm orchestration has no nodes")

    all_labels = [n.label for n in nodes]
    max_rounds = 20
    node_outputs: dict[str, str] = {}

    current_node = nodes[0]
    for _ in range(max_rounds):
        queue: asyncio.Queue = asyncio.Queue()

        handoff_instruction = (
            f"\n\nIf you need another agent's help, end your response with:\n"
            f'{{"handoff_to": "<agent_label>", "summary": "<context for next agent>"}}\n'
            f"Available agents: {', '.join(all_labels)}"
        )
        full_msg = f"## Task\n{message}" + handoff_instruction

        output = await _stream_agent(current_node, full_msg, node_outputs, db, queue)
        node_outputs[current_node.label] = output
        await queue.put(_SENTINEL)

        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield event

        # Check for handoff
        next_label = ""
        try:
            if "handoff_to" in output:
                json_str = output[output.index("{"):output.rindex("}") + 1]
                parsed = json.loads(json_str)
                next_label = parsed.get("handoff_to", "")
        except (json.JSONDecodeError, IndexError, KeyError, ValueError):
            pass

        if not next_label:
            break

        next_node = next((n for n in nodes if n.label.lower() == next_label.lower()), None)
        if not next_node:
            break
        current_node = next_node

    yield {
        "type": "orchestration_done",
        "result": {"node_outputs": node_outputs},
    }


# ── Helpers ──

# ── Main entry point ──

async def execute_orchestration_stream(
    orchestration: Orchestration,
    message: str,
    db: AsyncSession,
) -> AsyncIterator[dict]:
    nodes = list(orchestration.nodes)
    edges = list(orchestration.edges)

    if not nodes:
        raise ValueError("Orchestration has no nodes")

    # Set up per-orchestration workspace subdirectory
    from backend.config import WORKSPACE_ROOT, set_workspace_override
    workspace_dir = os.path.join(WORKSPACE_ROOT, orchestration.name)
    os.makedirs(workspace_dir, exist_ok=True)
    set_workspace_override(workspace_dir)

    # Yield start event
    yield {
        "type": "orchestration_start",
        "nodes": [
            {"id": n.id, "label": n.label, "node_type": n.node_type or "agent"}
            for n in nodes
        ],
    }

    if orchestration.orchestration_type == OrchestrationType.DAG:
        async for event in _execute_dag(nodes, edges, message, db):
            yield event
    elif orchestration.orchestration_type == OrchestrationType.SUPERVISOR:
        async for event in _execute_supervisor(nodes, edges, message, db):
            yield event
    elif orchestration.orchestration_type == OrchestrationType.SWARM:
        async for event in _execute_swarm(nodes, edges, message, db):
            yield event
    else:
        raise ValueError(f"Unknown orchestration type: {orchestration.orchestration_type}")
