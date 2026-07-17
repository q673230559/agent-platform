import json
import os
import re
import asyncio
import logging
from dataclasses import dataclass, field
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


@dataclass
class CancelScope:
    """Cooperative cancellation token for orchestration execution."""
    event: asyncio.Event = field(default_factory=asyncio.Event)
    reason: str = ""

    @property
    def cancelled(self) -> bool:
        return self.event.is_set()

    def cancel(self, reason: str = "stopped") -> None:
        self.reason = reason
        self.event.set()


async def _get_provider_for_node(node: OrchestrationNode, db: AsyncSession) -> ModelProvider:
    cfg = node.config or {}
    pid = cfg.get("provider_id", 0)
    result = await db.execute(select(ModelProvider).where(ModelProvider.id == pid))
    return result.scalar_one()


def _build_node_system_prompt(node: OrchestrationNode, node_outputs: dict[str, str],
                              agent_system_prompt: str = "") -> str:
    system_prompt = resolve_template_vars(agent_system_prompt, node_outputs)
    config = node.config or {}

    if config.get("system_prompt_prefix"):
        prefix = resolve_template_vars(config["system_prompt_prefix"], node_outputs)
        system_prompt = prefix + "\n\n" + system_prompt

    if node_outputs:
        ctx = ""
        for nk, output in node_outputs.items():
            ctx += f"\n### Output from '{nk}':\n{output[:2000]}\n"
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
    cancel_scope: CancelScope,
    recursion_limit: int = 50,
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
    node_recursion_limit = cfg.get("recursion_limit", recursion_limit)

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

    resolved_input = resolve_template_vars(user_input, node_outputs)
    input_msg = f"## Task\n{resolved_input}"
    if node_outputs:
        input_msg += "\n\n## Previous agent outputs"
        for nk, output in node_outputs.items():
            input_msg += f"\n### Output from '{nk}':\n{output[:2000]}\n"

    await queue.put({
        "type": "node_start",
        "node_id": node.id,
        "node_label": node.label,
    })

    full_output = ""
    node_error = None
    try:
        async for event in agent.astream_events(
            {"messages": [HumanMessage(content=input_msg)]},
            config={"recursion_limit": node_recursion_limit},
            version="v2",
        ):
            kind = event.get("event", "")

            if cancel_scope.cancelled:
                break

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
        cancel_scope.cancel("failed")

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


async def run_python_script(script: str, requirements: str, workspace: str) -> tuple[str, str, int]:
    """Execute Python script in sandbox container. Returns (stdout, stderr, exit_code)."""
    import tempfile

    from backend.sandbox.executor import get_executor

    executor = get_executor()

    # Build a single shell command: install requirements then run script
    cmd_parts = []
    if requirements and requirements.strip():
        for req in requirements.strip().split("\n"):
            req = req.strip()
            if req:
                cmd_parts.append(f"pip install {req}")

    if not script or not script.strip():
        if cmd_parts:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, executor.execute, " && ".join(cmd_parts), 120, workspace)
        return "(empty script)\n", "", 0

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", dir=workspace,
        delete=False, encoding="utf-8",
    ) as f:
        f.write(script)
        script_path = f.name

    try:
        cmd_parts.append(f"python {script_path}")
        full_cmd = " && ".join(cmd_parts)
        loop = asyncio.get_running_loop()
        stdout, stderr, exit_code = await loop.run_in_executor(
            None, executor.execute, full_cmd, 120, workspace,
        )
        return stdout, stderr, exit_code
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass


