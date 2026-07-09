import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { orchestrationsApi } from '../api/client'
import type { Orchestration } from '../types'

const typeLabels: Record<string, { label: string; color: string }> = {
  supervisor: { label: 'Supervisor', color: 'bg-purple-600/20 text-purple-400 border-purple-600/30' },
  dag: { label: 'DAG', color: 'bg-blue-600/20 text-blue-400 border-blue-600/30' },
  swarm: { label: 'Swarm', color: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30' },
}

export default function Orchestrations() {
  const [items, setItems] = useState<Orchestration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const load = async () => {
    try {
      const data = await orchestrationsApi.list()
      setItems(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此编排？')) return
    try {
      await orchestrationsApi.delete(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-800 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">任务编排</h2>
          <p className="text-gray-500 mt-1 text-sm">多 Agent 协作编排，支持 Supervisor / DAG / Swarm 模式</p>
        </div>
        <button
          onClick={() => navigate('/orchestrations/new')}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 创建编排
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <p className="text-4xl mb-4">◎</p>
          <p>暂无编排，点击上方按钮创建</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const typeInfo = typeLabels[item.orchestration_type] || typeLabels.dag
            return (
              <div
                key={item.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between group hover:border-gray-700 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-2xl">◎</span>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold">{item.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      {!item.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-sm">
                      {item.description || '暂无描述'} · {item.nodes?.length || 0} 个节点 · {item.edges?.length || 0} 条连线
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => navigate(`/orchestrations/${item.id}/run`)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg transition-colors"
                  >
                    运行
                  </button>
                  <button
                    onClick={() => navigate(`/orchestrations/${item.id}/runs`)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-colors"
                  >
                    历史
                  </button>
                  <button
                    onClick={() => navigate(`/orchestrations/${item.id}/edit`)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded-lg transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-red-800 text-gray-200 text-xs rounded-lg transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
