import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useNodesState, useEdgesState, Node, Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { orchestrationsApi, orchestrationStream } from '../api/client'
import OrchestrationDAGViewer from '../components/OrchestrationDAGViewer'
import { topoSortNodeIds, orchNodeToFlowNode, orchEdgeToFlowEdge, deriveNodeStatuses, derivePreviousOutputs } from '../utils/orchestration'
import type { Orchestration, RunEvent, OrchestrationRun } from '../types'

// ── helpers ──

function historyKey(orchId: string) { return `orch_input_history_${orchId}` }
function getHistory(orchId: string): string[] {
  try { const r = localStorage.getItem(historyKey(orchId)); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveHistory(orchId: string, text: string) {
  const prev = getHistory(orchId)
  localStorage.setItem(historyKey(orchId), JSON.stringify([text, ...prev.filter(h => h !== text)].slice(0, 20)))
}

function groupEventsByNode(events: RunEvent[], nodes: { id: number; label: string }[]) {
  const labelMap: Record<number, string> = {}
  for (const n of nodes) labelMap[n.id] = n.label || 'Node'
  const groups = new Map<number, { label: string; events: RunEvent[] }>()
  const order: number[] = []
  for (const e of events) {
    const nid = e.node_id || 0
    if (!groups.has(nid)) { order.push(nid); groups.set(nid, { label: labelMap[nid] || `Node #${nid}`, events: [] }) }
    groups.get(nid)!.events.push(e)
  }
  return order.map(nid => {
    const g = groups.get(nid)!
    let status = 'pending'
    for (const e of g.events) {
      if (e.event_type === 'node_end') status = 'done'
      else if (e.event_type === 'node_error') status = 'error'
      else if (e.event_type === 'node_skip') status = 'skipped'
      else if (e.event_type === 'node_start' && status === 'pending') status = 'running'
    }
    return { nodeId: nid, ...g, status }
  })
}

function getDownstreamNodeIds(nodeId: number, edges: { source_node_id: number; target_node_id: number }[]) {
  const downstream = new Set<number>()
  const queue = [nodeId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const e of edges) {
      if (e.source_node_id === cur && !downstream.has(e.target_node_id)) {
        downstream.add(e.target_node_id); queue.push(e.target_node_id)
      }
    }
  }
  return downstream
}

interface NodeOutput {
  nodeId: number; label: string; content: string
  toolCalls: { name: string; input: unknown }[]
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
}

// ── component ──

export default function OrchestrationRun() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [orch, setOrch] = useState<Orchestration | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [nodeOutputs, setNodeOutputs] = useState<NodeOutput[]>([])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [filteredHistory, setFilteredHistory] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const [resumeMode, setResumeMode] = useState(false)
  const [retryMode, setRetryMode] = useState(false)
  const [rerunOutputs, setRerunOutputs] = useState<Record<string, string>>({})
  const resumeRef = useRef<{ outputs: Record<string, string>; active: boolean }>({ outputs: {}, active: false })
  const pendingRunRef = useRef<{ outputs: Record<string, string> } | null>(null)
  const [viewRun, setViewRun] = useState<OrchestrationRun | null>(null)
  const [viewNodeEvents, setViewNodeEvents] = useState<ReturnType<typeof groupEventsByNode>>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: number; status: string } | null>(null)

  const runIdParam = searchParams.get('runId')
  const rerunFromParam = searchParams.get('rerunFromRunId')
  const isViewMode = !!runIdParam
  const showInput = !isViewMode || retryMode

  // ── load orchestration / run data ──

  useEffect(() => {
    if (!id) return
    orchestrationsApi.get(Number(id)).then(o => {
      setOrch(o)
      const flowNodes = o.nodes.map(n => orchNodeToFlowNode(n))
      const flowEdges = o.edges.map(e => orchEdgeToFlowEdge(e))
      setEdges(flowEdges)

      const loadRunId = runIdParam || rerunFromParam
      if (loadRunId) {
        orchestrationsApi.runDetail(Number(loadRunId)).then(prev => {
          const nodeKeyMap: Record<number, string> = {}
          for (const n of o.nodes) nodeKeyMap[n.id] = n.node_key || n.label
          const statuses = deriveNodeStatuses(prev.events || [], o.nodes, prev.status)
          const coloredNodes = o.nodes.map(n => orchNodeToFlowNode(n, statuses[n.id] || 'pending'))

          const fromNodeId = searchParams.get('fromNodeId')
          let outputs = derivePreviousOutputs(prev.events || [], nodeKeyMap)
          // Also mark skipped nodes from original run
          for (const evt of (prev.events || [])) {
            if (evt.event_type === 'node_skip' && evt.node_id) {
              const key = nodeKeyMap[evt.node_id]
              if (key && !(key in outputs)) outputs[key] = ''
            }
          }
          if (fromNodeId) {
            const downstream = getDownstreamNodeIds(Number(fromNodeId), o.edges)
            const filtered: Record<string, string> = {}
            for (const [k, v] of Object.entries(outputs)) {
              const ne = o.nodes.find(n => (n.node_key || n.label) === k)
              if (ne && (ne.id === Number(fromNodeId) || downstream.has(ne.id))) continue
              filtered[k] = v
            }
            outputs = filtered
          }

          if (runIdParam) {
            setViewRun(prev)
            setViewNodeEvents(groupEventsByNode(prev.events || [], o.nodes))
            setNodes(coloredNodes)
          } else {
            setMessage(prev.input_message)
            setResumeMode(true)
            setRerunOutputs(outputs)
            resumeRef.current = { outputs, active: true }
            setNodes(coloredNodes)
            const sortIds = topoSortNodeIds(coloredNodes, flowEdges)
            const idxMap = new Map(sortIds.map((sid, i) => [sid, i]))
            const initOuts = o.nodes.map(n => {
              const key = n.node_key || n.label; const st = statuses[n.id] || 'pending'
              return { nodeId: n.id, label: n.label || 'Node', content: st === 'done' ? (outputs[key] || '') : '', toolCalls: [] as { name: string; input: unknown }[], status: st as NodeOutput['status'] }
            }).sort((a, b) => (idxMap.get(String(a.nodeId)) ?? 99) - (idxMap.get(String(b.nodeId)) ?? 99))
            setNodeOutputs(initOuts)
          }
        }).catch(() => setNodes(flowNodes))
      } else {
        setNodes(flowNodes)
      }

      if (!loadRunId) {
        const sortIds = topoSortNodeIds(flowNodes, flowEdges)
        const idxMap = new Map(sortIds.map((sid, i) => [sid, i]))
        setNodeOutputs(o.nodes.map(n => ({
          nodeId: n.id, label: n.label || 'Node', content: '', toolCalls: [], status: 'pending' as const,
        })).sort((a, b) => (idxMap.get(String(a.nodeId)) ?? 99) - (idxMap.get(String(b.nodeId)) ?? 99)))
      }
    }).catch(() => navigate('/orchestrations')).finally(() => setLoading(false))
  }, [id, navigate, setNodes, setEdges, searchParams, runIdParam, rerunFromParam])

  // ── DAG helpers ──

  const updateNodeStatus = useCallback((nodeId: number, status: string) => {
    setNodes(nds => nds.map(n => n.id !== String(nodeId) ? n : { ...n, data: { ...n.data, status } }))
    setEdges(eds => eds.map(e => {
      const d = (status === 'done' || status === 'error') && e.source === String(nodeId)
      const r = status === 'running' && e.target === String(nodeId)
      const err = status === 'error' && e.source === String(nodeId)
      return { ...e, animated: false, style: { stroke: err ? '#ef4444' : d ? '#34d399' : r ? '#818cf8' : '#374151' } }
    }))
  }, [setNodes, setEdges])

  // ── core execution ──

  const executeRun = (outputs: Record<string, string>) => {
    if (!message.trim() || !id) return
    console.log('[RUN] executeRun called, previous_outputs keys:', Object.keys(outputs), 'count:', Object.keys(outputs).length)
    saveHistory(String(id), message.trim())
    setShowSuggestions(false); setRunning(true); setRetryMode(false)
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: 'pending' } })))
    setEdges(eds => eds.map(e => ({ ...e, animated: false, style: { stroke: '#4b5563' } })))

    const hasOutputs = Object.keys(outputs).length > 0

    controllerRef.current = orchestrationStream(Number(id), message, {
      onStart: sseNodes => {
        if (hasOutputs) {
          const temp: Node[] = sseNodes.map(n => ({ id: String(n.id), type: 'default', position: { x: 0, y: 0 }, data: { node_type: n.node_type } }))
          const sortIds = topoSortNodeIds(temp, edges)
          const idxMap = new Map(sortIds.map((sid, i) => [sid, i]))
          setNodeOutputs(sseNodes.map(n => {
            const key = n.node_key || n.label; const isDone = key in outputs
            return { nodeId: n.id, label: n.label, content: isDone ? (outputs[key] || '') : (n.node_type === 'start' ? '工作流开始' : ''), toolCalls: [], status: (isDone || n.node_type === 'start') ? 'done' as const : 'pending' as const }
          }).sort((a, b) => (idxMap.get(String(a.nodeId)) ?? 99) - (idxMap.get(String(b.nodeId)) ?? 99)))
          const sn = sseNodes.find(n => n.node_type === 'start')
          if (sn) updateNodeStatus(sn.id, 'done')
          return
        }
        const temp: Node[] = sseNodes.map(n => ({ id: String(n.id), type: 'default', position: { x: 0, y: 0 }, data: { node_type: n.node_type } }))
        const sortIds = topoSortNodeIds(temp, edges)
        const idxMap = new Map(sortIds.map((sid, i) => [sid, i]))
        setNodeOutputs(sseNodes.map(n => ({
          nodeId: n.id, label: n.label, content: n.node_type === 'start' ? '工作流开始' : '', toolCalls: [], status: n.node_type === 'start' ? 'done' as const : 'pending' as const,
        })).sort((a, b) => (idxMap.get(String(a.nodeId)) ?? 99) - (idxMap.get(String(b.nodeId)) ?? 99)))
        const sn = sseNodes.find(n => n.node_type === 'start')
        if (sn) updateNodeStatus(sn.id, 'done')
      },
      onNodeStart: (nid) => { updateNodeStatus(nid, 'running'); setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, status: 'running' as const } : o)) },
      onToken: (nid, _l, t) => { setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, content: o.content + t } : o)); outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' }) },
      onToolCall: (nid, _l, d) => { setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, toolCalls: [...o.toolCalls, d as { name: string; input: unknown }] } : o)) },
      onNodeEnd: (nid, _l, out) => { updateNodeStatus(nid, 'done'); setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, status: 'done' as const, content: out || o.content } : o)) },
      onNodeSkip: (nid) => { updateNodeStatus(nid, 'skipped'); setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, status: 'skipped' as const, content: '已跳过（上游决策未选中）' } : o)) },
      onNodeError: (nid, _l, err) => { updateNodeStatus(nid, 'error'); setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, status: 'error' as const, content: o.content + '\n\n❌ ' + err } : o)) },
      onNodeRetry: (nid, _l, msg) => { updateNodeStatus(nid, 'running'); setNodeOutputs(prev => prev.map(o => o.nodeId === nid ? { ...o, status: 'running' as const, content: o.content + '\n\n🔄 ' + msg } : o)) },
      onDone: () => {
        setRunning(false); resumeRef.current = { outputs: {}, active: false }; setResumeMode(false)
        setNodeOutputs(prev => prev.map(o => o.status === 'pending' ? { ...o, status: 'done' as const, content: '工作流结束' } : o))
        setNodes(nds => nds.map(n => n.data.node_type === 'end' ? { ...n, data: { ...n.data, status: n.data.status !== 'skipped' ? 'done' : n.data.status } } : n))
      },
      onStopped: () => {
        setRunning(false); resumeRef.current = { outputs: {}, active: false }; setResumeMode(false)
        setNodeOutputs(prev => prev.map(o => o.status === 'running' ? { ...o, status: 'error' as const, content: o.content + '\n\n[已停止]' } : o.status === 'pending' ? { ...o, status: 'skipped' as const, content: '[已停止]' } : o))
        setNodes(nds => nds.map(n => n.data.status === 'running' ? { ...n, data: { ...n.data, status: 'error' } } : n))
      },
      onError: (err) => { setRunning(false); resumeRef.current = { outputs: {}, active: false }; setResumeMode(false); alert(`执行错误: ${err}`) },
    }, hasOutputs ? outputs : undefined)
  }

  const handleRun = () => {
    const outputs = resumeRef.current.active ? resumeRef.current.outputs : {}
    executeRun(outputs)
  }

  // ── right-click retry ──

  useEffect(() => {
    if (retryMode && pendingRunRef.current && message.trim() && !running) {
      const { outputs } = pendingRunRef.current
      pendingRunRef.current = null
      executeRun(outputs)
    }
  }, [retryMode, message, running])

  const handleRetryFromNode = (nodeId: number) => {
    if (!orch || !viewRun) return
    setCtxMenu(null)
    const nodeKeyMap: Record<number, string> = {}
    for (const n of orch.nodes) nodeKeyMap[n.id] = n.node_key || n.label
    const downstream = getDownstreamNodeIds(nodeId, orch.edges)
    let outputs = derivePreviousOutputs(viewRun.events || [], nodeKeyMap)
    // Also mark nodes that were SKIPPED in original run (by decision) as done
    for (const evt of (viewRun.events || [])) {
      if (evt.event_type === 'node_skip' && evt.node_id) {
        const key = nodeKeyMap[evt.node_id]
        if (key && !(key in outputs)) outputs[key] = ''
      }
    }
    const filtered: Record<string, string> = {}
    for (const [k, v] of Object.entries(outputs)) {
      const ne = orch.nodes.find(n => (n.node_key || n.label) === k)
      if (ne && (ne.id === nodeId || downstream.has(ne.id))) continue
      filtered[k] = v
    }
    console.log('[RETRY] nodeId:', nodeId, 'downstream:', [...downstream], 'allOutputs keys:', Object.keys(outputs), 'filtered keys:', Object.keys(filtered))
    setMessage(viewRun.input_message)
    setResumeMode(true); setRerunOutputs(filtered)
    resumeRef.current = { outputs: filtered, active: true }
    pendingRunRef.current = { outputs: filtered }
    setRetryMode(true)
    setNodes(nds => nds.map(n => {
      const nid = Number(n.id)
      return (nid === nodeId || downstream.has(nid)) ? { ...n, data: { ...n.data, status: 'pending' } } : n
    }))
  }

  const handleNodeContextMenu = useCallback((_: MouseEvent, node: Node) => {
    if (!isViewMode || retryMode) return
    const status = node.data?.status as string
    if (status !== 'error' && status !== 'skipped') return
    setCtxMenu({ x: _.clientX, y: _.clientY, nodeId: Number(node.id), status })
  }, [isViewMode, retryMode])

  const handleStop = () => { controllerRef.current?.abort(); setRunning(false) }

  // ── render ──

  if (loading) return <div className="p-8"><div className="animate-pulse space-y-4"><div className="h-8 bg-gray-800 rounded w-64" /><div className="h-96 bg-gray-800 rounded-xl" /></div></div>
  if (!orch) return <div className="p-8 text-center text-gray-600"><p>编排不存在</p><button onClick={() => navigate('/orchestrations')} className="mt-4 text-indigo-400 hover:text-indigo-300">返回列表</button></div>

  return (
    <div className="h-full flex flex-col" onClick={() => setCtxMenu(null)}>
      {/* top bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <button onClick={() => isViewMode ? navigate(`/orchestrations/${id}/runs`) : navigate('/orchestrations')} className="text-gray-500 hover:text-gray-300 text-sm">← {isViewMode ? '返回历史' : '返回'}</button>
        <span className="text-white font-semibold">{orch.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">{orch.orchestration_type.toUpperCase()}</span>
        {running && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 animate-pulse">Running</span>}
        {isViewMode && !retryMode && !running && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600/20 text-gray-400 border border-gray-600/30">查看历史</span>}
        {(resumeMode || retryMode) && !running && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 border border-amber-600/30">重试模式</span>}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* left: DAG */}
        <div className="flex-1">
          <OrchestrationDAGViewer nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} readOnly={true} onNodeContextMenu={handleNodeContextMenu} />
        </div>

        {/* right panel */}
        <div className="w-[30rem] bg-gray-900 border-l border-gray-800 shrink-0 flex flex-col">
          {showInput ? (<>
            {/* input bar */}
            <div className="p-3 border-b border-gray-800">
              {(() => {
                const sn = orch?.nodes?.find(n => n.node_type === 'start')
                const raw: string = (sn?.config?.input_hints_text as string) || (sn?.config?.input_hints as string[])?.join('\n') || ''
                const hints = raw.split('\n').filter(h => h.trim())
                if (hints.length > 0) return <div className="flex flex-wrap gap-1.5 mb-2">{hints.map((h, i) => <button key={i} onClick={() => { if (!running) setMessage(h) }} disabled={running} className="px-2.5 py-1 text-xs bg-gray-800 border border-gray-700 rounded-full text-gray-400 hover:text-white hover:border-indigo-500 transition-colors disabled:opacity-50">{h}</button>)}</div>
                return null
              })()}
              <div className="flex gap-2 relative">
                <div className="flex-1 relative">
                  <input ref={inputRef} value={message}
                    onChange={e => { setMessage(e.target.value); const v = e.target.value; if (v.trim()) { const h = getHistory(String(id)).filter(x => x.toLowerCase().includes(v.toLowerCase())).slice(0, 5); setFilteredHistory(h); setShowSuggestions(h.length > 0) } else setShowSuggestions(false) }}
                    onFocus={() => { if (message.trim()) { const h = getHistory(String(id)).filter(x => x.toLowerCase().includes(message.toLowerCase())).slice(0, 5); setFilteredHistory(h); setShowSuggestions(h.length > 0) } }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    onKeyDown={e => { if (e.key === 'Enter' && !running) handleRun() }}
                    placeholder={running ? '执行中...' : '输入任务描述...'} disabled={running}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50" />
                  {showSuggestions && filteredHistory.length > 0 && <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 overflow-hidden">{filteredHistory.map((h, i) => <button key={i} onMouseDown={e => { e.preventDefault(); setMessage(h); setShowSuggestions(false); inputRef.current?.focus() }} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors truncate">{h}</button>)}</div>}
                </div>
                {running ? <button onClick={handleStop} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors">停止</button>
                  : <button onClick={handleRun} disabled={!message.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">运行</button>}
              </div>
            </div>
            {/* output panel */}
            <div className="p-3 border-b border-gray-800"><h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">执行输出</h3></div>
            <div ref={outputRef} className="flex-1 overflow-y-auto p-3 space-y-3">
              {nodeOutputs.map(out => (
                <div key={out.nodeId} className={`rounded-lg border p-3 transition-colors ${out.status === 'running' ? 'border-indigo-500/40 bg-indigo-500/5' : out.status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5' : out.status === 'error' ? 'border-red-500/30 bg-red-500/5' : out.status === 'skipped' ? 'border-gray-700/30 bg-gray-800/10' : 'border-gray-800 bg-gray-800/20'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-medium ${out.status === 'running' ? 'text-indigo-400' : out.status === 'done' ? 'text-emerald-400' : out.status === 'error' ? 'text-red-400' : out.status === 'skipped' ? 'text-gray-600' : 'text-gray-600'}`}>{out.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${out.status === 'running' ? 'bg-indigo-500/20 text-indigo-400' : out.status === 'done' ? 'bg-emerald-500/20 text-emerald-400' : out.status === 'error' ? 'bg-red-500/20 text-red-400' : out.status === 'skipped' ? 'bg-gray-500/20 text-gray-500' : 'bg-gray-800 text-gray-600'}`}>{out.status === 'pending' ? '等待' : out.status === 'running' ? '执行中' : out.status === 'error' ? '异常' : out.status === 'skipped' ? '已跳过' : '完成'}</span>
                  </div>
                  {out.toolCalls.length > 0 && <div className="mb-2 space-y-1">{out.toolCalls.map((tc, i) => <div key={i} className="text-xs bg-gray-800 rounded px-2 py-1"><span className="text-amber-400">{tc.name}</span><span className="text-gray-600 ml-1">{JSON.stringify(tc.input).slice(0, 80)}</span></div>)}</div>}
                  {(out.content || out.status === 'running') && <div className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">{out.content || ''}{out.status === 'running' && <span className="animate-pulse text-indigo-400">▊</span>}</div>}
                </div>
              ))}
              {nodeOutputs.every(o => o.status === 'pending') && !running && <p className="text-xs text-gray-600 text-center py-8">输入消息并点击运行，查看多 Agent 协作过程</p>}
            </div>
          </>) : (<>
            {/* view mode: input message + event timeline */}
            <div className="p-4 border-b border-gray-800">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">输入消息</p>
              <p className="text-sm text-gray-300">{viewRun?.input_message}</p>
              {viewRun && <p className="text-xs text-gray-600 mt-2">{viewRun.status === 'completed' ? '已完成' : viewRun.status === 'failed' ? '失败' : viewRun.status === 'stopped' ? '已停止' : viewRun.status}{' · '}{viewRun.created_at ? new Date(viewRun.created_at).toLocaleString('zh-CN') : ''}</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">执行事件</h3><span className="text-xs text-gray-600">右键失败节点可重试</span></div>
              {viewNodeEvents.map((g, idx) => (
                <div key={idx} className="bg-gray-800/50 border border-gray-700/50 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-800/80 border-b border-gray-700/50 flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${g.status === 'done' ? 'bg-emerald-500' : g.status === 'error' ? 'bg-red-500' : g.status === 'running' ? 'bg-indigo-500' : g.status === 'skipped' ? 'bg-gray-500' : 'bg-gray-600'}`} />
                    <span className="text-sm font-medium text-white">{g.label}</span><span className="text-xs text-gray-500">{g.events.length} 个事件</span>
                  </div>
                  <div className="p-3 space-y-2.5">
                    {g.events.map((evt, i) => (
                      <div key={i} className="flex gap-2.5">
                        <div className="shrink-0 mt-0.5">{evt.event_type === 'node_start' ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500" /> : evt.event_type === 'node_end' ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-500" /> : evt.event_type === 'node_error' ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" /> : evt.event_type === 'tool_call' ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" /> : evt.event_type === 'node_skip' ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" /> : <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-500" />}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5"><span className={`text-xs font-medium ${evt.event_type === 'node_start' ? 'text-indigo-400' : evt.event_type === 'node_end' ? 'text-gray-400' : evt.event_type === 'node_error' ? 'text-red-400' : evt.event_type === 'tool_call' ? 'text-amber-400' : evt.event_type === 'node_skip' ? 'text-gray-500' : 'text-gray-400'}`}>{evt.event_type === 'node_start' ? '开始执行' : evt.event_type === 'node_end' ? '执行完成' : evt.event_type === 'node_error' ? '执行异常' : evt.event_type === 'tool_call' ? '工具调用' : evt.event_type === 'node_skip' ? '已跳过' : evt.event_type}</span><span className="text-[11px] text-gray-600">{evt.created_at ? new Date(evt.created_at).toLocaleTimeString('zh-CN') : ''}</span></div>
                          {evt.event_type === 'tool_call' && (() => { try { const tc = JSON.parse(evt.content); return <div className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-1.5 mt-0.5"><span className="text-amber-400 font-medium">{tc.name}</span><pre className="text-gray-500 mt-0.5 whitespace-pre-wrap break-all">{JSON.stringify(tc.input, null, 1)}</pre></div> } catch { return <p className="text-xs text-gray-500 mt-0.5 truncate">{evt.content}</p> } })()}
                          {evt.event_type === 'node_error' && evt.content && <div className="text-xs text-red-300 bg-red-900/20 border border-red-800/50 rounded px-2 py-1.5 mt-0.5 whitespace-pre-wrap leading-relaxed">{evt.content}</div>}
                          {evt.event_type === 'node_skip' && evt.content && <p className="text-xs text-gray-500 mt-0.5">{evt.content}</p>}
                          {evt.event_type === 'node_end' && evt.content && <div className="text-xs text-gray-300 bg-gray-800 rounded px-2 py-1.5 mt-0.5 max-h-80 overflow-y-auto whitespace-pre-wrap leading-relaxed">{evt.content.replace(/^"/, '').replace(/"$/, '').replace(/\\n/g, '\n').replace(/\\"/g, '"')}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {viewNodeEvents.length === 0 && <div className="text-center py-8 text-gray-600"><p className="text-sm">暂无执行事件记录</p></div>}
            </div>
          </>)}
        </div>
      </div>

      {/* context menu */}
      {ctxMenu && <div className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}><button onClick={() => handleRetryFromNode(ctxMenu.nodeId)} className="w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-700 transition-colors">从该节点重试</button></div>}
    </div>
  )
}
