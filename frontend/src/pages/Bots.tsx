import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { botsApi } from '../api/client'
import type { Bot } from '../types'

function Avatar({ bot }: { bot: Bot }) {
  if (bot.avatar_url) {
    return <img src={bot.avatar_url} alt={bot.name} className="w-12 h-12 rounded-full object-cover bg-gray-800 shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden') }} />
  }
  return (
    <div className="w-12 h-12 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-lg font-bold shrink-0">
      {bot.name.charAt(0)}
    </div>
  )
}

export default function Bots() {
  const [bots, setBots] = useState<Bot[]>([])
  const nav = useNavigate()

  const load = () => botsApi.list().then(setBots).catch(() => {})

  useEffect(() => { load() }, [])

  const remove = async (id: number) => {
    if (!confirm('确定删除此机器人？')) return
    await botsApi.delete(id)
    load()
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">机器人</h2>
        <Link to="/bots/new" className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          创建机器人
        </Link>
      </div>

      {bots.length === 0 && (
        <p className="text-gray-500 text-sm">暂无机器人，点击上方按钮创建。</p>
      )}

      <div className="grid gap-3">
        {bots.map(b => (
          <div key={b.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-4">
            <Avatar bot={b} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-white font-medium">{b.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${b.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-500'}`}>
                  {b.is_active ? '启用' : '停用'}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate mb-1.5">{b.bio || '暂无简介'}</p>
              <div className="flex items-center gap-3 flex-wrap">
                {b.tags.length > 0 && (
                  <div className="flex gap-1">
                    {b.tags.map(t => (
                      <span key={t} className="bg-gray-800 text-gray-400 text-[10px] px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                )}
                <span className="text-[10px] text-gray-600">模型: {b.model_name} &middot; {b.tools.length} 个工具</span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0 ml-2">
              <Link to={`/chat/${b.id}`} className="text-indigo-400 hover:text-indigo-300 text-sm px-3 py-1.5 rounded-lg hover:bg-indigo-500/10 transition-colors">对话</Link>
              <Link to={`/bots/${b.id}/edit`} className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">编辑</Link>
              <button onClick={() => remove(b.id)} className="text-red-400 hover:text-red-300 text-sm px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors">删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
