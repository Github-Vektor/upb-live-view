import { useEffect, useRef, useState } from 'react'
import { useVideoFile } from '../ar/useVideoFile'
import { useArrowOverlay } from '../ar/useArrowOverlay'
import { useHallwayDirection } from '../ar/useHallwayDirection'
import { useDeviceOrientation } from '../ar/useDeviceOrientation'
import { useLocalisation } from '../localisation/useLocalisation'
import { testClipUrl } from '../localisation/LocalisationService'
import { getNavigableNodes } from '../navigation/graph'
import { useManualOverride, MANUAL_HEADING_OFFSET } from '../navigation/manualOverride'
import { useDirectionNudge } from '../navigation/directionNudge'
import type { RouteStep } from '../navigation/types'
import NavigationBar from './NavigationBar'
import LocalisationBadge from './LocalisationBadge'
import VanishingPointMarker from './VanishingPointMarker'
import SchematicMap from './SchematicMap'
import './TestView.css'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]
const ALL_DESTINATIONS = getNavigableNodes()

// Thesis-demo clips (recordings/evening_demo_light/demo{1,2,3}.mp4), each
// scripted to start from a known room. Picking one of these via "Open file"
// hardcodes only that entry point — not the destination, which stays up to
// you (dropdown). Reaching whatever destination you pick, by stepping q/e
// through the resulting route, finishes navigation the same way arriving
// automatically would.
const DEMO_ENTRY: Record<string, string> = {
  demo1: 's2',
  demo2: 's3',
  demo3: 'i1',
}

function demoEntryForFile(file: File): string | null {
  const stem = file.name.replace(/\.[^./\\]+$/, '').toLowerCase()
  return DEMO_ENTRY[stem] ?? null
}

interface Props {
  currentStep:  RouteStep | null
  stepIndex:    number
  totalSteps:   number
  currentNodeId: string
  destinationId: string | null
  route:        RouteStep[]
  onNavigate:   (destId: string, startId?: string) => void
  onCancelRoute:() => void
  onSetCurrentNode:(nodeId: string) => void
  onNodeDetected:(nodeId: string) => void
  onClose:      () => void
}

