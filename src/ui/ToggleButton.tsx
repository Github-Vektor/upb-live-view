import type { AppView } from '../App'
import './ToggleButton.css'

interface Props {
  view: AppView
  onToggle: (v: AppView) => void
}

export default function ToggleButton({ view, onToggle }: Props) {
  return (
    <button
      className="toggle-btn"
      onClick={() => onToggle(view === 'camera' ? 'menu' : 'camera')}
      aria-label={view === 'camera' ? 'Open menu' : 'Open camera'}
    >
      {view === 'camera' ? (
        // Hamburger icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      ) : (
        // Camera icon
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      )}
    </button>
  )
}
