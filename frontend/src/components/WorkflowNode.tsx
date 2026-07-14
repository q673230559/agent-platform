import { Handle, Position } from '@xyflow/react'

interface ToolDef {
  nodeType: string
  nodeColor: { bg: string; border: string }
  shape: { borderRadius: number; accent?: string }
}

// Minimal registry for the shared node component
const SHAPE_DEFAULTS: Record<string, { radius: number; accent?: string }> = {
  start: { radius: 20 },
  end: { radius: 20 },
  agent: { radius: 12 },
  decision_agent: { radius: 4 },
  decision_script: { radius: 4, accent: 'rgb(34, 211, 238)' },
  python_script: { radius: 2, accent: 'rgb(59, 130, 246)' },
}

const NODE_COLORS: Record<string, { bg: string; border: string }> = {}

const DEFAULT_COLOR = { bg: '#1f2937', border: '#4b5563' }

const STATUS_OVERLAYS: Record<string, React.CSSProperties> = {
  pending: { opacity: 0.4 },
  running: { opacity: 1, borderColor: 'rgb(129, 140, 248)', borderWidth: 2 },
  done: { opacity: 1, borderColor: 'rgb(52, 211, 153)', borderWidth: 2, filter: 'drop-shadow(0 0 6px rgba(52, 211, 153, 0.4))' },
  error: { opacity: 1, background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgb(239, 68, 68)' },
  skipped: { opacity: 1 },
}

interface WorkflowNodeProps {
  data: Record<string, unknown>
}

export default function WorkflowNode({ data }: WorkflowNodeProps) {
  const nodeType = (data.node_type as string) || ''
  const status = (data.status as string) || ''
  const isStart = nodeType === 'start'
  const isEnd = nodeType === 'end'
  const isDecision = nodeType === 'decision_agent' || nodeType === 'decision_script'
  const shapeInfo = SHAPE_DEFAULTS[nodeType] || { radius: 8 }
  const color = NODE_COLORS[nodeType] || DEFAULT_COLOR
  const statusOverlay = STATUS_OVERLAYS[status] || {}

  const borderColor = (statusOverlay.borderColor as string) || color.border
  const borderWidth = (statusOverlay.borderWidth as number) || 1

  const handleStyle: React.CSSProperties = {
    background: '#6366f1',
    border: '2px solid #1f2937',
    width: 12, height: 12,
  }

  const topHandleStyle: React.CSSProperties = isDecision
    ? { ...handleStyle, top: 'calc(12% - 2px)' }
    : handleStyle
  const bottomHandleStyle: React.CSSProperties = isDecision
    ? { ...handleStyle, bottom: 'calc(12% - 2px)' }
    : handleStyle

  // SVG diamond for decision_agent — native stroke follows the polygon shape
  if (isDecision) {
    const w = 110
    const h = 100
    const points = `${w / 2},12 ${w},${h / 2} ${w / 2},88 0,${h / 2}`
    return (
      <div className="relative">
        {!isStart && <Handle type="target" position={Position.Top} style={topHandleStyle} />}
        {!isEnd && <Handle type="source" position={Position.Bottom} style={bottomHandleStyle} />}
        <svg
          width={w}
          height={h}
          style={{
            display: 'block',
            overflow: 'visible',
            filter: (statusOverlay.filter as string) || 'none',
          }}
        >
          <polygon
            points={points}
            fill={(statusOverlay.background || color.bg) as string}
            stroke={borderColor}
            strokeWidth={borderWidth}
            opacity={(statusOverlay.opacity ?? 1) as number}
            style={{ transition: 'all 0.3s' }}
          />
          <text
            x={w / 2}
            y={h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#e5e7eb"
            fontSize="12"
            fontWeight="500"
          >
            {(data.label as string) || 'Node'}
          </text>
        </svg>
      </div>
    )
  }

  // Non-decision nodes: CSS border-radius approach
  const wrapperRadius = shapeInfo.radius

  const containerStyle: React.CSSProperties = {
    background: statusOverlay.background || color.bg,
    color: '#e5e7eb',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    minWidth: 90,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s',
    opacity: statusOverlay.opacity ?? 1,
    borderRadius: wrapperRadius,
  }

  const wrapperStyle: React.CSSProperties = {
    borderRadius: wrapperRadius,
    border: `${borderWidth}px solid ${borderColor}`,
    display: 'inline-block',
  }
  if (statusOverlay.filter) {
    wrapperStyle.filter = statusOverlay.filter as string
  }

  return (
    <div className="relative" style={wrapperStyle}>
      {!isStart && <Handle type="target" position={Position.Top} style={topHandleStyle} />}
      {!isEnd && <Handle type="source" position={Position.Bottom} style={bottomHandleStyle} />}
      <div style={containerStyle}>
        {shapeInfo.accent && (
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: shapeInfo.accent }} />
        )}
        <div className="text-center" style={shapeInfo.accent ? { paddingLeft: 3 } : undefined}>
          {(data.label as string) || 'Node'}
        </div>
      </div>
    </div>
  )
}
