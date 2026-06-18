import type { LocalisationState } from '../localisation/useLocalisation'
import { getNode } from '../navigation/graph'
import './LocalisationBadge.css'

interface Props {
  localisation: LocalisationState
  /** When set, this is the adjacency-gated node the system currently believes
   *  it is at (App's currentNodeId). The badge shows it as the location, so the
   *  display matches the gated state (e.g. starts at hall5) instead of a raw,
   *  possibly non-adjacent localisation guess. */
  effectiveNodeId?: string | null
}

export default function LocalisationBadge({ localisation, effectiveNodeId }: Props) {
  const { nodeId, confidence, status, timing } = localisation

  if (status === 'unavailable') {
    return <div className="loc-badge loc-badge--warn">Server offline</div>
  }

  // The node shown is the gated belief when provided, else the raw result.
  const shownNode = effectiveNodeId ?? nodeId

  // Keep the last known location on screen while a new query is in flight, so
  // the badge stops flickering back to "Scanning" between every query. Only
  // show "Scanning" before there is any node to show.
  if (!shownNode) {
    const msg = status === 'idle' || status === 'querying' ? 'Scanning…' : 'No match'
    return <div className="loc-badge loc-badge--dim">{msg}</div>
  }

  // The raw localisation confirms the shown node only when it agrees with it;
  // otherwise the gate is holding position and we hide the (mismatched) score.
  const confirmed = nodeId === shownNode
  const label = getNode(shownNode)?.label ?? shownNode
  return (
    <div className={`loc-badge ${confirmed ? 'loc-badge--ok' : 'loc-badge--dim'}`}>
      <span className="loc-badge__label">{label}</span>
      {confirmed && <span className="loc-badge__conf">{Math.round(confidence * 100)}%</span>}
      {confirmed && timing && (
        <span className="loc-badge__latency" title={`capture ${timing.captureMs}ms · infer ${timing.inferenceMs}ms`}>
          {timing.totalMs}ms
        </span>
      )}
    </div>
  )
}
