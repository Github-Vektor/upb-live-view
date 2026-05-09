import { useState } from 'react'
import { getNavigableNodes } from '../navigation/graph'
import type { RouteStep } from '../navigation/types'
import SchematicMap from './SchematicMap'
import './MenuView.css'

interface Props {
  currentNodeId: string
  destinationId: string | null
  route: RouteStep[]
  onNavigate: (destId: string) => void
  onCancelRoute: () => void
  onOpenTest: () => void
}

const ALL_DESTINATIONS = getNavigableNodes()

export default function MenuView({ currentNodeId, destinationId, route, onNavigate, onCancelRoute, onOpenTest }: Props) {
  const [query, setQuery] = useState('')

  const destinations = query.trim()
    ? ALL_DESTINATIONS.filter(n => n.label.toLowerCase().includes(query.toLowerCase()))
    : ALL_DESTINATIONS

  return (
    <div className="menu-view">
      <h1 className="menu-title">Interior Live View</h1>
      <p className="menu-subtitle">Indoor AR Navigation</p>

      <section className="menu-section">
        <h2>Map</h2>
        <SchematicMap
          currentNodeId={currentNodeId}
          destinationId={destinationId}
          route={route}
        />
      </section>

      {destinationId && (
        <div className="menu-active-route">
          <span>Navigating to <strong>{ALL_DESTINATIONS.find(n => n.id === destinationId)?.label}</strong></span>
          <button className="menu-cancel-btn" onClick={onCancelRoute}>Cancel</button>
        </div>
      )}

      <section className="menu-section">
        <h2>Navigate to</h2>
        <input
          className="menu-search"
          type="search"
          placeholder="Search destinations…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <ul className="menu-dest-list">
          {destinations.map(node => (
            <li key={node.id}>
              <button
                className={`menu-dest-btn${destinationId === node.id ? ' menu-dest-btn--active' : ''}`}
                onClick={() => onNavigate(node.id)}
              >
                <span className="menu-dest-icon">{nodeIcon(node.type)}</span>
                <span className="menu-dest-label">{node.label}</span>
              </button>
            </li>
          ))}
          {destinations.length === 0 && (
            <li className="menu-no-results">No results for "{query}"</li>
          )}
        </ul>
      </section>

      <section className="menu-section">
        <h2>Current location</h2>
        <p className="menu-placeholder">
          {ALL_DESTINATIONS.find(n => n.id === currentNodeId)?.label ?? currentNodeId}
        </p>
      </section>

      <section className="menu-section">
        <h2>Developer</h2>
        <button className="menu-test-btn" onClick={onOpenTest}>
          <span className="menu-dest-icon">▶</span>
          <span className="menu-dest-label">Test with recording</span>
        </button>
      </section>
    </div>
  )
}

function nodeIcon(type: string): string {
  switch (type) {
    case 'entrance': return '🚪'
    case 'exit':     return '🚶'
    case 'room':     return '🏫'
    default:         return '📍'
  }
}
