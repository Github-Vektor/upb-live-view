import { useEffect, useRef, useState } from 'react'
import { useVideoFile } from '../ar/useVideoFile'
import { useArrowOverlay } from '../ar/useArrowOverlay'
import { useHallwayDirection } from '../ar/useHallwayDirection'
import { useDeviceOrientation } from '../ar/useDeviceOrientation'
import { useLocalisation } from '../localisation/useLocalisation'
import { testClipUrl } from '../localisation/LocalisationService'
import { getNavigableNodes } from '../navigation/graph'
import type { RouteStep } from '../navigation/types'
import NavigationBar from './NavigationBar'
import LocalisationBadge from './LocalisationBadge'
import VanishingPointMarker from './VanishingPointMarker'
import './TestView.css'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]
const ALL_DESTINATIONS = getNavigableNodes()

interface Props {
  currentStep:  RouteStep | null
  stepIndex:    number
  totalSteps:   number
  currentNodeId: string
  destinationId: string | null
  onNavigate:   (destId: string) => void
  onStartFromEnd:() => void
  onCancelRoute:() => void
  onNodeDetected:(nodeId: string) => void
  onClose:      () => void
}

export default function TestView({
  currentStep, stepIndex, totalSteps,
  currentNodeId, destinationId, onNavigate, onStartFromEnd,
  onCancelRoute, onNodeDetected, onClose,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement | null>(null)
  const linesCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [linesMode, setLinesMode] = useState(false)
  const video       = useVideoFile()
  const localisation = useLocalisation(video.videoRef, currentNodeId)
  const orientation  = useDeviceOrientation()
  // Find the end of the hallway (grid vanishing point + wobble parallax) — no
  // compass on a laptop. grid/wobble/combined drive the on-screen debug markers.
  // The lines canvas (when mounted) gets the debug "lines only" render.
  const { grid, wobble, combined } = useHallwayDirection(video.videoRef, linesCanvasRef)

  // Sequential 10% windows: first clip from the first 10%, next from the next, …
  const segmentRef = useRef(0)
  function loadNextClip() {
    const seg = segmentRef.current
    segmentRef.current = seg + 1
    video.loadUrl(testClipUrl(seg))
  }

  useEffect(() => {
    loadNextClip()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (localisation.status === 'ok' && localisation.nodeId) {
      onNodeDetected(localisation.nodeId)
    }
  }, [localisation.nodeId, localisation.status, onNodeDetected])

  // This is a recording, so the device compass is irrelevant: the direction of
  // travel is simply "into the screen" (0°) and the vanishing point provides all
  // the steering. (Desktop browsers report orientation.status as 'active' even
  // with no real sensor, so we must NOT gate on it here.)
  const relativeHeading = 0

  useArrowOverlay(canvasRef, {
    headingDeg: relativeHeading,
    // Render the arrow only once the video has loaded, a route is active, and
    // we're not in the lines-only debug view.
    visible:    currentStep !== null && video.hasFile && !video.loading && !video.error && !linesMode,
    confidence: localisation.confidence,
  }, {
    videoRef: video.videoRef,
    targetRef: combined,
  })

  function fmt(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="test-view">
      {/* Top bar */}
      <div className="test-topbar">
        <button className="test-back-btn" onClick={onClose}>‹ Back</button>
        <span className="test-title">Test Recording</span>
        <div className="test-change-btns">
          <select
            className="test-open-btn"
            style={{ maxWidth: 170 }}
            title="Pick a destination (acts like the live view)"
            value={destinationId ?? ''}
            onChange={e => { if (e.target.value) onNavigate(e.target.value) }}
          >
            <option value="" disabled>Navigate to…</option>
            {ALL_DESTINATIONS.map(n => (
              <option key={n.id} value={n.id} disabled={n.id === currentNodeId}>
                {n.label}{n.id === currentNodeId ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <button className="test-open-btn" onClick={() => setLinesMode(m => !m)}>
            {linesMode ? 'Video' : 'Lines'}
          </button>
          <button className="test-open-btn" onClick={loadNextClip}>Next clip</button>
          <button className="test-open-btn" onClick={() => { onStartFromEnd(); video.openFile() }}>Open file</button>
        </div>
      </div>

      {/* Video + AR layer — the <video> stays mounted so its ref is always live */}
      <div className="test-stage">
        <video
          ref={video.videoRef}
          className="test-video"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="test-canvas" />
        {linesMode && <canvas ref={linesCanvasRef} className="test-lines" />}
        {!video.loading && !video.error && !linesMode && (
          <>
            <VanishingPointMarker videoRef={video.videoRef} vpRef={grid}     color="#00d0ff" label="GRID" />
            <VanishingPointMarker videoRef={video.videoRef} vpRef={wobble}   color="#ff3da6" label="WOBBLE" />
            <VanishingPointMarker videoRef={video.videoRef} vpRef={combined} color="#ffd400" label="FUSED" />
          </>
        )}

        {orientation.status === 'needs-permission' && (
          <button className="compass-permission-btn" onClick={orientation.requestPermission}>
            Enable compass
          </button>
        )}
        {orientation.status === 'denied' && (
          <div className="camera-overlay-message camera-overlay-message--warn">
            Compass denied — arrow points forward only
          </div>
        )}

        {video.error ? (
          <div className="test-empty">
            <span>{video.error}</span>
            <button className="test-empty-btn" onClick={loadNextClip}>Retry</button>
          </div>
        ) : video.loading ? (
          <div className="test-empty">
            <span>Generating clip…</span>
          </div>
        ) : (
          <LocalisationBadge localisation={localisation} effectiveNodeId={currentNodeId} />
        )}
      </div>

      {/* Playback controls */}
      {video.hasFile && !video.error && (
        <div className="test-controls">
          <button className="test-play-btn" onClick={video.togglePlay}>
            {video.isPlaying ? '⏸' : '▶'}
          </button>

          <span className="test-time">{fmt(video.currentTime)}</span>

          <input
            className="test-scrubber"
            type="range"
            min={0}
            max={video.duration || 1}
            step={0.1}
            value={video.currentTime}
            onChange={e => video.seek(Number(e.target.value))}
          />

          <span className="test-time">{fmt(video.duration)}</span>

          <select
            className="test-speed"
            value={video.speed}
            onChange={e => video.setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map(s => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
        </div>
      )}

      {/* Navigation bar — inline so it sits below the controls, not over them */}
      {currentStep && (
        <NavigationBar
          step={currentStep}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onCancel={onCancelRoute}
          inline
        />
      )}
    </div>
  )
}
