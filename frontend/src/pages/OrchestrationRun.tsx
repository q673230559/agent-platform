import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ReactFlow, Controls, Background, MiniMap, useNodesState, useEdgesState,
  Node, Edge, BackgroundVariant, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { orchestrationsApi, orchestrationStream } from '../api/client'
import WorkflowNode from '../components/WorkflowNode'
import type { Orchestration } from '../types'

interface NodeOutput {
  nodeId: number
  label: string
  content: string
  toolCalls: { name: string; input: unknown }[]
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
}

function topoSortNodeIds(flowNodes: Node[], flowEdges: Edge[]): string[] {
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
  // Add any disconnected nodes
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

function orchNodeToFlowNode(n: { id: number; node_type?: string; label: string; position_x: number; position_y: number }): Node {
  return {
    id: String(n.id),
    type: 'workflow',
    position: { x: n.position_x || 0, y: n.position_y || 0 },
    data: { node_id: n.id, label: n.label || 'Node', node_type: n.node_type || 'agent', status: 'pending' as string },
  }
}

function orchEdgeToFlowEdge(e: { id: number; source_node_id: number; target_node_id: number; condition: string; label: string }): Edge {
  return {
    id: String(e.id),
    source: String(e.source_node_id),
    target: String(e.target_node_id),
    label: e.label || '',
    animated: false,
    style: { stroke: '#4b5563' },
  }
}

export default function OrchestrationRun() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orch, setOrch] = useState<Orchestration | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [nodeOutputs, setNodeOutputs] = useState<NodeOutput[]>([])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const outputRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!id) return
    orchestrationsApi.get(Number(id)).then((orch) => {
      setOrch(orch)
      const flowNodes = orch.nodes.map(orchNodeToFlowNode)
      const flowEdges = orch.edges.map(orchEdgeToFlowEdge)
      setNodes(flowNodes)
      setEdges(flowEdges)
      // Sort output panels by workflow order (start → agents topologically → end)
      const sortedIds = topoSortNodeIds(flowNodes, flowEdges)
      const idToIdx = new Map(sortedIds.map((id, i) => [id, i]))
      const outputs = orch.nodes.map((n) => ({
        nodeId: n.id,
        label: n.label || 'Node',
        content: '',
        toolCalls: [] as { name: string; input: unknown }[],
        status: 'pending' as const,
      })).sort((a, b) => (idToIdx.get(String(a.nodeId)) ?? 99) - (idToIdx.get(String(b.nodeId)) ?? 99))
      setNodeOutputs(outputs)
    }).catch(() => navigate('/orchestrations'))
    .finally(() => setLoading(false))
  }, [id, navigate, setNodes, setEdges])


  const updateNodeStatus = useCallback((nodeId: number, status: string) => {
    setNodes((nds: Node[]) => nds.map((n: Node) => {
      if (n.id !== String(nodeId)) return n
      return { ...n, data: { ...n.data, status } }
    }))
    setEdges((eds: Edge[]) => eds.map((e: Edge) => {
      const sourceDone = (status === 'done' || status === 'error') && e.source === String(nodeId)
      const toRunning = status === 'running' && e.target === String(nodeId)
      const sourceError = status === 'error' && e.source === String(nodeId)
      return {
        ...e,
        animated: false,
        style: {
          stroke: sourceError ? '#ef4444' : sourceDone ? '#34d399' : toRunning ? '#818cf8' : '#374151',
        },
      }
    }))
  }, [setNodes, setEdges])

  const handleRun = () => {
    if (!message.trim() || !id) return
    setRunning(true)
    setNodeOutputs((prev: NodeOutput[]) => prev.map((o: NodeOutput) => ({ ...o, content: '', toolCalls: [], status: 'pending' as const })))
    setNodes((nds: Node[]) => nds.map((n: Node) => ({
      ...n,
      data: { ...n.data, status: 'pending' },
    })))
    setEdges((eds: Edge[]) => eds.map((e: Edge) => ({ ...e, animated: false, style: { stroke: '#4b5563' } })))

    controllerRef.current = orchestrationStream(
      Number(id),
      message,
      {
        onStart: (sseNodes) => {
          // Sort by workflow order: start → agents (topo) → end
          const tempNodes: Node[] = sseNodes.map((n) => ({ id: String(n.id), type: 'default', position: { x: 0, y: 0 }, data: { node_type: n.node_type } }))
          const sortIds = topoSortNodeIds(tempNodes, edges)
          const idxMap = new Map(sortIds.map((id, i) => [id, i]))
          const outputs = sseNodes.map((n) => ({
            nodeId: n.id, label: n.label, content: n.node_type === 'start' ? '工作流开始' : '', toolCalls: [] as { name: string; input: unknown }[], status: n.node_type === 'start' ? 'done' as const : 'pending' as const,
          })).sort((a, b) => (idxMap.get(String(a.nodeId)) ?? 99) - (idxMap.get(String(b.nodeId)) ?? 99))
          setNodeOutputs(outputs)
          // Mark start node as done on canvas
          const startNode = sseNodes.find((n) => n.node_type === 'start')
          if (startNode) updateNodeStatus(startNode.id, 'done')
        },
        onNodeStart: (nodeId, label) => {
          updateNodeStatus(nodeId, 'running')
          setNodeOutputs((prev) => prev.map((o) =>
            o.nodeId === nodeId ? { ...o, status: 'running' as const } : o
          ))
        },
        onToken: (nodeId, _label, token) => {
          setNodeOutputs((prev) => prev.map((o) =>
            o.nodeId === nodeId ? { ...o, content: o.content + token } : o
          ))
          outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
        },
        onToolCall: (nodeId, _label, data) => {
          setNodeOutputs((prev) => prev.map((o) =>
            o.nodeId === nodeId
              ? { ...o, toolCalls: [...o.toolCalls, data as { name: string; input: unknown }] }
              : o
          ))
        },
        onNodeEnd: (nodeId, _label, output) => {
          updateNodeStatus(nodeId, 'done')
          setNodeOutputs((prev) => prev.map((o) =>
            o.nodeId === nodeId
              ? { ...o, status: 'done' as const, content: output || o.content }
              : o
          ))
        },
        onNodeSkip: (nodeId, _label) => {
          updateNodeStatus(nodeId, 'skipped')
          setNodeOutputs((prev) => prev.map((o) =>
            o.nodeId === nodeId ? { ...o, status: 'skipped' as const, content: '已跳过（上游决策未选中）' } : o
          ))
        },
        onNodeError: (nodeId, _label, error) => {
          updateNodeStatus(nodeId, 'error')
          setNodeOutputs((prev) => prev.map((o) =>
            o.nodeId === nodeId
              ? { ...o, status: 'error' as const, content: o.content + '\n\n❌ ' + error }
              : o
          ))
        },
        onDone: (_result) => {
          setRunning(false)
          // Active end nodes → 工作流结束; others lingering pending → 已跳过
          setNodeOutputs((prev) => prev.map((o) => {
            if (o.status === 'pending') {
              return { ...o, status: 'done' as const, content: '工作流结束' }
            }
            return o
          }))
          setNodes((nds) => nds.map((n) => {
            if (n.data.node_type === 'end') {
              const isActive = n.data.status !== 'skipped'
              return { ...n, data: { ...n.data, status: isActive ? 'done' : n.data.status } }
            }
            return n
          }))
        },
        onStopped: () => {
          setRunning(false)
          setNodeOutputs((prev) => prev.map((o) => {
            if (o.status === 'running') {
              return { ...o, status: 'error' as const, content: o.content + '\n\n[已停止]' }
            }
            if (o.status === 'pending') {
              return { ...o, status: 'skipped' as const, content: '[已停止]' }
            }
            return o
          }))
          setNodes((nds) => nds.map((n) => {
            if (n.data.status === 'running') {
              return { ...n, data: { ...n.data, status: 'error' } }
            }
            return n
          }))
        },
        onError: (err) => {
          setRunning(false)
          alert(`执行错误: ${err}`)
        },
      },
    )
  }

  const handleStop = () => {
    controllerRef.current?.abort()
    setRunning(false)
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-800 rounded w-64" />
          <div className="h-96 bg-gray-800 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!orch) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p>编排不存在</p>
        <button onClick={() => navigate('/orchestrations')} className="mt-4 text-indigo-400 hover:text-indigo-300">返回列表</button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <button onClick={() => navigate('/orchestrations')} className="text-gray-500 hover:text-gray-300 text-sm">
          ← 返回
        </button>
        <span className="text-white font-semibold">{orch.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
          {orch.orchestration_type.toUpperCase()}
        </span>
        {running && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 animate-pulse">
            Running
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Graph (read-only) */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 0.7 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodeTypes={{ workflow: WorkflowNode }}
          >
            <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
            <MiniMap
              className="!bg-gray-800 !border-gray-700"
              maskColor="rgba(0,0,0,0.7)"
              nodeColor={(node: Node) => {
                const status = node.data?.status as string
                if (status === 'error') return '#ef4444'
                if (status === 'done') return '#34d399'
                if (status === 'running') return '#818cf8'
                if (status === 'skipped') return '#6b7280'
                return '#374151'
              }}
            />
          </ReactFlow>
        </div>

        {/* Right: Output panel */}
        <div className="w-96 bg-gray-900 border-l border-gray-800 shrink-0 flex flex-col">
          <div className="p-3 border-b border-gray-800">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">执行输出</h3>
          </div>
          <div ref={outputRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {nodeOutputs.map((out) => (
              <div
                key={out.nodeId}
                className={`rounded-lg border p-3 transition-colors ${
                  out.status === 'running'
                    ? 'border-indigo-500/40 bg-indigo-500/5 animate-pulse-glow'
                    : out.status === 'done'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : out.status === 'error'
                    ? 'border-red-500/30 bg-red-500/5'
                    : out.status === 'skipped'
                    ? 'border-gray-700/30 bg-gray-800/10'
                    : 'border-gray-800 bg-gray-800/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium ${
                    out.status === 'running' ? 'text-indigo-400' :
                    out.status === 'done' ? 'text-emerald-400' :
                    out.status === 'error' ? 'text-red-400' :
                    out.status === 'skipped' ? 'text-gray-600' : 'text-gray-600'
                  }`}>
                    {out.label}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    out.status === 'running' ? 'bg-indigo-500/20 text-indigo-400' :
                    out.status === 'done' ? 'bg-emerald-500/20 text-emerald-400' :
                    out.status === 'error' ? 'bg-red-500/20 text-red-400' :
                    out.status === 'skipped' ? 'bg-gray-500/20 text-gray-500' :
                    'bg-gray-800 text-gray-600'
                  }`}>
                    {out.status === 'pending' ? '等待' : out.status === 'running' ? '执行中' : out.status === 'error' ? '异常' : out.status === 'skipped' ? '已跳过' : '完成'}
                  </span>
                </div>

                {/* Tool calls */}
                {out.toolCalls.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {out.toolCalls.map((tc, i) => (
                      <div key={i} className="text-xs bg-gray-800 rounded px-2 py-1">
                        <span className="text-amber-400">🔧 {tc.name}</span>
                        <span className="text-gray-600 ml-1">
                          {JSON.stringify(tc.input).slice(0, 80)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Output content */}
                {(out.content || (out.status === 'running')) && (
                  <div className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                    {out.content || ''}
                    {out.status === 'running' && <span className="animate-pulse text-indigo-400">▊</span>}
                  </div>
                )}
              </div>
            ))}

            {nodeOutputs.every((o) => o.status === 'pending') && !running && (
              <p className="text-xs text-gray-600 text-center py-8">输入消息并点击运行，查看多 Agent 协作过程</p>
            )}
          </div>

          {/* Input bar */}
          <div className="p-3 border-t border-gray-800">
            {(() => {
              const startNode = orch?.nodes?.find(n => n.node_type === 'start')
              const raw: string = (startNode?.config?.input_hints_text as string) || (startNode?.config?.input_hints as string[])?.join('\n') || ''
              const hints = raw.split('\n').filter(h => h.trim())
              if (hints.length === 0) return null
              return (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {hints.map((hint, i) => (
                    <button
                      key={i}
                      onClick={() => { if (!running) setMessage(hint) }}
                      disabled={running}
                      className="px-2.5 py-1 text-xs bg-gray-800 border border-gray-700 rounded-full text-gray-400 hover:text-white hover:border-indigo-500 transition-colors disabled:opacity-50"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              )
            })()}
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !running) handleRun() }}
                placeholder={running ? '执行中...' : '输入任务描述...'}
                disabled={running}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              {running ? (
                <button
                  onClick={handleStop}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={!message.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                >
                  运行
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

