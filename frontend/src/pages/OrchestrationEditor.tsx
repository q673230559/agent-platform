import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow, Controls, Background, MiniMap, useNodesState, useEdgesState,
  addEdge, Connection, Node, Edge, BackgroundVariant, MarkerType, Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { orchestrationsApi, providersApi, toolsApi } from '../api/client'
import type { Orchestration, Provider, Tool, OrchestrationForm, OrchestrationType } from '../types'

function fetchProviderModels(providerId: number): Promise<string[]> {
  return providersApi.models(providerId).then(r => r.models).catch(() => [])
}

let nodeCounter = -1
function nextNodeId() { return nodeCounter-- }

const NODE_STYLE: React.CSSProperties = {
  borderRadius: '8px', color: '#e5e7eb', padding: '6px 12px', fontSize: '12px', fontWeight: 500, minWidth: 90,
}

function nodeStyle(nodeType: string): React.CSSProperties {
  if (nodeType === 'start') return { ...NODE_STYLE, background: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgb(52, 211, 153)' }
  if (nodeType === 'end') return { ...NODE_STYLE, background: 'rgba(156, 163, 175, 0.12)', border: '1px solid rgb(107, 114, 128)' }
  return { ...NODE_STYLE, background: '#1f2937', border: '1px solid #4b5563' }
}

function createFlowNode(nodeType: string, label: string, x: number, y: number): Node {
  return {
    id: String(nextNodeId()),
    type: 'default',
    position: { x, y },
    data: {
      node_type: nodeType,
      label,
      config: nodeType === 'agent' ? { provider_id: 0, model_name: '', system_prompt: '', temperature: 0.7, tools: [] } : {},
    },
    style: nodeStyle(nodeType),
  }
}

function orchNodeToFlowNode(n: { id: number; node_type: string; label: string; position_x: number; position_y: number; config: Record<string, unknown> }): Node {
  return {
    id: String(n.id),
    type: 'default',
    position: { x: n.position_x || 0, y: n.position_y || 0 },
    data: { node_type: n.node_type || 'agent', label: n.label || 'Node', config: n.config || {} },
    style: nodeStyle(n.node_type || 'agent'),
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dataLoaded, setDataLoaded] = useState(!isEdit)
  const [providers, setProviders] = useState<Provider[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [customModel, setCustomModel] = useState(false)

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
    const offset = nodes.length > 0 ? 60 : 0
    const x = 100 + offset
    const y = nodeType === 'start' ? 200 : nodeType === 'end' ? 400 : 300
    setNodes((nds: Node[]) => [...nds, createFlowNode(nodeType, label, x, y)])
  }

  const updateNodeConfig = (field: string, value: unknown) => {
    if (!selectedNode) return
    const newConfig = { ...(selectedNode.data.config as Record<string, unknown>), [field]: value }
    setNodes((nds: Node[]) => nds.map((n: Node) => n.id === selectedNode.id ? { ...n, data: { ...n.data, config: newConfig } } : n))
    setSelectedNode((prev: Node | null) => prev ? { ...prev, data: { ...prev.data, config: newConfig } } : null)
  }

  const updateNodeLabel = (value: string) => {
    if (!selectedNode) return
    setNodes((nds: Node[]) => nds.map((n: Node) => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: value } } : n))
    setSelectedNode((prev: Node | null) => prev ? { ...prev, data: { ...prev.data, label: value } } : null)
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
      nodes: nodes.map((n: Node) => ({
        node_type: (n.data.node_type as string) || 'agent',
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

  const toggleTool = (toolName: string) => {
    if (!selectedNode) return
    const cfg = selectedNode.data.config as Record<string, unknown>
    const current = (cfg.tools as string[]) || []
    const next = current.includes(toolName) ? current.filter((t) => t !== toolName) : [...current, toolName]
    updateNodeConfig('tools', next)
  }

  const selCfg = selectedNode ? (selectedNode.data.config as Record<string, unknown>) : {}
  const selType = (selectedNode?.data?.node_type as string) || ''
  const isAgent = selType === 'agent'

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
        <button onClick={handleSave} disabled={saving}
          className={`px-4 py-1.5 text-white text-sm font-medium rounded-lg transition-colors ${saved ? 'bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-500'} disabled:opacity-50`}>
          {saving ? '保存中...' : saved ? '✓ 已保存' : '保存'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onPaneClick={onPaneClick}
            fitView fitViewOptions={{ padding: 0.3, maxZoom: 0.7 }}
            snapToGrid snapGrid={[16, 16]} deleteKeyCode={['Backspace', 'Delete']} multiSelectionKeyCode="Shift"
            defaultEdgeOptions={{ style: { stroke: '#6366f1', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' } }}
          >
            <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
            <MiniMap className="!bg-gray-800 !border-gray-700" maskColor="rgba(0,0,0,0.7)" nodeColor="#6366f1" />
            <Panel position="top-left" className="ml-2 mt-2 flex gap-1.5">
              <button onClick={() => addNode('start', '开始')} disabled={hasStart || !dataLoaded}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors shadow-lg ${hasStart || !dataLoaded ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                ▶ 开始
              </button>
              <button onClick={() => addNode('agent', `Agent ${nodes.filter(n => n.data.node_type === 'agent').length + 1}`)}
                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors shadow-lg">
                + Agent
              </button>
              <button onClick={() => addNode('end', '结束')} disabled={hasEnd || !dataLoaded}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors shadow-lg ${hasEnd || !dataLoaded ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-gray-500 hover:bg-gray-400 text-white'}`}>
                ■ 结束
              </button>
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
          <div className="p-3">
            {selectedNode && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">节点名称</label>
                  <input value={(selectedNode.data.label as string) || ''} onChange={(e) => updateNodeLabel(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                </div>
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    selType === 'start' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' :
                    selType === 'end' ? 'bg-gray-600/20 text-gray-400 border-gray-600/30' :
                    'bg-indigo-600/20 text-indigo-400 border-indigo-600/30'
                  }`}>
                    {selType === 'start' ? '开始节点' : selType === 'end' ? '结束节点' : 'Agent 节点'}
                  </span>
                </div>

                {selType === 'start' && <p className="text-xs text-gray-500">工作流入口，不执行 Agent</p>}
                {selType === 'end' && <p className="text-xs text-gray-500">工作流出口，不执行 Agent</p>}

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
                      <label className="text-xs text-gray-500 block mb-1">System Prompt</label>
                      <textarea value={String(selCfg.system_prompt || '')} onChange={(e) => updateNodeConfig('system_prompt', e.target.value)} rows={4}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500 resize-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1.5">工具</label>
                      <div className="flex flex-wrap gap-1.5">
                        {tools.map(t => {
                          const active = ((selCfg.tools as string[]) || []).includes(t.name)
                          return <button key={t.id} type="button" onClick={() => toggleTool(t.name)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${active ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
                            title={t.description}>{t.display_name || t.name}</button>
                        })}
                        {tools.length === 0 && <p className="text-xs text-gray-600">暂无可用工具</p>}
                      </div>
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
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded bg-gray-800 border-gray-600 accent-indigo-500" />
                  <span className="text-gray-300">激活</span>
                </label>
                <div className="text-xs text-gray-600 pt-2 border-t border-gray-800">
                  <p>节点: {nodes.length} | 连线: {edges.length}</p>
                  <p className="mt-1">▶ 开始 · + Agent · ■ 结束</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
