import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { botsApi } from '../api/client'
import type { Bot } from '../types'

export default function Bots() {
  const [bots, setBots] = useState<Bot[]>([])
  const nav = useNavigate()

  const load = () => botsApi.list().then(setBots).catch(() => {})

  useEffect(() => { load() }, [])

  const remove = async (id: number) => {
    if (!confirm('Delete this bot?')) return
    await botsApi.delete(id)
    load()
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Bots</h2>
        <Link to="/bots/new" className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          Create Bot
        </Link>
      </div>

      {bots.length === 0 && (
        <p className="text-gray-500 text-sm">No bots yet. Create your first bot.</p>
      )}

      <div className="grid gap-3">
        {bots.map(b => (
          <div key={b.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <p className="text-white font-medium">{b.name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${b.is_active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-500'}`}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate">Model: {b.model_name} &middot; {b.tools.length} tools</p>
            </div>
            <div className="flex gap-1 shrink-0 ml-4">
              <Link to={`/chat/${b.id}`} className="text-indigo-400 hover:text-indigo-300 text-sm px-3 py-1.5 rounded-lg hover:bg-indigo-500/10 transition-colors">Chat</Link>
              <Link to={`/bots/${b.id}/edit`} className="text-gray-400 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">Edit</Link>
              <button onClick={() => remove(b.id)} className="text-red-400 hover:text-red-300 text-sm px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
