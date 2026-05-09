import { useCallback, useRef, useState } from 'react'
import CameraView from './ui/CameraView'
import MenuView from './ui/MenuView'
import TestView from './ui/TestView'
import ToggleButton from './ui/ToggleButton'
import ArrivalScreen from './ui/ArrivalScreen'
import type { RouteStep } from './navigation/types'
import { getNode } from './navigation/graph'
import { computeRoute } from './navigation/routing'
import './styles/app.css'

export type AppView = 'camera' | 'menu' | 'test'
type NavPhase = 'idle' | 'navigating' | 'arrived'

const FALLBACK_NODE    = 'conn_4_5'
const REROUTE_THRESHOLD = 3

export default function App() {
  const [view, setView]               = useState<AppView>('camera')
  const [currentNodeId, setCurrentNodeId] = useState(FALLBACK_NODE)
  const [route, setRoute]             = useState<RouteStep[]>([])
  const [stepIndex, setStepIndex]     = useState(0)
  const [destinationId, setDestinationId] = useState<string | null>(null)
  const [navPhase, setNavPhase]       = useState<NavPhase>('idle')

  // Refs keep navigation callbacks free of stale closures
  const routeRef        = useRef(route)
  const stepIndexRef    = useRef(stepIndex)
  const navPhaseRef     = useRef(navPhase)
  const destinationRef  = useRef(destinationId)
  const mismatchRef     = useRef(0)

  routeRef.current       = route
  stepIndexRef.current   = stepIndex
  navPhaseRef.current    = navPhase
  destinationRef.current = destinationId

  const handleNodeDetected = useCallback((nodeId: string) => {
    setCurrentNodeId(nodeId)

    const r   = routeRef.current
    const idx = stepIndexRef.current
    if (navPhaseRef.current !== 'navigating' || r.length === 0) return

    const step = r[idx]
    if (!step) return

    if (nodeId === step.toNodeId) {
      // Reached the next waypoint
      mismatchRef.current = 0
      if (idx + 1 >= r.length) {
        setNavPhase('arrived')
      } else {
        setStepIndex(idx + 1)
      }
      return
    }

    if (nodeId === step.fromNodeId) {
      // Still at current waypoint — no change
      mismatchRef.current = 0
      return
    }

    // Off-route: accumulate mismatches before re-routing
    mismatchRef.current += 1
    if (mismatchRef.current >= REROUTE_THRESHOLD) {
      mismatchRef.current = 0
      const dest = destinationRef.current
      if (dest && dest !== nodeId) {
        const newRoute = computeRoute(nodeId, dest)
        if (newRoute && newRoute.length > 0) {
          setRoute(newRoute)
          setStepIndex(0)
        }
      }
    }
  }, [])

  function handleNavigate(destId: string, targetView: AppView = 'camera') {
    const steps = computeRoute(currentNodeId, destId)
    if (!steps || steps.length === 0) return
    setRoute(steps)
    setStepIndex(0)
    setDestinationId(destId)
    setNavPhase('navigating')
    mismatchRef.current = 0
    setView(targetView)
  }

  function handleCancelRoute() {
    setRoute([])
    setStepIndex(0)
    setDestinationId(null)
    setNavPhase('idle')
    mismatchRef.current = 0
  }

  function handleArrivalDone() {
    handleCancelRoute()
    setView('menu')
  }

  const currentStep = navPhase === 'navigating' && route.length > 0 ? route[stepIndex] : null

  return (
    <div className="app">
      {navPhase === 'arrived' && destinationId ? (
        <ArrivalScreen
          destinationLabel={getNode(destinationId)?.label ?? destinationId}
          onDone={handleArrivalDone}
        />
      ) : view === 'camera' ? (
        <CameraView
          currentStep={currentStep}
          stepIndex={stepIndex}
          totalSteps={route.length}
          onNextStep={() => setStepIndex(i => Math.min(i + 1, route.length - 1))}
          onPrevStep={() => setStepIndex(i => Math.max(i - 1, 0))}
          onCancelRoute={handleCancelRoute}
          onNodeDetected={handleNodeDetected}
        />
      ) : view === 'test' ? (
        <TestView
          currentStep={currentStep}
          stepIndex={stepIndex}
          totalSteps={route.length}
          onNextStep={() => setStepIndex(i => Math.min(i + 1, route.length - 1))}
          onPrevStep={() => setStepIndex(i => Math.max(i - 1, 0))}
          onCancelRoute={handleCancelRoute}
          onNodeDetected={handleNodeDetected}
          onClose={() => setView('menu')}
        />
      ) : (
        <MenuView
          currentNodeId={currentNodeId}
          destinationId={destinationId}
          route={route}
          onNavigate={handleNavigate}
          onCancelRoute={handleCancelRoute}
          onOpenTest={() => setView('test')}
        />
      )}

      {navPhase !== 'arrived' && view !== 'test' && (
        <ToggleButton view={view} onToggle={setView} />
      )}
    </div>
  )
}
