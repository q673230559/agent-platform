import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { providersApi, botsApi } from '../api/client'

export default function Dashboard() {
  const [stats, setStats] = useState({ providers: 0, bots: 0 })

  useEffect(() => {
    Promise.all([providersApi.list(), botsApi.list()]).then(([p, b]) => {
      setStats({ providers: p.length, bots: b.length })
    }).catch(() => {})
  }, [])

  return (
    <div className="p-8 max-w-5xl">
      <h2 className="text-2xl font-bold text-white mb-8">Dashboard</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
        <Link to="/bots" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group">
          <p className="text-3xl font-bold text-white mb-1">{stats.bots}</p>
          <p className="text-sm text-gray-400 group-hover:text-indigo-400 transition-colors">Bots</p>
        </Link>
        <Link to="/providers" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group">
          <p className="text-3xl font-bold text-white mb-1">{stats.providers}</p>
          <p className="text-sm text-gray-400 group-hover:text-indigo-400 transition-colors">Providers</p>
        </Link>
        <Link to="/bots/new" className="bg-indigo-600/20 border border-indigo-500/30 rounded-xl p-6 hover:bg-indigo-600/30 transition-colors group">
          <p className="text-3xl font-bold text-indigo-400 mb-1">+</p>
          <p className="text-sm text-indigo-400">Create New Bot</p>
        </Link>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Quick Start</h3>
        <ol className="space-y-3 text-sm text-gray-400">
          <li className="flex gap-3">
            <span className="text-indigo-400 font-bold">1</span>
            Add a model provider in <Link to="/providers" className="text-indigo-400 underline">Providers</Link> (e.g., DeepSeek, OpenAI)
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400 font-bold">2</span>
            Create a bot linked to the provider in <Link to="/bots/new" className="text-indigo-400 underline">Bots</Link>
          </li>
          <li className="flex gap-3">
            <span className="text-indigo-400 font-bold">3</span>
            Start chatting with your bot via the Chat page
          </li>
        </ol>
      </div>
    </div>
  )
}
