import { useEffect, useRef } from 'react'
import { useCamera } from '../ar/useCamera'
import { useArrowOverlay } from '../ar/useArrowOverlay'
import { useDeviceOrientation } from '../ar/useDeviceOrientation'
import { useLocalisation } from '../localisation/useLocalisation'
import type { RouteStep } from '../navigation/types'
import NavigationBar from './NavigationBar'
import LocalisationBadge from './LocalisationBadge'
import './CameraView.css'

interface Props {
  currentStep: RouteStep | null
  stepIndex: number
  totalSteps: number
  onNextStep: () => void
  onPrevStep: () => void
  onCancelRoute: () => void
  onNodeDetected: (nodeId: string) => void
}

export default function CameraView({
  currentStep,
  stepIndex,
  totalSteps,
  onNextStep,
  onPrevStep,
  onCancelRoute,
  onNodeDetected,
}: Props) {
  const { videoRef, status: camStatus, error } = useCamera()
  const canvasRef    = useRef<HTMLCanvasElement | null>(null)
  const localisation = useLocalisation(videoRef)
  const orientation  = useDeviceOrientation()

  // Propagate localisation result via effect, not during render
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
    visible:    currentStep !== null,
    confidence: localisation.confidence,
  })

  return (
    <div className="camera-view">
      <video ref={videoRef} className="camera-feed" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="ar-canvas" />

      {camStatus === 'requesting' && (
        <div className="camera-overlay-message">Requesting camera…</div>
      )}
      {camStatus === 'error' && (
        <div className="camera-overlay-message camera-overlay-message--error">
          Camera error: {error}
        </div>
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

      <LocalisationBadge localisation={localisation} />

      {currentStep && (
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
