import type { NavGraph, GraphNode, GraphEdge } from './types'
import rawGraph from '../../data/graph.json'

const graph = rawGraph as NavGraph

export function getNodes(): GraphNode[] {
  return graph.nodes
}

export function getNode(id: string): GraphNode | undefined {
  return graph.nodes.find(n => n.id === id)
}

export function getEdgesFrom(nodeId: string): GraphEdge[] {
  return graph.edges.filter(e => e.from === nodeId)
}

export function getNavigableNodes(): GraphNode[] {
  return graph.nodes.filter(n => n.type !== 'waypoint')
}

/** True if two nodes are the same or directly connected by an edge. */
export function areAdjacent(a: string, b: string): boolean {
  if (a === b) return true
  return graph.edges.some(
    e => (e.from === a && e.to === b) || (e.from === b && e.to === a),
  )
}