async def _execute_python_script(
    node: OrchestrationNode,
    node_outputs: dict[str, str],
    queue: asyncio.Queue,
    cancel_scope: CancelScope,
) -> str:
    """Execute a python_script node streaming events to the queue."""
    from backend.config import get_workspace

    if cancel_scope.cancelled:
        await queue.put({
            "type": "node_skip",
            "node_id": node.id,
            "node_label": node.label,
        })
        return ""

    cfg = node.config or {}
    raw_script = cfg.get("script", "")
    script = resolve_template_vars(raw_script, node_outputs)
    requirements = cfg.get("requirements", "")
    workspace = get_workspace()

    # Build context variables for the script
    context_header = "# --- 上下文变量（由系统注入）---\n"
    context_header += "import json\n"
    context_header += f"node_outputs = {json.dumps(node_outputs, ensure_ascii=False)}\n"
    context_header += f"upstream_keys = {json.dumps(list(node_outputs.keys()), ensure_ascii=False)}\n"
    context_header += "# --- 用户脚本 ---\n\n"
    full_script = context_header + script

    await queue.put({
        "type": "node_start",
        "node_id": node.id,
        "node_label": node.label,
    })

    try:
        stdout_text, stderr_text, exit_code = await run_python_script(full_script, requirements, workspace)

        if stdout_text:
            for line in stdout_text.splitlines(keepends=True):
                await queue.put({
                    "type": "token", "node_id": node.id,
                    "node_label": node.label, "content": line,
                })

        if exit_code != 0:
            error_msg = stderr_text or f"Script exited with code {exit_code}"
            raise RuntimeError(error_msg)

    except Exception as e:
        logger.exception(f"Python script node {node.label} failed")
        cancel_scope.cancel("failed")
        await queue.put({
            "type": "node_error",
            "node_id": node.id,
            "node_label": node.label,
            "content": str(e),
        })
        return f"Error: {e}"

    await queue.put({
        "type": "node_end",
        "node_id": node.id,
        "node_label": node.label,
        "output": stdout_text,
    })

    return stdout_text


async def _execute_decision_script(
    node: OrchestrationNode,
    node_outputs: dict[str, str],
    user_message: str,
    queue: asyncio.Queue,
    cancel_scope: CancelScope,
) -> str:
    """Execute a Python script that returns the next node label for routing."""
    from backend.config import get_workspace

    if cancel_scope.cancelled:
        await queue.put({
            "type": "node_skip",
            "node_id": node.id,
            "node_label": node.label,
            "reason": "上游节点执行失败",
        })
        return ""

    cfg = node.config or {}
    raw_script = cfg.get("script", "")
    script = resolve_template_vars(raw_script, node_outputs)
    requirements = cfg.get("requirements", "")
    workspace = get_workspace()

    await queue.put({
        "type": "node_start",
        "node_id": node.id,
        "node_label": node.label,
    })

    # Build context variables for the script
    context_header = "# --- 上下文变量（由系统注入）---\n"
    context_header += "import json\n"
    context_header += f"node_outputs = {json.dumps(node_outputs, ensure_ascii=False)}\n"
    context_header += f"user_message = {json.dumps(user_message, ensure_ascii=False)}\n"
    context_header += f"upstream_labels = {json.dumps(list(node_outputs.keys()), ensure_ascii=False)}\n"
    context_header += "# --- 用户脚本 ---\n\n"
    full_script = context_header + script

    try:
        stdout_text, stderr_text, exit_code = await run_python_script(full_script, requirements, workspace)

        if stdout_text:
            for line in stdout_text.splitlines(keepends=True):
                await queue.put({
                    "type": "token", "node_id": node.id,
                    "node_label": node.label, "content": line,
                })

        if exit_code != 0:
            error_msg = stderr_text or f"Script exited with code {exit_code}"
            raise RuntimeError(error_msg)

    except Exception as e:
        logger.exception(f"Decision script node {node.label} failed")
        cancel_scope.cancel("failed")
        await queue.put({
            "type": "node_error",
            "node_id": node.id,
            "node_label": node.label,
            "content": str(e),
        })
        return f"Error: {e}"

    await queue.put({
        "type": "node_end",
        "node_id": node.id,
        "node_label": node.label,
        "output": stdout_text,
    })

    return stdout_text


def _extract_json_objects(text: str) -> list[str]:
    """Extract complete, balanced JSON objects from text."""
    results = []
    i = 0
    while i < len(text):
        if text[i] == '{':
            depth = 0
            j = i
            while j < len(text):
                if text[j] == '{':
                    depth += 1
                elif text[j] == '}':
                    depth -= 1
                    if depth == 0:
                        results.append(text[i:j + 1])
                        break
                j += 1
        i += 1
    return results


