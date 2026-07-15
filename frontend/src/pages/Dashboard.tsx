import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { statsApi } from '../api/client'
import type { DashboardStats } from '../types'

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({ providers: 0, bots: 0, orchestrations: 0, orchestration_runs: 0 })

  useEffect(() => {
    statsApi.get().then(setStats).catch(() => {})
  }, [])

  return (
    <div className="p-8 max-w-5xl">
      <h2 className="text-2xl font-bold text-white mb-8">首页</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        <Link to="/orchestrations" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group">
          <p className="text-3xl font-bold text-white mb-1">{stats.orchestrations}</p>
          <p className="text-sm text-gray-400 group-hover:text-indigo-400 transition-colors">任务编排</p>
        </Link>
        <Link to="/orchestrations" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group">
          <p className="text-3xl font-bold text-white mb-1">{stats.orchestration_runs}</p>
          <p className="text-sm text-gray-400 group-hover:text-indigo-400 transition-colors">执行次数</p>
        </Link>
        <Link to="/bots" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group">
          <p className="text-3xl font-bold text-white mb-1">{stats.bots}</p>
          <p className="text-sm text-gray-400 group-hover:text-indigo-400 transition-colors">机器人</p>
        </Link>
        <Link to="/providers" className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group">
          <p className="text-3xl font-bold text-white mb-1">{stats.providers}</p>
          <p className="text-sm text-gray-400 group-hover:text-indigo-400 transition-colors">模型供应商</p>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">快速开始</h3>
          <ol className="space-y-3 text-sm text-gray-400">
            <li className="flex gap-3">
              <span className="text-indigo-400 font-bold">1</span>
              在 <Link to="/providers" className="text-indigo-400 underline">模型供应商</Link> 中添加供应商（如 DeepSeek、OpenAI）
            </li>
            <li className="flex gap-3">
              <span className="text-indigo-400 font-bold">2</span>
              在 <Link to="/bots/new" className="text-indigo-400 underline">机器人</Link> 中创建关联供应商的 Bot
            </li>
            <li className="flex gap-3">
              <span className="text-indigo-400 font-bold">3</span>
              通过对话页面与你的机器人开始聊天
            </li>
          </ol>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">快捷入口</h3>
          <div className="space-y-3 text-sm">
            <Link to="/orchestrations/new" className="flex gap-3 text-gray-400 hover:text-indigo-400 transition-colors">
              <span className="text-indigo-400 font-bold">+</span>
              创建任务编排
            </Link>
            <Link to="/orchestrations" className="flex gap-3 text-gray-400 hover:text-indigo-400 transition-colors">
              <span className="text-indigo-400 font-bold">&rarr;</span>
              查看执行历史
            </Link>
            <Link to="/bots/new" className="flex gap-3 text-gray-400 hover:text-indigo-400 transition-colors">
              <span className="text-indigo-400 font-bold">+</span>
              创建机器人
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
