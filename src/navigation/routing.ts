import type { RouteStep, StepAction } from './types'
import { getNodes, getNode, getEdgesFrom } from './graph'

interface DijkstraNode {
  id: string
  cost: number
  prev: string | null
}

function dijkstra(startId: string, endId: string): string[] | null {
  const nodes = getNodes()
  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const unvisited = new Set<string>()

  for (const n of nodes) {
    dist.set(n.id, Infinity)
    prev.set(n.id, null)
    unvisited.add(n.id)
  }
  dist.set(startId, 0)

  while (unvisited.size > 0) {
    // Pick unvisited node with smallest distance
    let current: DijkstraNode = { id: '', cost: Infinity, prev: null }
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity
      if (d < current.cost) current = { id, cost: d, prev: prev.get(id) ?? null }
    }

    if (current.id === '' || current.cost === Infinity) break
    if (current.id === endId) break

    unvisited.delete(current.id)

    for (const edge of getEdgesFrom(current.id)) {
      if (!unvisited.has(edge.to)) continue
      const alt = current.cost + edge.weight
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt)
        prev.set(edge.to, current.id)
      }
    }
  }

  if ((dist.get(endId) ?? Infinity) === Infinity) return null

  // Reconstruct path
  const path: string[] = []
  let cur: string | null = endId
  while (cur !== null) {
    path.unshift(cur)
    cur = prev.get(cur) ?? null
  }
  return path
}

function headingDiff(from: number, to: number): number {
  let diff = ((to - from) % 360 + 360) % 360
  if (diff > 180) diff -= 360
  return diff
}

function actionFromHeadings(incomingHeading: number | null, outgoingHeading: number): StepAction {
  if (incomingHeading === null) return 'start'
  const diff = headingDiff(incomingHeading, outgoingHeading)
  if (Math.abs(diff) <= 30) return 'continue'
  if (diff > 30 && diff <= 150) return 'turn-right'
  if (diff < -30 && diff >= -150) return 'turn-left'
  return 'turn-around'
}

export function computeRoute(startId: string, endId: string): RouteStep[] | null {
  if (startId === endId) return []

  const path = dijkstra(startId, endId)
  if (!path || path.length < 2) return null

  const steps: RouteStep[] = []
  let prevHeading: number | null = null

  for (let i = 0; i < path.length - 1; i++) {
    const fromId = path[i]
    const toId = path[i + 1]

    const edges = getEdgesFrom(fromId)
    const edge = edges.find(e => e.to === toId)
    if (!edge) return null

    const toNode = getNode(toId)
    if (!toNode) return null

    const action: StepAction =
      i === path.length - 2
        ? 'arrive'
        : actionFromHeadings(prevHeading, edge.heading)

    steps.push({
      fromNodeId: fromId,
      toNodeId: toId,
      toNodeLabel: toNode.label,
      heading: edge.heading,
      distanceMeters: edge.weight,
      action,
    })

    prevHeading = edge.heading
  }

  return steps
}
