export type NodeType =
  | 'entrance'
  | 'exit'
  | 'waypoint'
  | 'room'
  | 'hallway'
  | 'intersection'
  | 'stairwell'

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  /** Filename relative to recordings/ directory. Optional — some nodes (e.g. a
   *  hallway/intersection stretch, or a stairwell with no dedicated pan) only
   *  have reference imagery via `paths`, not a standalone circular-pan clip. */
  recording?: string
  /** Optional extra recordings (e.g. corridor/transition clips between rooms)
   *  also indexed under this node. Skipped silently if a file is absent. */
  paths?: string[]
}

export interface GraphEdge {
  from: string
  to: string
  /** Straight-line distance in metres */
  weight: number
  /** Bearing in degrees to walk this edge: 0 = north, 90 = east, 180 = south, 270 = west */
  heading: number
}

export interface NavGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type StepAction =
  | 'start'
  | 'continue'
  | 'turn-left'
  | 'turn-right'
  | 'turn-around'
  | 'arrive'

export interface RouteStep {
  fromNodeId: string
  toNodeId: string
  toNodeLabel: string
  heading: number
  distanceMeters: number
  action: StepAction
}
