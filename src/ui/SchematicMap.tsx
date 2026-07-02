import type { RouteStep } from '../navigation/types'
import { getNodes } from '../navigation/graph'
import './SchematicMap.css'

interface Props {
  currentNodeId: string | null
  destinationId: string | null
  route: RouteStep[]
}

const ALL_NODES = getNodes()
// Ordered left-to-right as drawn — mirrored from the physical corridor order,
// so exit sits on the left and entrance on the right.
const MAIN_ORDER = ['exit', 'h5', 'i4', 'h4', 'i3', 'h3', 'i2', 'h2', 'i1', 'h1', 'entrance']
const MAIN_NODES = MAIN_ORDER.map(id => ALL_NODES.find(n => n.id === id)!).filter(Boolean)

// Each intersection has one stairwell branching off it, 90° to the hallway.
const STAIRWELL_FOR: Record<string, string> = { i1: 's1', i2: 's2', i3: 's3', i4: 's4' }

const SVG_W    = 320
const SVG_H    = 120
const PAD      = 30
const Y_LINE   = 52
const BRANCH   = 22   // stairwell stub length, drawn above the main line
const STEP     = (SVG_W - PAD * 2) / (MAIN_NODES.length - 1)
// Main-line labels are now real room/company names (e.g. "Renewacad",
// "Canti CTI"), too long to fit horizontally at this node spacing without
// overlapping their neighbours — angle them like chart axis labels instead.
const LABEL_ANGLE = -42

function cx(i: number) { return PAD + i * STEP }

function radiusFor(type: string): number {
  if (type === 'entrance' || type === 'exit' || type === 'intersection') return 7
  if (type === 'stairwell') return 4.5
  return 5 // hallway
}

export default function SchematicMap({ currentNodeId, destinationId, route }: Props) {
  const routeNodeIds = new Set(route.flatMap(s => [s.fromNodeId, s.toNodeId]))

  function colours(nodeId: string, type: string) {
    const isCurrent   = nodeId === currentNodeId
    const isDest      = nodeId === destinationId
    const isRouteNode = routeNodeIds.has(nodeId)
    const fill = isCurrent ? 'var(--accent-strong)'
      : isDest      ? 'var(--success-strong)'
      : isRouteNode ? 'var(--accent)'
      : type === 'stairwell' ? 'var(--surface-2)' : 'var(--surface-alt)'
    const stroke = isCurrent ? 'var(--accent-strong)'
      : isDest      ? 'var(--success-strong)'
      : isRouteNode ? 'var(--accent)'
      : 'var(--border)'
    return { isCurrent, isDest, isRouteNode, fill, stroke }
  }

  return (
    <div className="schematic-map">
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="schematic-svg">

        {/* Main corridor line segments (entrance ↔ exit through halls/intersections) */}
        {MAIN_NODES.slice(0, -1).map((node, i) => {
          const inRoute = routeNodeIds.has(node.id) && routeNodeIds.has(MAIN_NODES[i + 1].id)
          return (
            <line
              key={node.id}
              x1={cx(i)} y1={Y_LINE}
              x2={cx(i + 1)} y2={Y_LINE}
              stroke={inRoute ? 'var(--accent)' : 'var(--border)'}
              strokeWidth={inRoute ? 3 : 2}
            />
          )
        })}

        {/* Stairwell branch stubs, 90° off their intersection */}
        {MAIN_NODES.map((node, i) => {
          const stairId = STAIRWELL_FOR[node.id]
          if (!stairId) return null
          const inRoute = routeNodeIds.has(node.id) && routeNodeIds.has(stairId)
          return (
            <line
              key={`branch-${stairId}`}
              x1={cx(i)} y1={Y_LINE}
              x2={cx(i)} y2={Y_LINE - BRANCH}
              stroke={inRoute ? 'var(--accent)' : 'var(--border)'}
              strokeWidth={inRoute ? 2.5 : 1.5}
            />
          )
        })}

        {/* Main-line nodes */}
        {MAIN_NODES.map((node, i) => {
          const r = radiusFor(node.type)
          const { isCurrent, isDest, fill, stroke } = colours(node.id, node.type)

          return (
            <g key={node.id}>
              {isCurrent && (
                <circle cx={cx(i)} cy={Y_LINE} r={r + 5} fill="var(--accent-strong)" opacity={0.2}>
                  <animate attributeName="r" values={`${r + 4};${r + 8};${r + 4}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.2;0.05;0.2" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={cx(i)} cy={Y_LINE} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
              {isDest && (
                <text x={cx(i)} y={Y_LINE - r - 6} textAnchor="middle" fontSize="9" fill="var(--success-strong)">▼</text>
              )}
              <text
                x={cx(i)} y={Y_LINE + r + 9}
                textAnchor="end"
                transform={`rotate(${LABEL_ANGLE} ${cx(i)} ${Y_LINE + r + 9})`}
                fontSize="7"
                fill={isCurrent || isDest ? 'var(--text-dim)' : 'var(--text-faint)'}
              >
                {node.label}
              </text>
            </g>
          )
        })}

        {/* Stairwell nodes, drawn above their intersection */}
        {MAIN_NODES.map((node, i) => {
          const stairId = STAIRWELL_FOR[node.id]
          if (!stairId) return null
          const stair = ALL_NODES.find(n => n.id === stairId)
          if (!stair) return null
          const r = radiusFor(stair.type)
          const { isCurrent, isDest, fill, stroke } = colours(stair.id, stair.type)
          const y = Y_LINE - BRANCH

          return (
            <g key={stairId}>
              {isCurrent && (
                <circle cx={cx(i)} cy={y} r={r + 4} fill="var(--accent-strong)" opacity={0.2}>
                  <animate attributeName="r" values={`${r + 3};${r + 6};${r + 3}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.2;0.05;0.2" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={cx(i)} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
              {isDest && (
                <text x={cx(i)} y={y - r - 11} textAnchor="middle" fontSize="8" fill="var(--success-strong)">▼</text>
              )}
              <text
                x={cx(i)} y={y - r - 3}
                textAnchor="middle"
                fontSize="6"
                fill={isCurrent || isDest ? 'var(--text-dim)' : 'var(--text-faint)'}
              >
                {stair.label.replace('Stairwell ', 'S')}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
