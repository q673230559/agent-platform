import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const navItems = [
  { path: '/', label: '首页', icon: '◫' },
  { path: '/providers', label: '模型供应商', icon: '◇' },
  { path: '/bots', label: '机器人', icon: '◈' },
  { path: '/orchestrations', label: '任务编排', icon: '◎' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-5 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white tracking-tight">Agent Platform</h1>
          <p className="text-xs text-gray-500 mt-0.5">多模型管理平台</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-indigo-600/20 text-indigo-400 font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">Agent Platform v1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