def _try_parse_json(text: str) -> dict | None:
    """Attempt to parse text as a JSON object. Returns dict or None."""
    stripped = text.strip()
    try:
        result = json.loads(stripped)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    candidates = _extract_json_objects(text)
    for json_str in reversed(candidates):
        try:
            result = json.loads(json_str)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            continue

    return None


def _get_nested(d: dict, path: str) -> object:
    """Access nested dict using dot notation. Returns None if any key is missing."""
    keys = path.split(".")
    current: object = d
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current


def _stringify(value: object) -> str:
    """Convert a resolved value to its string representation."""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "null"
    return json.dumps(value, ensure_ascii=False)


TEMPLATE_RE = re.compile(r'\{\{(.+?)\}\}')


def resolve_template_vars(text: str, node_outputs: dict[str, str]) -> str:
    """Resolve {{...}} template variables using upstream node JSON outputs.

    Supported syntax:
      {{node_key.field.path}}  — access a specific node's JSON field (dot nesting)
      {{node_key}}              — substitute the full raw output text of a node
      {{field_name}}            — search all upstream outputs for a matching JSON key

    If a variable cannot be resolved, the original {{...}} text is left unchanged.
    If multiple upstream nodes share the same field_name, the last one wins.
    """
    if not text or '{{' not in text:
        return text

    # Build lookup structures from node_outputs
    parsed_outputs: dict[str, dict] = {}  # node_key -> parsed dict
    flat_map: dict[str, object] = {}       # field_name -> value

    for node_key, raw_text in node_outputs.items():
        parsed = _try_parse_json(raw_text)
        if parsed is not None:
            parsed_outputs[node_key] = parsed
            for k, v in parsed.items():
                flat_map[k] = v

    def _replacer(match: re.Match) -> str:
        expr = match.group(1).strip()
        if not expr:
            return match.group(0)

        # {{node_key.field.path}} — explicit node reference with dot notation
        if '.' in expr:
            dot_index = expr.index('.')
            nk = expr[:dot_index]
            field_path = expr[dot_index + 1:]
            if nk in parsed_outputs:
                val = _get_nested(parsed_outputs[nk], field_path)
                if val is not None:
                    return _stringify(val)
            return match.group(0)

        # {{node_key}} — full raw output of a node
        if expr in node_outputs:
            return node_outputs[expr]

        # {{field_name}} — search all upstream JSON keys
        if expr in flat_map:
            return _stringify(flat_map[expr])

        return match.group(0)

    return TEMPLATE_RE.sub(_replacer, text)


def _parse_decision_output(output: str) -> list[str]:
    """Parse agent output for decision JSON: {'next': 'label'} or {'next': ['a','b']}"""
    candidates = _extract_json_objects(output)
    # Also strip markdown code fences before extraction
    for fence in ('```json', '```'):
        if fence in output:
            candidates.extend(_extract_json_objects(
                output[output.index(fence) + len(fence):].split('```', 1)[0]
                if '```' in output[output.index(fence) + len(fence):] else ''
            ))
    for json_str in candidates:
        try:
            parsed = json.loads(json_str)
            next_val = parsed.get('next')
            if next_val is None:
                continue
            if isinstance(next_val, str):
                return [next_val]
            if isinstance(next_val, list):
                return next_val
        except (json.JSONDecodeError, ValueError):
            continue
    return []


def _get_downstream_labels(
    node: OrchestrationNode,
    edges: list[OrchestrationEdge],
    node_map: dict[int, OrchestrationNode],
) -> list[str]:
    """Get the labels of all direct downstream nodes."""
    result: list[str] = []
    for e in edges:
        if e.source_node_id == node.id:
            target = node_map.get(e.target_node_id)
            if target:
                result.append(target.label)
    return result


def _get_upstream_labels(
    node: OrchestrationNode,
    edges: list[OrchestrationEdge],
    node_map: dict[int, OrchestrationNode],
) -> list[str]:
    """Get the labels of all direct upstream nodes."""
    result: list[str] = []
    for e in edges:
        if e.target_node_id == node.id:
            source = node_map.get(e.source_node_id)
            if source:
                result.append(source.label)
    return result


