import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

const navItems = [
  { path: '/', label: '首页', icon: '◫' },
  { path: '/providers', label: '模型供应商', icon: '◇' },
  { path: '/bots', label: '机器人', icon: '◈' },
  { path: '/orchestrations', label: '任务编排', icon: '◎' },
  { path: '/settings', label: '系统设置', icon: '⚙' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (pathname.startsWith('/chat')) {
      setCollapsed(true)
    }
  }, [pathname])

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-14' : 'w-56'} bg-gray-900 border-r border-gray-800 flex flex-col shrink-0 transition-all duration-200 overflow-hidden`}>
        <div className={`p-5 border-b border-gray-800 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Agent Platform</h1>
              <p className="text-xs text-gray-500 mt-0.5">多模型管理平台</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-500 hover:text-gray-300 transition-colors shrink-0 cursor-pointer"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-indigo-600/20 text-indigo-400 font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                } ${collapsed ? 'justify-center' : ''}`}
              >
                <span className="text-base">{item.icon}</span>
                {!collapsed && item.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">{collapsed ? 'v1.0' : 'Agent Platform v1.0'}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
