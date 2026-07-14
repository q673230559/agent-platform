import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { orchestrationsApi } from '../api/client'
import type { Orchestration, OrchestrationRun } from '../types'

export default function RunHistory() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orch, setOrch] = useState<Orchestration | null>(null)
  const [runs, setRuns] = useState<OrchestrationRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      orchestrationsApi.get(Number(id)),
      orchestrationsApi.runs(Number(id)),
    ]).then(([o, r]) => {
      setOrch(o)
      setRuns(r)
    }).catch(() => navigate('/orchestrations'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  const handleDelete = async (e: React.MouseEvent, runId: number) => {
    e.stopPropagation()
    if (!confirm('确认删除此运行记录？')) return
    try {
      await orchestrationsApi.deleteRun(runId)
      setRuns((prev) => prev.filter((r) => r.id !== runId))
    } catch (err) {
      alert('删除失败')
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-20 bg-gray-800 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <button onClick={() => navigate('/orchestrations')} className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-block">
        ← 返回编排列表
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{orch?.name || '编排'} · 运行历史</h2>
          <p className="text-gray-500 mt-1 text-sm">共 {runs.length} 次运行</p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <p className="text-3xl mb-3">📋</p>
          <p>暂无运行记录</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              onClick={() => navigate(`/orchestrations/${id}/runs/${run.id}`)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-gray-700 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    run.status === 'completed' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' :
                    run.status === 'failed' ? 'bg-red-600/20 text-red-400 border-red-600/30' :
                    run.status === 'stopped' ? 'bg-amber-600/20 text-amber-400 border-amber-600/30' :
                    'bg-gray-800 text-gray-400 border-gray-700'
                  }`}>
                    {run.status === 'completed' ? '完成' : run.status === 'failed' ? '失败' : run.status === 'stopped' ? '已停止' : run.status}
                  </span>
                  <span className="text-xs text-gray-600">
                    {run.events?.filter((e) => e.event_type === 'node_start').length || 0} 个节点
                  </span>
                  <span className="text-xs text-gray-600">{run.created_at ? new Date(run.created_at).toLocaleString('zh-CN') : ''}</span>
                </div>
                <p className="text-sm text-gray-400 truncate">{run.input_message}</p>
                {(() => {
                  const outputs = run.result?.node_outputs as Record<string, string> | undefined
                  if (!outputs) return null
                  return (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {Object.entries(outputs).map(([label, output]) => (
                        <span key={label} className="text-[11px] text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
                          {label}: {output.slice(0, 40)}...
                        </span>
                      ))}
                    </div>
                  )
                })()}
              </div>
              <button
                onClick={(e) => handleDelete(e, run.id)}
                className="text-xs text-gray-600 hover:text-red-400 ml-3 shrink-0 px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
