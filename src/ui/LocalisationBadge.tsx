import type { LocalisationState } from '../localisation/useLocalisation'
import { getNode } from '../navigation/graph'
import './LocalisationBadge.css'

interface Props {
  localisation: LocalisationState
}

export default function LocalisationBadge({ localisation }: Props) {
  const { nodeId, confidence, status } = localisation

  if (status === 'unavailable') {
    return <div className="loc-badge loc-badge--warn">Server offline</div>
  }

  if (status === 'idle' || status === 'querying') {
    return <div className="loc-badge loc-badge--dim">Scanning…</div>
  }

  if (status === 'error' || !nodeId) {
    return <div className="loc-badge loc-badge--dim">No match</div>
  }

  const label = getNode(nodeId)?.label ?? nodeId
  return (
    <div className="loc-badge loc-badge--ok">
      <span className="loc-badge__label">{label}</span>
      <span className="loc-badge__conf">{Math.round(confidence * 100)}%</span>
    </div>
  )
}