async def _execute_dag(
    nodes: list[OrchestrationNode],
    edges: list[OrchestrationEdge],
    message: str,
    db: AsyncSession,
    cancel_scope: CancelScope,
    recursion_limit: int = 50,
) -> AsyncIterator[dict]:
    node_map = {n.id: n for n in nodes}

    # Only execute nodes reachable from start nodes
    start_nodes = [n for n in nodes if n.node_type == 'start']
    reachable_ids: set[int] = set()
    bfs_queue = [n.id for n in start_nodes]
    while bfs_queue:
        nid = bfs_queue.pop(0)
        if nid in reachable_ids:
            continue
        reachable_ids.add(nid)
        for e in edges:
            if e.source_node_id == nid:
                bfs_queue.append(e.target_node_id)

    # Skip unreachable executable nodes
    unreachable = [n for n in nodes if n.id not in reachable_ids and n.node_type in ('agent', 'decision_agent', 'python_script', 'decision_script')]

    # Only consider reachable nodes and edges for topology
    reachable_nodes = [n for n in nodes if n.id in reachable_ids]
    reachable_edges = [e for e in edges if e.source_node_id in reachable_ids and e.target_node_id in reachable_ids]

    levels = _topological_levels(reachable_nodes, reachable_edges)
    if not levels:
        raise ValueError("DAG has no executable nodes")
    # Filter: only run executable nodes
    levels = [[n for n in level if n.node_type in ('agent', 'decision_agent', 'python_script', 'decision_script')] for level in levels]
    levels = [l for l in levels if l]
    if not levels:
        raise ValueError("DAG has no executable nodes")

    node_outputs: dict[str, str] = {}
    # 把用户输入注册为开始节点输出 + 全局别名，并发出 node_end 事件以便持久化和前端展示
    for n in nodes:
        if n.node_type == 'start':
            node_outputs[n.node_key or n.label] = message
            yield {
                "type": "node_end",
                "node_id": n.id,
                "node_label": n.label,
                "output": message,
            }
    node_outputs["user_prompt"] = message
    active_labels = {n.label for n in nodes}

    # Emit skip events for unreachable executable nodes
    for n in unreachable:
        yield {
            "type": "node_skip",
            "node_id": n.id,
            "node_label": n.label,
            "reason": "未连接到开始节点",
        }

    for level in levels:
        if cancel_scope.cancelled:
            break

        queue: asyncio.Queue = asyncio.Queue()

        # Send skip events for nodes deactivated by upstream decision
        for n in level:
            if n.label not in active_labels:
                await queue.put({
                    "type": "node_skip",
                    "node_id": n.id,
                    "node_label": n.label,
                    "reason": "被上游决策 Agent 跳过",
                })

        active_in_level = [n for n in level if n.label in active_labels]

        async def run_node(n: OrchestrationNode) -> None:
            output: str
            if n.node_type == 'python_script':
                output = await _execute_python_script(n, node_outputs, queue, cancel_scope)
            elif n.node_type == 'decision_script':
                output = await _execute_decision_script(n, node_outputs, message, queue, cancel_scope)
            else:
                output = await _stream_agent(n, message, node_outputs, db, queue, cancel_scope, recursion_limit)
            node_outputs[n.node_key or n.label] = output

            # Decision nodes: parse output and deactivate unselected downstream nodes
            if n.node_type in ('decision_agent', 'decision_script'):
                downstream = _get_downstream_labels(n, edges, node_map)
                selected = _parse_decision_output(output)
                # If JSON parsing failed, try matching output text against downstream labels
                if not selected and downstream:
                    trimmed = output.strip()
                    # Strategy 1: exact match
                    for ds in downstream:
                        if ds.strip() == trimmed:
                            selected = [ds]
                            break
                    # Strategy 2: check last line for exact match (LLMs often put decision on last line)
                    if not selected:
                        last_line = trimmed.split('\n')[-1].strip()
                        for ds in downstream:
                            if ds.strip() == last_line:
                                selected = [ds]
                                break
                    # Strategy 3: substring containment (pick labels that appear in output)
                    if not selected:
                        matches = [ds for ds in downstream if ds.strip() in trimmed]
                        if len(matches) == 1:
                            selected = [matches[0]]
                        elif len(matches) > 1:
                            # Pick the one that appears last (often the final decision)
                            selected = [max(matches, key=lambda m: trimmed.rfind(m.strip()))]
                if selected:
                    # Deactivate direct unselected downstream nodes
                    for ds in downstream:
                        if ds not in selected:
                            active_labels.discard(ds)
                    # Recursively deactivate nodes whose ALL upstream nodes are inactive
                    changed = True
                    while changed:
                        changed = False
                        for check_node in nodes:
                            if check_node.label not in active_labels:
                                continue
                            upstream = _get_upstream_labels(check_node, edges, node_map)
                            if upstream and all(ul not in active_labels for ul in upstream):
                                active_labels.discard(check_node.label)
                                changed = True
            else:
                downstream = _get_downstream_labels(n, edges, node_map)
                for ds in downstream:
                    active_labels.add(ds)

            await queue.put(_SENTINEL)

        tasks = [asyncio.create_task(run_node(n)) for n in active_in_level]
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

        if cancel_scope.cancelled:
            break

    # Emit skip events for end nodes on deactivated branches
    for n in nodes:
        if n.node_type == 'end' and n.label not in active_labels:
            yield {
                "type": "node_skip",
                "node_id": n.id,
                "node_label": n.label,
                "reason": "所有上游节点未执行",
            }

    yield {
        "type": "orchestration_done",
        "result": {"node_outputs": node_outputs},
        "failed": cancel_scope.cancelled and cancel_scope.reason == "failed",
    }


