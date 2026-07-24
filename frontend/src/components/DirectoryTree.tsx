import { useState, useEffect } from 'react'
import { orchestrationsApi } from '../api/client'
import type { WorkspaceTreeItem } from '../types'

function iconForType(type: string): string {
  return type === 'directory' ? '▸' : ' '
}

function colorForType(type: string): string {
  return type === 'directory' ? 'text-amber-400' : 'text-gray-400'
}

function TreeItem({ item, depth, last }: { item: WorkspaceTreeItem; depth: number; last: boolean }) {
  const [expanded, setExpanded] = useState(depth < 2)

  return (
    <div>
      <div
        style={{ paddingLeft: depth * 16 }}
        className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-gray-800/50 rounded"
        onClick={() => item.type === 'directory' && setExpanded(!expanded)}
      >
        <span className={colorForType(item.type)}>
          {item.type === 'directory' ? (expanded ? '▾' : '▸') : iconForType(item.type)}
        </span>
        <span className={item.type === 'directory' ? 'text-gray-200' : 'text-gray-400'}>
          {item.name}
        </span>
      </div>
      {item.type === 'directory' && expanded && item.children.length > 0 && (
        <div>
          {item.children.map((child, i) => (
            <TreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              last={i === item.children.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface DirectoryTreeProps {
  orchestrationId?: number | null
  treeData?: WorkspaceTreeItem[] | null
  loading?: boolean
  error?: string | null
  emptyMessage?: string
}

export default function DirectoryTree({
  orchestrationId,
  treeData,
  loading,
  error,
  emptyMessage,
}: DirectoryTreeProps) {
  const [internalTree, setInternalTree] = useState<WorkspaceTreeItem[] | null>(null)
  const [internalError, setInternalError] = useState<string | null>(null)

  useEffect(() => {
    if (treeData !== undefined) return
    if (!orchestrationId) {
      setInternalTree(null)
      setInternalError(null)
      return
    }
    orchestrationsApi.workspace(orchestrationId)
      .then(setInternalTree)
      .catch((e) => setInternalError(e.message))
  }, [orchestrationId, treeData])

  const dataMode = treeData !== undefined
  const data = dataMode ? treeData : internalTree
  const err = dataMode ? (error ?? null) : internalError
  const loadingState = dataMode ? (loading ?? false) : false
  const emptyText = emptyMessage ?? '保存编排后即可查看工作空间文件。'

  if (!dataMode && !orchestrationId) {
    return <p className="text-xs text-gray-600">{emptyText}</p>
  }

  if (loadingState) {
    return <p className="text-xs text-gray-600">加载中...</p>
  }

  if (err) {
    return <p className="text-xs text-red-400">加载工作空间失败: {err}</p>
  }

  if (data === null) {
    return <p className="text-xs text-gray-600">加载中...</p>
  }

  if (data.length === 0) {
    return <p className="text-xs text-gray-600">{emptyText}</p>
  }

  return (
    <div className="font-mono text-xs space-y-0.5">
      {data.map((item, i) => (
        <TreeItem key={item.path} item={item} depth={0} last={i === data.length - 1} />
      ))}
    </div>
  )
}
