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
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 20

  const loadRuns = (p: number) => {
    if (!id) return
    setLoading(true)
    orchestrationsApi.runs(Number(id), p, pageSize)
      .then((data) => {
        setRuns(data.items)
        setTotal(data.total)
        setTotalPages(data.total_pages)
        setPage(data.page)
      })
      .catch(() => navigate('/orchestrations'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!id) return
    orchestrationsApi.get(Number(id)).then(setOrch).catch(() => navigate('/orchestrations'))
    loadRuns(1)
  }, [id, navigate])

  const handleDelete = async (e: React.MouseEvent, runId: number) => {
    e.stopPropagation()
    if (!confirm('确认删除此运行记录？')) return
    try {
      await orchestrationsApi.deleteRun(runId)
      setRuns((prev) => prev.filter((r) => r.id !== runId))
      setTotal((prev) => prev - 1)
    } catch {
      alert('删除失败')
    }
  }

  const renderPagination = () => {
    if (totalPages <= 1) return null
    const pages: number[] = []
    const start = Math.max(1, page - 2)
    const end = Math.min(totalPages, page + 2)
    for (let i = start; i <= end; i++) pages.push(i)

    return (
      <div className="flex items-center justify-center gap-2 mt-6">
        <button
          onClick={() => loadRuns(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        {start > 1 && (
          <>
            <button onClick={() => loadRuns(1)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors">1</button>
            {start > 2 && <span className="text-gray-600 text-sm">...</span>}
          </>
        )}
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => loadRuns(p)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              p === page
                ? 'bg-indigo-600 text-white border border-indigo-500'
                : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {p}
          </button>
        ))}
        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="text-gray-600 text-sm">...</span>}
            <button onClick={() => loadRuns(totalPages)} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors">{totalPages}</button>
          </>
        )}
        <button
          onClick={() => loadRuns(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
      </div>
    )
  }

  if (loading && runs.length === 0) {
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
          <p className="text-gray-500 mt-1 text-sm">共 {total} 次运行</p>
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
              onClick={() => navigate(`/orchestrations/${id}/run?runId=${run.id}`)}
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

      {renderPagination()}
    </div>
  )
}