async def _execute_supervisor(
    nodes: list[OrchestrationNode],
    edges: list[OrchestrationEdge],
    message: str,
    db: AsyncSession,
    cancel_scope: CancelScope,
    recursion_limit: int = 50,
) -> AsyncIterator[dict]:
    supervisor_bot_id = None  # determined from config — for now use first node as supervisor
    supervisor_node = nodes[0] if nodes else None
    worker_nodes = nodes[1:] if len(nodes) > 1 else []

    if not supervisor_node:
        raise ValueError("Supervisor orchestration has no nodes")

    max_iterations = 10
    node_outputs: dict[str, str] = {}
    node_outputs["user_prompt"] = message

    for iteration in range(max_iterations):
        if cancel_scope.cancelled:
            break

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
        supervisor_recursion_limit = cfg.get("recursion_limit", recursion_limit)
        llm = create_llm(provider, cfg.get("model_name", ""), cfg.get("temperature", 0.7))
        agent = create_agent(llm, [], system_prompt=supervisor_prompt_text)

        history_messages = [HumanMessage(content=message)]

        queue: asyncio.Queue = asyncio.Queue()
        await queue.put({"type": "node_start", "node_id": supervisor_node.id, "node_label": supervisor_node.label})

        full_output = ""
        async for event in agent.astream_events(
            {"messages": history_messages},
            config={"recursion_limit": supervisor_recursion_limit},
            version="v2",
        ):
            kind = event.get("event", "")
            if kind == "on_chat_model_stream":
                token = event["data"]["chunk"].content
                if token and isinstance(token, str):
                    full_output += token
                    await queue.put({"type": "token", "node_id": supervisor_node.id, "node_label": supervisor_node.label, "content": token})

        node_outputs[supervisor_node.node_key or supervisor_node.label] = full_output
        await queue.put({"type": "node_end", "node_id": supervisor_node.id, "node_label": supervisor_node.label, "output": full_output})

        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield event

        # Parse supervisor decision
        next_agent = "FINISH"
        instruction = ""
        for json_str in _extract_json_objects(full_output):
            try:
                parsed = json.loads(json_str)
                if 'next' in parsed:
                    next_agent = parsed.get("next", "FINISH")
                    instruction = parsed.get("instruction", "")
                    break
            except (json.JSONDecodeError, ValueError):
                continue

        if not next_agent or next_agent.upper() == "FINISH":
            break

        # Find and run the selected worker
        selected = next(
            (w for w in worker_nodes if w.label.lower() == next_agent.lower()), None
        )
        if not selected:
            break

        worker_queue: asyncio.Queue = asyncio.Queue()
        if selected.node_type == 'python_script':
            output = await _execute_python_script(selected, node_outputs, worker_queue, cancel_scope)
        else:
            output = await _stream_agent(selected, instruction or message, node_outputs, db, worker_queue, cancel_scope, recursion_limit)
        node_outputs[selected.node_key or selected.label] = output
        await worker_queue.put(_SENTINEL)

        while True:
            event = await worker_queue.get()
            if event is _SENTINEL:
                break
            yield event

    yield {
        "type": "orchestration_done",
        "result": {"node_outputs": node_outputs},
        "failed": cancel_scope.cancelled and cancel_scope.reason == "failed",
    }


