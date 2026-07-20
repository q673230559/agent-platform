import { useRef, useEffect } from 'react'
import {
  ReactFlow, Controls, Background, MiniMap,
  Node, Edge, BackgroundVariant,
  OnNodesChange, OnEdgesChange,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import WorkflowNode from './WorkflowNode'

interface DAGViewerProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange?: OnNodesChange
  onEdgesChange?: OnEdgesChange
  readOnly?: boolean
  fitView?: boolean
  onNodeContextMenu?: (event: MouseEvent, node: Node) => void
}

function findNodeAtPosition(
  clientX: number,
  clientY: number,
  flowNodes: Node[],
  containerEl: HTMLElement,
  viewport: { x: number; y: number; zoom: number },
): Node | null {
  const rect = containerEl.getBoundingClientRect()
  const flowX = (clientX - rect.left - viewport.x) / viewport.zoom
  const flowY = (clientY - rect.top - viewport.y) / viewport.zoom
  console.log('[DAG] findNodeAtPosition:', { clientX, clientY, rect: { left: rect.left, top: rect.top }, viewport, flowX, flowY, nodeCount: flowNodes.length })

  for (let i = flowNodes.length - 1; i >= 0; i--) {
    const n = flowNodes[i]
    const w = (n.measured?.width || n.width || 150) as number
    const h = (n.measured?.height || n.height || 50) as number
    const hit = flowX >= n.position.x && flowX <= n.position.x + w &&
                flowY >= n.position.y && flowY <= n.position.y + h
    console.log('[DAG] checking node:', { id: n.id, label: n.data?.label, pos: n.position, w, h, flowX, flowY, hit })
    if (hit) return n
  }
  return null
}

function ContextMenuInterceptor({ nodes, onNodeContextMenu }: { nodes: Node[]; onNodeContextMenu?: (e: MouseEvent, node: Node) => void }) {
  const rf = useReactFlow()

  useEffect(() => {
    console.log('[DAG] ContextMenuInterceptor useEffect, onNodeContextMenu:', !!onNodeContextMenu, 'nodes:', nodes.length)
    if (!onNodeContextMenu) return

    const el = document.querySelector('.react-flow')
    console.log('[DAG] .react-flow element:', el)
    if (!el) return

    const handler = (e: Event) => {
      const me = e as MouseEvent
      console.log('[DAG] contextmenu handler fired, target:', (me.target as HTMLElement)?.tagName, (me.target as HTMLElement)?.className)
      const viewport = rf.getViewport()
      console.log('[DAG] viewport:', viewport)
      const node = findNodeAtPosition(me.clientX, me.clientY, nodes, el as HTMLElement, viewport)
      console.log('[DAG] found node:', node?.id, node?.data?.label)
      if (node) {
        me.preventDefault()
        me.stopPropagation()
        onNodeContextMenu(me, node)
      }
    }

    el.addEventListener('contextmenu', handler)
    console.log('[DAG] listener added to .react-flow')
    return () => {
      console.log('[DAG] listener removed')
      el.removeEventListener('contextmenu', handler)
    }
  }, [nodes, onNodeContextMenu, rf])

  return null
}

export default function OrchestrationDAGViewer({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  readOnly = true,
  fitView = true,
  onNodeContextMenu,
}: DAGViewerProps) {
  console.log('[DAG] DAGViewer render, nodes:', nodes.length, 'hasContextMenu:', !!onNodeContextMenu)

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView={fitView}
        fitViewOptions={{ padding: 0.3, maxZoom: 0.7 }}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        nodeTypes={{ workflow: WorkflowNode }}
      >
        <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" showInteractive={false} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
        <MiniMap
          className="!bg-gray-800 !border-gray-700"
          maskColor="rgba(0,0,0,0.7)"
          nodeColor={(node: Node) => {
            const status = node.data?.status as string
            if (status === 'error') return '#ef4444'
            if (status === 'done') return '#34d399'
            if (status === 'running') return '#818cf8'
            if (status === 'skipped') return '#6b7280'
            return '#374151'
          }}
        />
        <ContextMenuInterceptor nodes={nodes} onNodeContextMenu={onNodeContextMenu} />
      </ReactFlow>
    </div>
  )
}
