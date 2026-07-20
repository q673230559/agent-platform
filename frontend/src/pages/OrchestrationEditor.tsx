import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow, Controls, Background, MiniMap, useNodesState, useEdgesState,
  addEdge, Connection, Node, Edge, BackgroundVariant, MarkerType, Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { orchestrationsApi, providersApi, toolsApi } from '../api/client'
import DirectoryTree from '../components/DirectoryTree'
import CodeEditor from '../components/CodeEditor'
import WorkflowNode from '../components/WorkflowNode'
import type { Orchestration, Provider, Tool, OrchestrationForm, OrchestrationType, ImportPayload } from '../types'

function fetchProviderModels(providerId: number): Promise<string[]> {
  return providersApi.models(providerId).then(r => r.models).catch(() => [])
}

let nodeCounter = -1
function nextNodeId() { return nodeCounter-- }

interface ToolDef {
  nodeType: string
  label: string
  icon: string
  description: string
  singleton: boolean
  colorClass: string
  nodeColor: { bg: string; border: string }
  shape: { borderRadius: number; accent?: string }
}

const TOOL_DEFINITIONS: ToolDef[] = [
  {
    nodeType: 'start', label: '开始', icon: '▶', description: '工作流入口节点',
    singleton: true, colorClass: 'emerald',
    nodeColor: { bg: 'rgba(52, 211, 153, 0.15)', border: 'rgb(52, 211, 153)' },
    shape: { borderRadius: 20 },
  },
  {
    nodeType: 'end', label: '结束', icon: '■', description: '工作流出口节点',
    singleton: true, colorClass: 'rose',
    nodeColor: { bg: 'rgba(251, 113, 133, 0.12)', border: 'rgb(251, 113, 133)' },
    shape: { borderRadius: 20 },
  },
  {
    nodeType: 'agent', label: '专家Agent', icon: '🤖', description: '专家 Agent 节点，执行特定任务',
    singleton: false, colorClass: 'indigo',
    nodeColor: { bg: '#1f2937', border: '#4b5563' },
    shape: { borderRadius: 12 },
  },
  {
    nodeType: 'decision_agent', label: '决策Agent', icon: '🧭', description: '决策 Agent 节点，LLM 决定下游执行路径',
    singleton: false, colorClass: 'amber',
    nodeColor: { bg: '#1f2937', border: '#4b5563' },
    shape: { borderRadius: 4 },
  },
  {
    nodeType: 'decision_script', label: '决策脚本', icon: '⚡', description: 'Python 决策脚本，脚本输出决定下游执行路径',
    singleton: false, colorClass: 'cyan',
    nodeColor: { bg: '#1f2937', border: '#4b5563' },
    shape: { borderRadius: 4, accent: 'rgb(34, 211, 238)' },
  },
  {
    nodeType: 'python_script', label: 'Python', icon: '🐍', description: '执行 Python 脚本',
    singleton: false, colorClass: 'blue',
    nodeColor: { bg: '#1f2937', border: '#4b5563' },
    shape: { borderRadius: 2, accent: 'rgb(59, 130, 246)' },
  },
]

