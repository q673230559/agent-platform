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

export default function DirectoryTree({ orchestrationId }: { orchestrationId: number | null }) {
  const [tree, setTree] = useState<WorkspaceTreeItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orchestrationId) {
      setTree(null)
      setError(null)
      return
    }
    orchestrationsApi.workspace(orchestrationId)
      .then(setTree)
      .catch((e) => setError(e.message))
  }, [orchestrationId])

  if (!orchestrationId) {
    return <p className="text-xs text-gray-600">保存编排后即可查看工作空间文件。</p>
  }

  if (error) {
    return <p className="text-xs text-red-400">加载工作空间失败: {error}</p>
  }

  if (tree === null) {
    return <p className="text-xs text-gray-600">加载中...</p>
  }

  if (tree.length === 0) {
    return <p className="text-xs text-gray-600">工作空间目录尚未创建。执行编排后会自动生成。</p>
  }

  return (
    <div className="font-mono text-xs space-y-0.5">
      {tree.map((item, i) => (
        <TreeItem key={item.path} item={item} depth={0} last={i === tree.length - 1} />
      ))}
    </div>
  )
}
