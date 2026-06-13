import { useEffect, useRef } from 'react'
import { useVideoFile } from '../ar/useVideoFile'
import { useArrowOverlay } from '../ar/useArrowOverlay'
import { useDeviceOrientation } from '../ar/useDeviceOrientation'
import { useLocalisation } from '../localisation/useLocalisation'
import { testClipUrl } from '../localisation/LocalisationService'
import type { RouteStep } from '../navigation/types'
import NavigationBar from './NavigationBar'
import LocalisationBadge from './LocalisationBadge'
import './TestView.css'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

interface Props {
  currentStep:  RouteStep | null
  stepIndex:    number
  totalSteps:   number
  onNextStep:   () => void
  onPrevStep:   () => void
  onCancelRoute:() => void
  onNodeDetected:(nodeId: string) => void
  onClose:      () => void
}

export default function TestView({
  currentStep, stepIndex, totalSteps,
  onNextStep, onPrevStep, onCancelRoute, onNodeDetected, onClose,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement | null>(null)
  const video       = useVideoFile()
  const localisation = useLocalisation(video.videoRef)
  const orientation  = useDeviceOrientation()

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

  const routeHeading    = currentStep?.heading ?? 0
  const relativeHeading = orientation.status === 'active'
    ? ((routeHeading - orientation.compassHeading) % 360 + 360) % 360
    : 0

  useArrowOverlay(canvasRef, {
    headingDeg: relativeHeading,
    visible:    currentStep !== null && video.hasFile && !video.loading && !video.error,
    confidence: localisation.confidence,
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
          <button className="test-open-btn" onClick={loadNextClip}>🎬 Next clip</button>
          <button className="test-open-btn" onClick={video.openFile}>Open file</button>
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

        {video.error ? (
          <div className="test-empty">
            <span className="test-empty-icon">⚠</span>
            <span>{video.error}</span>
            <button className="test-empty-btn" onClick={loadNextClip}>Retry</button>
          </div>
        ) : video.loading ? (
          <div className="test-empty">
            <span className="test-empty-icon">▶</span>
            <span>Generating clip…</span>
          </div>
        ) : (
          <LocalisationBadge localisation={localisation} />
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

      {/* Navigation bar (same as live view) */}
      {currentStep && video.hasFile && (
        <NavigationBar
          step={currentStep}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onNext={onNextStep}
          onPrev={onPrevStep}
          onCancel={onCancelRoute}
        />
      )}
    </div>
  )
}