const TOOL_COLORS: Record<string, { bg: string; hover: string; border: string; badge: string }> = {
  emerald:  { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-500', border: 'border-emerald-500/30', badge: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' },
  rose:     { bg: 'bg-rose-600', hover: 'hover:bg-rose-500', border: 'border-rose-500/30', badge: 'bg-rose-600/20 text-rose-400 border-rose-600/30' },
  gray:     { bg: 'bg-gray-500', hover: 'hover:bg-gray-400', border: 'border-gray-500/30', badge: 'bg-gray-600/20 text-gray-400 border-gray-600/30' },
  indigo:   { bg: 'bg-indigo-600', hover: 'hover:bg-indigo-500', border: 'border-indigo-500/30', badge: 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30' },
  blue:     { bg: 'bg-blue-600', hover: 'hover:bg-blue-500', border: 'border-blue-500/30', badge: 'bg-blue-600/20 text-blue-400 border-blue-600/30' },
  amber:    { bg: 'bg-amber-600', hover: 'hover:bg-amber-500', border: 'border-amber-500/30', badge: 'bg-amber-600/20 text-amber-400 border-amber-600/30' },
  cyan:     { bg: 'bg-cyan-600', hover: 'hover:bg-cyan-500', border: 'border-cyan-500/30', badge: 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30' },
}

function generateNodeKey(nodeType: string, existingKeys: Set<string>): string {
  const prefixMap: Record<string, string> = {
    agent: 'agent', decision_agent: 'decision_agent', python_script: 'python',
    decision_script: 'decision_script', start: 'start', end: 'end',
  }
  const prefix = prefixMap[nodeType] || nodeType
  let i = 1
  while (existingKeys.has(`${prefix}_${i}`)) i++
  return `${prefix}_${i}`
}

function createFlowNode(nodeType: string, label: string, x: number, y: number, existingKeys: Set<string>): Node {
  let config: Record<string, unknown>
  if (nodeType === 'agent' || nodeType === 'decision_agent') {
    config = { provider_id: 0, model_name: '', system_prompt: '', temperature: 0.7, tools: [] }
  } else if (nodeType === 'python_script' || nodeType === 'decision_script') {
    config = { script: '', requirements: '' }
  } else {
    config = {}
  }
  const nodeKey = generateNodeKey(nodeType, existingKeys)
  existingKeys.add(nodeKey)
  return {
    id: String(nextNodeId()),
    type: 'workflow',
    position: { x, y },
    data: { node_type: nodeType, node_key: nodeKey, label, config },
  }
}

function orchNodeToFlowNode(n: { id: number; node_type: string; node_key?: string; label: string; position_x: number; position_y: number; config: Record<string, unknown> }): Node {
  return {
    id: String(n.id),
    type: 'workflow',
    position: { x: n.position_x || 0, y: n.position_y || 0 },
    data: { node_type: n.node_type || 'agent', node_key: n.node_key || '', label: n.label || 'Node', config: n.config || {} },
  }
}

function orchEdgeToFlowEdge(e: { id: number; source_node_id: number; target_node_id: number; condition: string; label: string; is_default: boolean }): Edge {
  return {
    id: String(e.id), source: String(e.source_node_id), target: String(e.target_node_id),
    label: e.label || e.condition || '',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
    style: { stroke: '#6366f1' },
    data: { condition: e.condition, is_default: e.is_default },
  }
}

function isCronValid(expr: string): boolean {
  if (!expr.trim()) return false
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.every(part => /^[\d\*\/\-,]+$/.test(part))
}

const typeOptions: { value: OrchestrationType; label: string }[] = [
  { value: 'dag', label: 'DAG' }, { value: 'supervisor', label: 'Supervisor' }, { value: 'swarm', label: 'Swarm' },
]

export default function OrchestrationEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [orchType, setOrchType] = useState<OrchestrationType>('dag')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [isActive, setIsActive] = useState(true)
  const [cronExpression, setCronExpression] = useState('')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [maxRetries, setMaxRetries] = useState(1)
  const [recursionLimit, setRecursionLimit] = useState(50)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(!isEdit)
  const [providers, setProviders] = useState<Provider[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [activeTab, setActiveTab] = useState<'properties' | 'workspace'>('properties')
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [modalEditField, setModalEditField] = useState<'script' | 'system_prompt' | 'input_hints' | null>(null)
  const [testRunning, setTestRunning] = useState(false)
  const [testOutput, setTestOutput] = useState('')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const hasStart = nodes.some((n) => n.data.node_type === 'start')
  const hasEnd = nodes.some((n) => n.data.node_type === 'end')

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {})
    toolsApi.list().then(setTools).catch(() => {})
  }, [])

  useEffect(() => {
    const cfg = selectedNode?.data?.config as Record<string, unknown> | undefined
    const pid = cfg?.['provider_id'] as number | undefined
    if (!pid) { setModels([]); return }
    setModelsLoading(true); setModels([])
    fetchProviderModels(pid).then(m => { setModels(m); setModelsLoading(false) })
  }, [selectedNode?.data?.config])

  useEffect(() => {
    if (!id) return
    orchestrationsApi.get(Number(id)).then((orch: Orchestration) => {
      setName(orch.name); setDescription(orch.description)
      setOrchType(orch.orchestration_type); setConfig(orch.config); setIsActive(orch.is_active)
      setCronExpression(orch.cron_expression || '')
      setScheduleEnabled(orch.schedule_enabled)
      setMaxRetries(orch.max_retries ?? 1)
      setRecursionLimit(orch.recursion_limit ?? 50)
      setNodes(orch.nodes.map(orchNodeToFlowNode))
      setEdges(orch.edges.map(orchEdgeToFlowEdge))
      setDataLoaded(true)
    }).catch(() => navigate('/orchestrations'))
  }, [id, navigate, setNodes, setEdges])

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds: Edge[]) => addEdge({ ...conn,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
      style: { stroke: '#6366f1' }, data: { condition: '', is_default: false } }, eds))
  }, [setEdges])

  const onNodeClick = useCallback((_: unknown, node: Node) => { setSelectedNode(node); setSelectedEdge(null) }, [])
  const onEdgeClick = useCallback((_: unknown, edge: Edge) => { setSelectedEdge(edge); setSelectedNode(null) }, [])
  const onPaneClick = useCallback(() => { setSelectedNode(null); setSelectedEdge(null) }, [])

  const addNode = (nodeType: string, label: string) => {
    if (nodeType === 'start' && hasStart) return
    if (nodeType === 'end' && hasEnd) return
    const existingKeys = new Set(nodes.map(n => (n.data.node_key as string) || ''))
    const count = nodes.filter(n => n.data.node_type === nodeType).length
    const x = 100 + count * 220
    const y = nodeType === 'start' ? 200 : nodeType === 'end' ? 400 : 300 + (count % 3) * 120
    setNodes((nds: Node[]) => [...nds, createFlowNode(nodeType, label, x, y, existingKeys)])
  }

  const updateNodeConfig = (field: string, value: unknown) => {
    if (!selectedNode) return
    const nodeId = selectedNode.id
    setNodes((nds: Node[]) => nds.map((n: Node) => {
      if (n.id !== nodeId) return n
      const newConfig = { ...(n.data.config as Record<string, unknown>), [field]: value }
      return { ...n, data: { ...n.data, config: newConfig } }
    }))
    setSelectedNode((prev: Node | null) => {
      if (!prev) return null
      const newConfig = { ...(prev.data.config as Record<string, unknown>), [field]: value }
      return { ...prev, data: { ...prev.data, config: newConfig } }
    })
  }

  const updateNodeLabel = (value: string) => {
    if (!selectedNode) return
    setNodes((nds: Node[]) => nds.map((n: Node) => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: value } } : n))
    setSelectedNode((prev: Node | null) => prev ? { ...prev, data: { ...prev.data, label: value } } : null)
  }

  const updateNodeKey = (value: string) => {
    if (!selectedNode) return
    const sanitized = value.replace(/[^a-zA-Z0-9_]/g, '')
    setNodes((nds: Node[]) => nds.map((n: Node) => n.id === selectedNode.id ? { ...n, data: { ...n.data, node_key: sanitized } } : n))
    setSelectedNode((prev: Node | null) => prev ? { ...prev, data: { ...prev.data, node_key: sanitized } } : null)
  }

  const updateEdgeData = (field: string, value: unknown) => {
    if (!selectedEdge) return
    setEdges((eds: Edge[]) => eds.map((e: Edge) => {
      if (e.id !== selectedEdge.id) return e
      const d = { ...e.data, [field]: value }
      return { ...e, data: d, label: field === 'condition' ? String(value) : field === 'label' ? String(value) : e.label }
    }))
  }

  const deleteSelected = () => {
    if (selectedNode) {
      setNodes((nds: Node[]) => nds.filter((n: Node) => n.id !== selectedNode.id))
      setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.source !== selectedNode.id && e.target !== selectedNode.id))
      setSelectedNode(null)
    }
    if (selectedEdge) { setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.id !== selectedEdge.id)); setSelectedEdge(null) }
  }

  const handleSave = async () => {
    if (!name.trim()) return alert('请输入编排名称')
    setSaving(true)
    const form: OrchestrationForm = {
      name: name.trim(), description, orchestration_type: orchType, config, is_active: isActive,
      cron_expression: cronExpression || null,
      schedule_enabled: scheduleEnabled,
      max_retries: maxRetries,
      recursion_limit: recursionLimit,
      nodes: nodes.map((n: Node) => ({
        node_type: (n.data.node_type as string) || 'agent',
        node_key: (n.data.node_key as string) || '',
        label: (n.data.label as string) || 'Node',
        position_x: Math.round(n.position.x), position_y: Math.round(n.position.y),
        config: n.data.config as Record<string, unknown>,
        temp_id: n.id,
      })),
      edges: edges.map((e: Edge) => ({
        source_node_id: Number(e.source), target_node_id: Number(e.target),
        condition: (e.data?.condition as string) || '', label: (e.label as string) || '',
        is_default: (e.data?.is_default as boolean) || false,
      })),
    }
    try {
      if (isEdit) { await orchestrationsApi.update(Number(id), form) }
      else {
        const result = await orchestrationsApi.create(form)
        navigate(`/orchestrations/${result.id}/edit`, { replace: true })
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const handleExport = async () => {
    if (isEdit && id) {
      try {
        await orchestrationsApi.export(Number(id), name)
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : 'Export failed')
      }
    } else {
      // Build export JSON from current editor state
      const exportNodes = nodes.map((n: Node) => ({
        temp_id: (n.data.node_key as string) || (n.data.label as string) || n.id,
        node_type: (n.data.node_type as string) || 'agent',
        node_key: (n.data.node_key as string) || '',
        label: (n.data.label as string) || '',
        position_x: Math.round(n.position.x),
        position_y: Math.round(n.position.y),
        config: n.data.config as Record<string, unknown>,
      }))
      const exportEdges = edges.map((e: Edge) => {
        const srcNode = nodes.find(n => n.id === e.source)
        const tgtNode = nodes.find(n => n.id === e.target)
        return {
          source_temp_id: (srcNode?.data.node_key as string) || (srcNode?.data.label as string) || e.source,
          target_temp_id: (tgtNode?.data.node_key as string) || (tgtNode?.data.label as string) || e.target,
          condition: (e.data?.condition as string) || '',
          label: (e.label as string) || '',
          is_default: (e.data?.is_default as boolean) || false,
        }
      })
      const payload: ImportPayload = {
        version: 1,
        exported_at: new Date().toISOString(),
        orchestration: {
          name: name.trim() || '未命名编排',
          description,
          orchestration_type: orchType,
          config,
          is_active: isActive,
          cron_expression: cronExpression || null,
          schedule_enabled: scheduleEnabled,
          max_retries: maxRetries,
          recursion_limit: recursionLimit,
          nodes: exportNodes,
          edges: exportEdges,
        },
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || '编排'}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const data: ImportPayload = JSON.parse(text)
      if (!data.version || !data.orchestration) {
        throw new Error('无效的导入文件格式')
      }
      const result = await orchestrationsApi.import(data)
      navigate(`/orchestrations/${result.id}/edit`)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const toggleTool = (toolName: string) => {
    if (!selectedNode) return
    const nodeId = selectedNode.id
    setNodes((nds: Node[]) => nds.map((n: Node) => {
      if (n.id !== nodeId) return n
      const cfg = n.data.config as Record<string, unknown>
      const current = (cfg.tools as string[]) || []
      const next = current.includes(toolName) ? current.filter((t) => t !== toolName) : [...current, toolName]
      return { ...n, data: { ...n.data, config: { ...cfg, tools: next } } }
    }))
    setSelectedNode((prev: Node | null) => {
      if (!prev) return null
      const cfg = prev.data.config as Record<string, unknown>
      const current = (cfg.tools as string[]) || []
      const next = current.includes(toolName) ? current.filter((t) => t !== toolName) : [...current, toolName]
      return { ...prev, data: { ...prev.data, config: { ...cfg, tools: next } } }
    })
  }

  const selCfg = selectedNode ? (selectedNode.data.config as Record<string, unknown>) : {}
  const selType = (selectedNode?.data?.node_type as string) || ''
  function singletonExists(nodeType: string): boolean {
    if (nodeType === 'start') return hasStart
    if (nodeType === 'end') return hasEnd
    return false
  }

  const handleTestRun = async () => {
    if (!isEdit || !selectedNode) return
    const cfg = selectedNode.data.config as Record<string, unknown>
    setTestRunning(true)
    setTestOutput('Running...')
    try {
      const result = await orchestrationsApi.testScript(Number(id), {
        script: String(cfg.script || ''),
        requirements: String(cfg.requirements || ''),
      })
      const out = result.stdout || ''
      const err = result.stderr || ''
      let display = out
      if (err) display += (display ? '\n' : '') + '--- STDERR ---\n' + err
      if (result.exit_code !== 0) display += `\n(exit code: ${result.exit_code})`
      setTestOutput(display || '(no output)')
    } catch (e: unknown) {
      setTestOutput(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setTestRunning(false)
    }
  }

  const isAgent = selType === 'agent' || selType === 'decision_agent'
  const isDecision = selType === 'decision_agent' || selType === 'decision_script'
  const isPython = selType === 'python_script' || selType === 'decision_script'
  const isDecisionScript = selType === 'decision_script'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <button onClick={() => navigate('/orchestrations')} className="text-gray-500 hover:text-gray-300 text-sm">← 返回</button>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="编排名称"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm w-40 focus:outline-none focus:border-indigo-500" />
        <select value={orchType} onChange={(e) => setOrchType(e.target.value as OrchestrationType)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-200 text-sm focus:outline-none focus:border-indigo-500">
          {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="flex-1" />
        <button
          onClick={handleImportClick}
          disabled={importing}
          className="px-3 py-1.5 text-gray-300 text-sm font-medium rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
        >
          {importing ? '导入中...' : '导入'}
        </button>
        <button onClick={handleExport}
          className="px-3 py-1.5 text-gray-300 text-sm font-medium rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
        >
          导出
        </button>
        <button onClick={handleSave} disabled={saving}
          className={`px-4 py-1.5 text-white text-sm font-medium rounded-lg transition-colors ${saved ? 'bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-500'} disabled:opacity-50`}>
          {saving ? '保存中...' : saved ? '✓ 已保存' : '保存'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onPaneClick={onPaneClick}
            nodeTypes={{ workflow: WorkflowNode }}
            fitView fitViewOptions={{ padding: 0.3, maxZoom: 0.7 }}
            snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode="Shift"
            defaultEdgeOptions={{ style: { stroke: '#6366f1', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' } }}
          >
            <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
            <MiniMap className="!bg-gray-800 !border-gray-700" maskColor="rgba(0,0,0,0.7)" nodeColor="#6366f1" />
            <Panel position="center-left" className="!ml-3">
              <div className="w-36 rounded-xl bg-gray-900/85 backdrop-blur border border-gray-800 shadow-xl shadow-black/30 p-2.5 space-y-3">
                {/* Flow control section */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1 mb-1.5">流程控制</div>
                  {TOOL_DEFINITIONS.filter(t => t.nodeType === 'start' || t.nodeType === 'end').map(def => {
                    const disabled = singletonExists(def.nodeType) || !dataLoaded
                    const colors = TOOL_COLORS[def.colorClass]
                    const label = def.label
                    return (
                      <button key={def.nodeType} onClick={() => addNode(def.nodeType, label)} disabled={disabled}
                        title={def.description}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all shadow-lg ${disabled ? 'bg-gray-800/50 text-gray-600 cursor-not-allowed border border-gray-800' : `${colors.bg} ${colors.hover} text-white ${colors.border} border active:scale-95`}`}>
                        <span className="text-sm shrink-0">{def.icon}</span><span>{label}</span>
                      </button>
                    )
                  })}
                </div>
                {/* Divider */}
                <div className="border-t border-gray-800" />
                {/* Execution tools section — Expert Agents */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1 mb-1.5">执行工具</div>
                  {TOOL_DEFINITIONS.filter(t => !t.singleton && t.nodeType !== 'decision_agent' && t.nodeType !== 'end').map(def => {
                    const colors = TOOL_COLORS[def.colorClass]
                    const count = nodes.filter(n => n.data.node_type === def.nodeType).length + 1
                    const label = def.nodeType === 'agent' ? `专家Agent ${count}` : def.nodeType === 'python_script' ? `Python ${count}` : def.label
                    return (
                      <button key={def.nodeType} onClick={() => addNode(def.nodeType, label)} disabled={!dataLoaded}
                        title={def.description}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all shadow-lg ${!dataLoaded ? 'bg-gray-800/50 text-gray-600 cursor-not-allowed border border-gray-800' : `${colors.bg} ${colors.hover} text-white ${colors.border} border active:scale-95`}`}>
                        <span className="text-sm shrink-0">{def.icon}</span><span>{label}</span>
                      </button>
                    )
                  })}
                </div>
                {/* Divider */}
                <div className="border-t border-gray-800" />
                {/* Decision tools section */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1 mb-1.5">路由控制</div>
                  {TOOL_DEFINITIONS.filter(t => t.nodeType === 'decision_agent' || t.nodeType === 'decision_script').map(def => {
                    const colors = TOOL_COLORS[def.colorClass]
                    const count = nodes.filter(n => n.data.node_type === def.nodeType).length + 1
                    const label = `${def.label} ${count}`
                    return (
                      <button key={def.nodeType} onClick={() => addNode(def.nodeType, label)} disabled={!dataLoaded}
                        title={def.description}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all shadow-lg ${!dataLoaded ? 'bg-gray-800/50 text-gray-600 cursor-not-allowed border border-gray-800' : `${colors.bg} ${colors.hover} text-white ${colors.border} border active:scale-95`}`}>
                        <span className="text-sm shrink-0">{def.icon}</span><span>{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        <div className="w-72 bg-gray-900 border-l border-gray-800 shrink-0 overflow-y-auto">
          <div className="p-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">属性</h3>
            {(selectedNode || selectedEdge) && (
              <button onClick={deleteSelected} className="text-xs text-red-500 hover:text-red-400">删除</button>
            )}
          </div>
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setActiveTab('properties')}
              className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === 'properties'
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              属性
            </button>
            <button
              onClick={() => setActiveTab('workspace')}
              className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === 'workspace'
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              工作空间
            </button>
          </div>
          <div className="p-3">
            {activeTab === 'properties' && (
              <>
            {selectedNode && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">节点名称</label>
                  <input value={(selectedNode.data.label as string) || ''} onChange={(e) => updateNodeLabel(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">节点 ID (变量引用)</label>
                  <input value={(selectedNode.data.node_key as string) || ''} onChange={(e) => updateNodeKey(e.target.value)}
                    placeholder="如 intent_agent"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500" />
                  <p className="text-[10px] text-gray-600 mt-0.5">用于模板变量引用：{`{{节点ID.字段}}`}</p>
                </div>
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    selType === 'start' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' :
                    selType === 'end' ? 'bg-gray-600/20 text-gray-400 border-gray-600/30' :
                    selType === 'decision_script' ? 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30' :
                    selType === 'python_script' ? 'bg-blue-600/20 text-blue-400 border-blue-600/30' :
                    selType === 'decision_agent' ? 'bg-amber-600/20 text-amber-400 border-amber-600/30' :
                    'bg-gray-600/20 text-gray-400 border-gray-600/30'
                  }`}>
                    {selType === 'start' ? '开始节点' : selType === 'end' ? '结束节点' : selType === 'decision_script' ? '决策脚本节点' : selType === 'python_script' ? 'Python 脚本节点' : selType === 'decision_agent' ? '决策 Agent 节点' : '专家 Agent 节点'}
                  </span>
                </div>

                {selType === 'start' && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">工作流入口，用户输入将作为下游节点的变量</p>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-500">输入提示（每行一个，运行页可点击使用）</label>
                        <button
                          onClick={() => setModalEditField('input_hints')}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                          title="全屏编辑"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                          </svg>
                          全屏
                        </button>
                      </div>
                      <textarea
                        value={String(selCfg.input_hints_text || '')}
                        onChange={(e) => updateNodeConfig('input_hints_text', e.target.value)}
                        rows={3}
                        placeholder={"创作今日AI热点文章\n导出本周数据报表"}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-2.5 space-y-1.5 border border-gray-700/50">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">可用模板变量</p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-emerald-400 bg-gray-900 px-1.5 py-0.5 rounded font-mono">{`{{user_prompt}}`}</code>
                          <span className="text-[10px] text-gray-500">用户原始输入（全局别名）</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-emerald-400 bg-gray-900 px-1.5 py-0.5 rounded font-mono">{`{{${(selectedNode.data.node_key as string) || 'start'}}}`}</code>
                          <span className="text-[10px] text-gray-500">通过节点 ID 引用</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {selType === 'end' && <p className="text-xs text-gray-500">工作流出口，不执行 Agent</p>}
                {selType === 'python_script' && <p className="text-xs text-gray-500">在工作流 workspace 中执行 Python 脚本</p>}
                {selType === 'decision_script' && <p className="text-xs text-cyan-400/70">Python 脚本决定下游执行路径，脚本 print 输出的最后一行即为目标节点名称，未选中节点将被跳过</p>}
                {selType === 'decision_agent' && <p className="text-xs text-amber-400/70">LLM 决定下游执行路径，未选中节点将被跳过</p>}
                {selType === 'agent' && <p className="text-xs text-gray-500">执行特定任务，由 LLM 驱动</p>}

                {isAgent && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">模型供应商</label>
                      <select value={String(selCfg.provider_id || '')} onChange={(e) => updateNodeConfig('provider_id', Number(e.target.value))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-gray-200 text-sm focus:outline-none focus:border-indigo-500">
                        <option value="">-- 选择 --</option>
                        {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">模型名称 {modelsLoading && <span className="text-indigo-400">加载中...</span>}</label>
                      {models.length > 0 && !customModel ? (
                        <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                          value={String(selCfg.model_name || '')}
                          onChange={(e) => { if (e.target.value === '_custom_') { setCustomModel(true); updateNodeConfig('model_name', '') } else updateNodeConfig('model_name', e.target.value) }}>
                          <option value="" disabled>选择模型</option>
                          {models.map(m => <option key={m} value={m}>{m}</option>)}
                          <option value="_custom_">+ 手动输入...</option>
                        </select>
                      ) : null}
                      {(customModel || models.length === 0) && (
                        <div className="flex gap-1">
                          <input value={String(selCfg.model_name || '')} onChange={(e) => updateNodeConfig('model_name', e.target.value)}
                            placeholder="gpt-4o / deepseek-chat"
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                          {models.length > 0 && <button onClick={() => { setCustomModel(false); updateNodeConfig('model_name', '') }} className="text-gray-400 hover:text-white text-xs shrink-0 px-1">返回</button>}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Temperature: {String(selCfg.temperature ?? 0.7)}</label>
                      <input type="range" min="0" max="2" step="0.1" value={String(selCfg.temperature ?? 0.7)}
                        onChange={(e) => updateNodeConfig('temperature', Number(e.target.value))} className="w-full accent-indigo-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">递归上限</label>
                      <input
                        key={selectedNode?.id}
                        type="number" min={10} max={500}
                        defaultValue={String(selCfg.recursion_limit ?? 25)}
                        onBlur={(e) => {
                          const raw = parseInt(e.target.value)
                          const v = isNaN(raw) ? 25 : Math.max(10, Math.min(500, raw))
                          e.target.value = String(v)
                          updateNodeConfig('recursion_limit', v)
                        }}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                      />
                      <p className="text-[11px] text-gray-600 mt-0.5">LangGraph 默认 25，复杂任务可设为 50-100</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-500">System Prompt</label>
                        <button
                          onClick={() => setModalEditField('system_prompt')}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                          title="全屏编辑"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                          </svg>
                          全屏
                        </button>
                      </div>
                      <textarea value={String(selCfg.system_prompt || '')} onChange={(e) => updateNodeConfig('system_prompt', e.target.value)} rows={4}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1.5">工具</label>
                      {Object.entries(
                        tools.reduce<Record<string, Tool[]>>((acc, t) => {
                          const cat = t.category || '其他'
                          if (!acc[cat]) acc[cat] = []
                          acc[cat].push(t)
                          return acc
                        }, {})
                      ).map(([cat, catTools]) => (
                        <div key={cat} className="mb-2 last:mb-0">
                          <span className="text-[10px] text-gray-600">{cat}</span>
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            {catTools.map(t => {
                              const active = ((selCfg.tools as string[]) || []).includes(t.name)
                              return <button key={t.id} type="button" onClick={() => toggleTool(t.name)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${active ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
                                title={t.description}>{t.display_name || t.name}</button>
                            })}
                          </div>
                        </div>
                      ))}
                      {tools.length === 0 && <p className="text-xs text-gray-600">暂无可用工具</p>}
                    </div>
                  </>
                )}

                {isPython && (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-500">Python Script</label>
                        <button
                          onClick={() => setModalEditField('script')}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                          title="全屏编辑"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                          </svg>
                          全屏
                        </button>
                      </div>
                      <textarea value={String(selCfg.script || '')} onChange={(e) => updateNodeConfig('script', e.target.value)} rows={10}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
                        placeholder={"# Your Python script\nprint('hello')"} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Pip Requirements（每行一个）</label>
                      <textarea value={String(selCfg.requirements || '')} onChange={(e) => updateNodeConfig('requirements', e.target.value)} rows={3}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
                        placeholder={"requests\nnumpy>=1.21"} />
                    </div>
                  </>
                )}
              </div>
            )}

            {selectedEdge && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">显示标签</label>
                  <input value={(selectedEdge.label as string) || ''} onChange={(e) => updateEdgeData('label', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">路由条件</label>
                  <textarea value={(selectedEdge.data?.condition as string) || ''} onChange={(e) => updateEdgeData('condition', e.target.value)} rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={(selectedEdge.data?.is_default as boolean) || false} onChange={(e) => updateEdgeData('is_default', e.target.checked)}
                    className="rounded bg-gray-800 border-gray-600 accent-indigo-500" />
                  <span className="text-gray-300">默认路由</span>
                </label>
              </div>
            )}

            {!selectedNode && !selectedEdge && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">描述</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" placeholder="描述" />
                </div>

                {/* Scheduling Section */}
                <div className="border-t border-gray-800 pt-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">定时执行</span>
                    <button
                      type="button"
                      onClick={() => setScheduleEnabled(!scheduleEnabled)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${scheduleEnabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${scheduleEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </label>
                </div>

                {scheduleEnabled && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">
                        Cron 表达式
                        <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer"
                          className="ml-1 text-indigo-400 hover:text-indigo-300" title="打开 Cron 表达式参考">[?]</a>
                      </label>
                      <input
                        value={cronExpression}
                        onChange={(e) => setCronExpression(e.target.value)}
                        placeholder="0 9 * * 1-5"
                        className={`w-full bg-gray-800 border rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none ${
                          cronExpression && !isCronValid(cronExpression) ? 'border-red-500' : 'border-gray-700 focus:border-indigo-500'
                        }`}
                      />
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {[
                          { label: '每小时', value: '0 * * * *' },
                          { label: '每日 9:00', value: '0 9 * * *' },
                          { label: '工作日 9:00', value: '0 9 * * 1-5' },
                          { label: '周一 9:00', value: '0 9 * * 1' },
                        ].map(preset => (
                          <button key={preset.value} type="button"
                            onClick={() => setCronExpression(preset.value)}
                            className="px-2 py-0.5 text-[10px] bg-gray-800 border border-gray-700 rounded text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      {cronExpression && (
                        <p className={`text-[10px] mt-1 ${isCronValid(cronExpression) ? 'text-emerald-500' : 'text-red-400'}`}>
                          {isCronValid(cronExpression) ? '✓ 有效的 Cron 表达式' : '✗ 无效的 Cron 表达式'}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">失败重试次数</label>
                      <input
                        type="number"
                        min={0} max={5}
                        value={maxRetries}
                        onChange={(e) => setMaxRetries(Math.max(0, Math.min(5, parseInt(e.target.value) || 0)))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">默认输入消息</label>
                      <textarea
                        value={(config.schedule_default_input as string) || ''}
                        onChange={(e) => setConfig({ ...config, schedule_default_input: e.target.value })}
                        rows={2}
                        placeholder="定时执行时发送给编排的默认消息"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500 resize-none"
                      />
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded bg-gray-800 border-gray-600 accent-indigo-500" />
                  <span className="text-gray-300">激活</span>
                </label>
                <div className="text-xs text-gray-600 pt-2 border-t border-gray-800">
                  <p>节点: {nodes.length} | 连线: {edges.length}</p>
                  <p className="mt-1">▶ 开始 · ■ 结束 · 🤖 专家 · 🧭 决策 · 🐍 Python</p>
                  {scheduleEnabled && <p className="mt-1 text-indigo-400">⏰ 定时: {cronExpression || '(未设置)'}</p>}
                </div>
              </div>
            )}
              </>
            )}
            {activeTab === 'workspace' && (
              <DirectoryTree orchestrationId={id ? Number(id) : null} />
            )}
          </div>
        </div>
      </div>

      {/* Full-screen Editor Modal */}
      {modalEditField !== null && selectedNode && (isPython || isAgent || selType === 'start') && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-white text-sm font-semibold">
                {modalEditField === 'script' ? '编辑 Python 脚本' : modalEditField === 'system_prompt' ? '编辑 System Prompt' : '编辑输入提示'}
              </span>
              <span className="text-xs text-gray-500">{(selectedNode.data.label as string) || 'Node'}</span>
            </div>
            <div className="flex items-center gap-2">
              {modalEditField === 'script' && (
                <button
                  onClick={handleTestRun}
                  disabled={testRunning || !isEdit}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                    testRunning
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  } disabled:opacity-50`}
                >
                  {testRunning ? (
                    <><span className="animate-spin w-3 h-3 border border-white/30 border-t-white rounded-full" /> 运行中...</>
                  ) : (
                    <>▶ 测试运行</>
                  )}
                </button>
              )}
              <button
                onClick={() => setModalEditField(null)}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                ✕ 关闭
              </button>
            </div>
          </div>

          {/* Editor body */}
          <div className="flex-1 overflow-hidden">
            {modalEditField === 'input_hints' ? (
              <textarea
                value={String(selCfg.input_hints_text || '')}
                onChange={(e) => updateNodeConfig('input_hints_text', e.target.value)}
                placeholder={"创作今日AI热点文章\n导出本周数据报表"}
                className="w-full h-full bg-gray-950 text-white text-sm p-6 focus:outline-none resize-none font-mono leading-relaxed"
              />
            ) : (
              <CodeEditor
                value={String(modalEditField === 'script' ? (selCfg.script || '') : (selCfg.system_prompt || ''))}
                onChange={(v) => updateNodeConfig(modalEditField === 'script' ? 'script' : 'system_prompt', v)}
                placeholder={modalEditField === 'script' ? "# Your Python script\nprint('hello')" : '输入 System Prompt...'}
              />
            )}
          </div>

          {/* Test output panel (script only) */}
          {modalEditField === 'script' && testOutput && (
            <div className="border-t border-gray-800 bg-gray-900 shrink-0" style={{ maxHeight: '30%' }}>
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800">
                <span className="text-xs text-gray-500 font-medium">运行输出</span>
                <button
                  onClick={() => setTestOutput('')}
                  className="text-xs text-gray-600 hover:text-gray-400"
                >
                  清除
                </button>
              </div>
              <pre className={`p-3 text-xs font-mono overflow-auto text-gray-300 whitespace-pre-wrap ${testRunning ? 'animate-pulse' : ''}`}
                style={{ maxHeight: 'calc(30vh - 28px)' }}>
                {testOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
