import { useEffect, useRef } from 'react'
import { useVideoFile } from '../ar/useVideoFile'
import { useArrowOverlay } from '../ar/useArrowOverlay'
import { useDeviceOrientation } from '../ar/useDeviceOrientation'
import { useLocalisation } from '../localisation/useLocalisation'
import type { RouteStep } from '../navigation/types'
import NavigationBar from './NavigationBar'
import LocalisationBadge from './LocalisationBadge'
import testVideoUrl from '../../recordings/test_hd12.mp4'
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

  useEffect(() => {
    video.loadUrl(testVideoUrl)
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
    visible:    currentStep !== null && video.hasFile,
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
        <button className="test-open-btn" onClick={video.openFile}>
          {video.hasFile ? 'Custom file' : 'Open file'}
        </button>
      </div>

      {/* Video + AR layer */}
      <div className="test-stage">
        {!video.hasFile ? (
          <div className="test-empty">
            <span className="test-empty-icon">▶</span>
            <span>Loading…</span>
          </div>
        ) : (
          <>
            <video
              ref={video.videoRef}
              className="test-video"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="test-canvas" />
            <LocalisationBadge localisation={localisation} />
          </>
        )}
      </div>

      {/* Playback controls */}
      {video.hasFile && (
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