export default function TestView({
  currentStep, stepIndex, totalSteps,
  currentNodeId, destinationId, route, onNavigate,
  onCancelRoute, onSetCurrentNode, onNodeDetected, onClose,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement | null>(null)
  const linesCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [linesMode, setLinesMode] = useState(false)
  const [showMap, setShowMap] = useState(false)
  // A recognised demo clip (demo1/2/3) has its entry point hardcoded, and
  // ignores live localisation results — room position only moves via q/e,
  // over whatever route you set up by picking a destination — since the
  // index was never built from these clips and would otherwise fight the
  // manual stepping with noisy guesses. The arrow direction itself is
  // unaffected — it keeps using the normal visually-tracked hallway
  // direction so it still looks natural.
  const [demoMode, setDemoMode] = useState(false)
  const video       = useVideoFile()
  const localisation = useLocalisation(video.videoRef, currentNodeId)
  const orientation  = useDeviceOrientation()
  // Demo aid: w/a/s/d overwrite the recommended instruction + arrow direction;
  // u snaps back to the calculated recommendation (and to following the
  // visually-tracked hallway direction).
  const manual = useManualOverride()
  // Demo aid: i/j/k/l nudge the arrow by hand, 'o' resets — composes with
  // whichever heading source is currently active (visual tracking or a
  // w/a/s/d override), so it isn't tied to one or the other.
  const nudge = useDirectionNudge()
  // Find the end of the hallway (grid vanishing point + wobble parallax) — no
  // compass on a laptop. grid/wobble/combined drive the on-screen debug markers.
  // The lines canvas (when mounted) gets the debug "lines only" render.
  const { grid, wobble, combined, wobbleMotion } = useHallwayDirection(video.videoRef, linesCanvasRef, nudge)

  // Sequential 10% windows: first clip from the first 10%, next from the next, …
  const segmentRef = useRef(0)
  function loadNextClip() {
    setDemoMode(false)
    const seg = segmentRef.current
    segmentRef.current = seg + 1
    video.loadUrl(testClipUrl(seg))
  }

  useEffect(() => {
    loadNextClip()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (demoMode) return  // room position is manual-only (q/e) during a demo clip
    if (localisation.status === 'ok' && localisation.nodeId) {
      onNodeDetected(localisation.nodeId)
    }
  }, [localisation.nodeId, localisation.status, onNodeDetected, demoMode])

  // This is a recording, so the device compass is irrelevant: the direction of
  // travel is simply "into the screen" (0°) and the vanishing point provides all
  // the steering. (Desktop browsers report orientation.status as 'active' even
  // with no real sensor, so we must NOT gate on it here.) A manual override
  // takes priority and is already screen-relative.
  const relativeHeading = manual.action !== null ? MANUAL_HEADING_OFFSET[manual.action] : 0

  useArrowOverlay(canvasRef, {
    headingDeg: relativeHeading,
    // Render the arrow only once the video has loaded, a route is active, and
    // we're not in the lines-only debug view.
    visible:    currentStep !== null && video.hasFile && !video.loading && !video.error && !linesMode,
    confidence: localisation.confidence,
  }, {
    videoRef: video.videoRef,
    // Same arrow-direction calculation everywhere, demo clips included: it
    // follows the visually-tracked hallway direction (natural, matches what
    // the video is actually showing) unless a manual override is forcing a
    // specific left/right/around/forward heading instead.
    targetRef: manual.action !== null ? undefined : combined,
    nudgeRef: nudge,
    // Keeps the arrow reacting to the camera's natural wobble even while a
    // w/a/s/d override is forcing the general direction, instead of holding
    // a perfectly rigid heading.
    wobbleRef: wobbleMotion,
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
            onChange={e => {
              const val = e.target.value
              // A <select> keeps keyboard focus after picking an option, which
              // would otherwise silently swallow every w/a/s/d/q/e/u shortcut
              // afterward (they all skip handling when the event target is a
              // form control, to not hijack typing elsewhere). Give focus back
              // to the page so the shortcuts keep working right away.
              e.target.blur()
              if (val) { setDemoMode(false); onNavigate(val) }
            }}
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
          <button className="test-open-btn" onClick={() => setShowMap(m => !m)}>
            {showMap ? 'Hide map' : 'Map'}
          </button>
          <button className="test-open-btn" onClick={loadNextClip}>Next clip</button>
          <button
            className="test-open-btn"
            onClick={() => video.openFile(file => {
              const entry = demoEntryForFile(file)
              if (entry) {
                setDemoMode(true)
                onCancelRoute()      // drop any stale route from before this clip
                onSetCurrentNode(entry)
              } else {
                // No assumptions about an arbitrary opened file's content —
                // just load it. Pick a destination from the dropdown (or
                // drive it manually with q/e and w/a/s/d) for the route/arrow.
                setDemoMode(false)
              }
            })}
          >
            Open file
          </button>
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
        {showMap && (
          <div className="map-overlay">
            <SchematicMap currentNodeId={currentNodeId} destinationId={destinationId} route={route} />
          </div>
        )}
        {/* The vanishing-point markers that steer the arrow are debug info —
            only show them alongside the lines-only technical view. */}
        {!video.loading && !video.error && linesMode && (
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
            onChange={e => { video.seek(Number(e.target.value)); e.target.blur() }}
          />

          <span className="test-time">{fmt(video.duration)}</span>

          <select
            className="test-speed"
            value={video.speed}
            onChange={e => { video.setSpeed(Number(e.target.value)); e.target.blur() }}
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
          overrideAction={manual.action}
          inline
        />
      )}
    </div>
  )
}