async def _execute_swarm(
    nodes: list[OrchestrationNode],
    edges: list[OrchestrationEdge],
    message: str,
    db: AsyncSession,
    cancel_scope: CancelScope,
    recursion_limit: int = 50,
) -> AsyncIterator[dict]:
    if not nodes:
        raise ValueError("Swarm orchestration has no nodes")

    all_labels = [n.label for n in nodes]
    max_rounds = 20
    node_outputs: dict[str, str] = {}
    node_outputs["user_prompt"] = message

    current_node = nodes[0]
    for _ in range(max_rounds):
        if cancel_scope.cancelled:
            break

        queue: asyncio.Queue = asyncio.Queue()

        handoff_instruction = (
            f"\n\nIf you need another agent's help, end your response with:\n"
            f'{{"handoff_to": "<agent_label>", "summary": "<context for next agent>"}}\n'
            f"Available agents: {', '.join(all_labels)}"
        )
        full_msg = f"## Task\n{message}" + handoff_instruction

        if current_node.node_type == 'python_script':
            output = await _execute_python_script(current_node, node_outputs, queue, cancel_scope)
        else:
            output = await _stream_agent(current_node, full_msg, node_outputs, db, queue, cancel_scope, recursion_limit)
        node_outputs[current_node.node_key or current_node.label] = output
        await queue.put(_SENTINEL)

        while True:
            event = await queue.get()
            if event is _SENTINEL:
                break
            yield event

        # Check for handoff
        next_label = ""
        for json_str in _extract_json_objects(output):
            try:
                parsed = json.loads(json_str)
                if 'handoff_to' in parsed:
                    next_label = parsed.get("handoff_to", "")
                    break
            except (json.JSONDecodeError, ValueError):
                continue

        if not next_label:
            break

        next_node = next((n for n in nodes if n.label.lower() == next_label.lower()), None)
        if not next_node:
            break
        current_node = next_node

    yield {
        "type": "orchestration_done",
        "result": {"node_outputs": node_outputs},
        "failed": cancel_scope.cancelled and cancel_scope.reason == "failed",
    }


# ── Helpers ──

# ── Main entry point ──

async def execute_orchestration_stream(
    orchestration: Orchestration,
    message: str,
    db: AsyncSession,
    cancel_scope: CancelScope,
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
            {"id": n.id, "label": n.label, "node_type": n.node_type or "agent", "node_key": n.node_key or "", "config": n.config or {}}
            for n in nodes
        ],
    }

    recursion_limit = orchestration.recursion_limit or 50

    if orchestration.orchestration_type == OrchestrationType.DAG:
        async for event in _execute_dag(nodes, edges, message, db, cancel_scope, recursion_limit):
            yield event
    elif orchestration.orchestration_type == OrchestrationType.SUPERVISOR:
        async for event in _execute_supervisor(nodes, edges, message, db, cancel_scope, recursion_limit):
            yield event
    elif orchestration.orchestration_type == OrchestrationType.SWARM:
        async for event in _execute_swarm(nodes, edges, message, db, cancel_scope, recursion_limit):
            yield event
    else:
        raise ValueError(f"Unknown orchestration type: {orchestration.orchestration_type}")
