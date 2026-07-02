import { useEffect, useRef, useState } from 'react'
import { useCamera } from '../ar/useCamera'
import { useArrowOverlay } from '../ar/useArrowOverlay'
import { useDeviceOrientation } from '../ar/useDeviceOrientation'
import { useLocalisation } from '../localisation/useLocalisation'
import { useManualOverride, MANUAL_HEADING_OFFSET } from '../navigation/manualOverride'
import type { RouteStep } from '../navigation/types'
import NavigationBar from './NavigationBar'
import LocalisationBadge from './LocalisationBadge'
import SchematicMap from './SchematicMap'
import MapToggleButton from './MapToggleButton'
import './CameraView.css'

interface Props {
  currentStep: RouteStep | null
  stepIndex: number
  totalSteps: number
  currentNodeId: string
  destinationId: string | null
  route: RouteStep[]
  onCancelRoute: () => void
  onNodeDetected: (nodeId: string) => void
}

export default function CameraView({
  currentStep,
  stepIndex,
  totalSteps,
  currentNodeId,
  destinationId,
  route,
  onCancelRoute,
  onNodeDetected,
}: Props) {
  const { videoRef, status: camStatus, error } = useCamera()
  const canvasRef    = useRef<HTMLCanvasElement | null>(null)
  const localisation = useLocalisation(videoRef)
  const orientation  = useDeviceOrientation()
  const [showMap, setShowMap] = useState(false)
  // Demo aid: w/a/s/d overwrite the recommended instruction + arrow direction;
  // u snaps back to the calculated recommendation.
  const manual = useManualOverride()

  // Propagate localisation result via effect, not during render
  useEffect(() => {
    if (localisation.status === 'ok' && localisation.nodeId) {
      onNodeDetected(localisation.nodeId)
    }
  }, [localisation.nodeId, localisation.status, onNodeDetected])

  const routeHeading    = currentStep?.heading ?? 0
  // With a live compass, steer relative to where the device is pointing.
  // Without one (e.g. desktop), fall back to the absolute route heading.
  // A manual override takes priority over both: it is already screen-relative.
  const relativeHeading = manual.action !== null
    ? MANUAL_HEADING_OFFSET[manual.action]
    : orientation.status === 'active'
      ? ((routeHeading - orientation.compassHeading) % 360 + 360) % 360
      : routeHeading

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
        <>
          <MapToggleButton active={showMap} onToggle={() => setShowMap(v => !v)} />
          {showMap && (
            <div className="map-overlay">
              <SchematicMap currentNodeId={currentNodeId} destinationId={destinationId} route={route} />
            </div>
          )}
        </>
      )}

      {currentStep && (
        <NavigationBar
          step={currentStep}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onCancel={onCancelRoute}
          overrideAction={manual.action}
        />
      )}
    </div>
  )
}
