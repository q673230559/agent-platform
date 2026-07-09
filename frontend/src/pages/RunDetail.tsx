import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { orchestrationsApi } from '../api/client'
import type { OrchestrationRun, RunEvent } from '../types'

export default function RunDetail() {
  const { id, runId } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState<OrchestrationRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [labelMap, setLabelMap] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!runId || !id) return
    Promise.all([
      orchestrationsApi.runDetail(Number(runId)),
      orchestrationsApi.get(Number(id)),
    ]).then(([r, orch]) => {
      setRun(r)
      const map: Record<number, string> = {}
      for (const n of orch.nodes) { map[n.id] = n.label || 'Node' }
      setLabelMap(map)
    }).catch(() => navigate(`/orchestrations/${id}/runs`)).finally(() => setLoading(false))
  }, [runId, id, navigate])

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-3">
          <div className="h-8 bg-gray-800 rounded w-64" />
          <div className="h-96 bg-gray-800 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!run) {
    return <div className="p-8 text-gray-500">运行记录不存在</div>
  }

  const events = run.events || []
  const nodeEvents = groupByNode(events, labelMap)

  return (
    <div className="p-8 max-w-3xl">
      <button onClick={() => navigate(`/orchestrations/${id}/runs`)} className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-block">
        ← 返回运行历史
      </button>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
            run.status === 'completed' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' :
            run.status === 'failed' ? 'bg-red-600/20 text-red-400 border-red-600/30' :
            'bg-gray-800 text-gray-400 border-gray-700'
          }`}>
            {run.status === 'completed' ? '已完成' : run.status === 'failed' ? '失败' : run.status}
          </span>
          <span className="text-xs text-gray-600">{run.created_at ? new Date(run.created_at).toLocaleString('zh-CN') : ''}</span>
        </div>
        <p className="text-white font-medium text-sm mb-1">输入消息</p>
        <p className="text-gray-400 text-sm">{run.input_message}</p>
      </div>

      {/* Node execution timeline */}
      <div className="space-y-4">
        {nodeEvents.map((group, idx) => (
          <div key={idx} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-800/50 border-b border-gray-800 flex items-center gap-2">
              <span className="text-sm font-medium text-white">{group.label}</span>
              <span className="text-xs text-gray-500">{group.events.length} 个事件</span>
            </div>
            <div className="p-4 space-y-3">
              {group.events.map((evt, i) => (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    {evt.event_type === 'node_start' && <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />}
                    {evt.event_type === 'node_end' && <span className="inline-block w-2 h-2 rounded-full bg-gray-500" />}
                    {evt.event_type === 'node_error' && <span className="inline-block w-2 h-2 rounded-full bg-red-500" />}
                    {evt.event_type === 'tool_call' && <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />}
                    {!['node_start', 'node_end', 'node_error', 'tool_call'].includes(evt.event_type) && (
                      <span className="inline-block w-2 h-2 rounded-full bg-gray-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-medium ${
                        evt.event_type === 'node_start' ? 'text-indigo-400' :
                        evt.event_type === 'node_end' ? 'text-gray-400' :
                        evt.event_type === 'node_error' ? 'text-red-400' :
                        evt.event_type === 'tool_call' ? 'text-amber-400' : 'text-gray-400'
                      }`}>
                        {evt.event_type === 'node_start' ? '开始执行' :
                         evt.event_type === 'node_end' ? '执行完成' :
                         evt.event_type === 'node_error' ? '执行异常' :
                         evt.event_type === 'tool_call' ? '工具调用' : evt.event_type}
                      </span>
                      <span className="text-[11px] text-gray-600">{evt.created_at ? new Date(evt.created_at).toLocaleTimeString('zh-CN') : ''}</span>
                    </div>
                    {evt.event_type === 'tool_call' && (() => {
                      try {
                        const tc = JSON.parse(evt.content)
                        return (
                          <div className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2 mt-1">
                            <span className="text-amber-400 font-medium">{tc.name}</span>
                            <pre className="text-gray-500 mt-0.5 whitespace-pre-wrap break-all">{JSON.stringify(tc.input, null, 1)}</pre>
                          </div>
                        )
                      } catch {
                        return <p className="text-xs text-gray-500 mt-1 truncate">{evt.content}</p>
                      }
                    })()}
                    {evt.event_type === 'node_end' && evt.content && (
                      <div className="text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-2 mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {evt.content.replace(/^"/, '').replace(/"$/, '').replace(/\\n/g, '\n').replace(/\\"/g, '"')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {nodeEvents.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <p>暂无执行事件记录</p>
        </div>
      )}
    </div>
  )
}

function groupByNode(events: RunEvent[], labelMap: Record<number, string>): { label: string; events: RunEvent[] }[] {
  // Group by node_id instead of sequential order (handles parallel execution)
  const groups = new Map<number, { label: string; events: RunEvent[] }>()
  const order: number[] = []

  for (const e of events) {
    const nid = e.node_id || 0
    if (!groups.has(nid)) {
      order.push(nid)
      groups.set(nid, { label: labelMap[nid] || `Node #${nid || '?'}`, events: [] })
    }
    groups.get(nid)!.events.push(e)
  }

  return order.map((nid) => groups.get(nid)!)
}
