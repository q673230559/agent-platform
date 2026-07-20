import { Node, Edge } from '@xyflow/react'
import type { RunEvent, OrchestrationNodeData } from '../types'

export function topoSortNodeIds(flowNodes: Node[], flowEdges: Edge[]): string[] {
  const successors: Record<string, string[]> = {}
  const incoming: Record<string, number> = {}
  for (const n of flowNodes) { successors[n.id] = []; incoming[n.id] = 0 }
  for (const e of flowEdges) {
    if (successors[e.source]) successors[e.source].push(e.target)
    if (incoming[e.target] !== undefined) incoming[e.target] = (incoming[e.target] || 0) + 1
  }
  const order: string[] = []
  const queue = Object.keys(incoming).filter(id => incoming[id] === 0)
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of (successors[id] || [])) { incoming[next]--; if (incoming[next] === 0) queue.push(next) }
  }
  for (const n of flowNodes) { if (!order.includes(n.id)) order.push(n.id) }

  // Start first, end nodes last, agents in topo order in between
  const startId = flowNodes.find(n => n.data.node_type === 'start')?.id
  const endIds = flowNodes.filter(n => n.data.node_type === 'end').map(n => n.id)
  const display: string[] = []
  if (startId && order.includes(startId)) { display.push(startId); order.splice(order.indexOf(startId), 1) }
  for (const eid of endIds) {
    if (order.includes(eid)) { order.splice(order.indexOf(eid), 1) }
  }
  display.push(...order)
  display.push(...endIds)
  return display
}

export function orchNodeToFlowNode(
  n: { id: number; node_type?: string; label: string; position_x: number; position_y: number },
  status?: string,
): Node {
  return {
    id: String(n.id),
    type: 'workflow',
    position: { x: n.position_x || 0, y: n.position_y || 0 },
    data: { node_id: n.id, label: n.label || 'Node', node_type: n.node_type || 'agent', status: status || 'pending' },
  }
}

export function orchEdgeToFlowEdge(
  e: { id: number; source_node_id: number; target_node_id: number; condition?: string; label?: string },
  animated?: boolean,
  errored?: boolean,
): Edge {
  return {
    id: String(e.id),
    source: String(e.source_node_id),
    target: String(e.target_node_id),
    label: e.label || '',
    animated: animated || false,
    style: { stroke: errored ? '#ef4444' : '#4b5563' },
  }
}

export function deriveNodeStatuses(
  events: RunEvent[],
  nodes: OrchestrationNodeData[],
  runStatus: string,
): Record<number, string> {
  const statuses: Record<number, string> = {}
  for (const n of nodes) statuses[n.id] = 'pending'

  for (const evt of events) {
    const nid = evt.node_id
    if (!nid) continue
    if (evt.event_type === 'node_start' && statuses[nid] === 'pending') {
      statuses[nid] = 'running'
    } else if (evt.event_type === 'node_end') {
      statuses[nid] = 'done'
    } else if (evt.event_type === 'node_error') {
      statuses[nid] = 'error'
    } else if (evt.event_type === 'node_skip') {
      statuses[nid] = 'skipped'
    }
  }

  if (runStatus === 'stopped') {
    for (const nid of Object.keys(statuses)) {
      if (statuses[Number(nid)] === 'running') statuses[Number(nid)] = 'error'
      else if (statuses[Number(nid)] === 'pending') statuses[Number(nid)] = 'skipped'
    }
  }

  return statuses
}

export function derivePreviousOutputs(
  events: RunEvent[],
  nodeKeyMap: Record<number, string>,
): Record<string, string> {
  const outputs: Record<string, string> = {}
  for (const evt of events) {
    if (evt.event_type !== 'node_end' || !evt.node_id) continue
    const key = nodeKeyMap[evt.node_id]
    if (!key) continue
    let content = evt.content || ''
    // Unescape JSON-encoded string content
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'string') content = parsed
    } catch { /* not JSON, use raw content */ }
    outputs[key] = content
  }
  return outputs
}
