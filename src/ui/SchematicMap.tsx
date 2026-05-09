import type { RouteStep } from '../navigation/types'
import { getNodes } from '../navigation/graph'
import './SchematicMap.css'

interface Props {
  currentNodeId: string | null
  destinationId: string | null
  route: RouteStep[]
}

const ALL_NODES = getNodes()
// Ordered left-to-right as they appear in the corridor
const NODE_ORDER = [
  'conn_0_1', 'tower_1', 'conn_1_2', 'tower_2',
  'conn_2_3', 'tower_3', 'conn_3_4', 'tower_4', 'conn_4_5',
]
const NODES = NODE_ORDER.map(id => ALL_NODES.find(n => n.id === id)!).filter(Boolean)

const SVG_W   = 320
const SVG_H   = 80
const PAD     = 24
const Y_LINE  = 36
const STEP    = (SVG_W - PAD * 2) / (NODES.length - 1)

function cx(i: number) { return PAD + i * STEP }

export default function SchematicMap({ currentNodeId, destinationId, route }: Props) {
  const routeNodeIds = new Set(route.flatMap(s => [s.fromNodeId, s.toNodeId]))

  return (
    <div className="schematic-map">
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="schematic-svg">

        {/* Corridor line segments */}
        {NODES.slice(0, -1).map((node, i) => {
          const inRoute = routeNodeIds.has(node.id) && routeNodeIds.has(NODES[i + 1].id)
          return (
            <line
              key={node.id}
              x1={cx(i)} y1={Y_LINE}
              x2={cx(i + 1)} y2={Y_LINE}
              stroke={inRoute ? '#0077cc' : '#2a2a3a'}
              strokeWidth={inRoute ? 3 : 2}
            />
          )
        })}

        {/* Nodes */}
        {NODES.map((node, i) => {
          const isTower      = node.type === 'room'
          const isCurrent    = node.id === currentNodeId
          const isDest       = node.id === destinationId
          const isRouteNode  = routeNodeIds.has(node.id)
          const r = isTower ? 8 : 5

          const fill = isCurrent ? '#00aaff'
            : isDest     ? '#00cc66'
            : isRouteNode ? '#0055aa'
            : '#1e1e2e'

          const stroke = isCurrent ? '#66ccff'
            : isDest     ? '#66ffaa'
            : isRouteNode ? '#3377cc'
            : '#3a3a4a'

          return (
            <g key={node.id}>
              {isCurrent && (
                <circle cx={cx(i)} cy={Y_LINE} r={r + 5} fill="#00aaff" opacity={0.2}>
                  <animate attributeName="r" values={`${r + 4};${r + 8};${r + 4}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.2;0.05;0.2" dur="1.8s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={cx(i)} cy={Y_LINE}
                r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5}
              />
              {isDest && (
                <text x={cx(i)} y={Y_LINE - 14} textAnchor="middle" fontSize="9" fill="#66ffaa">▼</text>
              )}
              <text
                x={cx(i)} y={Y_LINE + 18}
                textAnchor="middle"
                fontSize="7.5"
                fill={isCurrent || isDest ? '#ccc' : '#555'}
              >
                {isTower ? node.label.replace('Tower ', 'T') : node.label.replace('Connector ', 'C')}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
