import { useCallback, useEffect, useRef, useState } from 'react'
import CameraView from './ui/CameraView'
import MenuView from './ui/MenuView'
import TestView from './ui/TestView'
import ToggleButton from './ui/ToggleButton'
import ArrivalScreen from './ui/ArrivalScreen'
import type { RouteStep } from './navigation/types'
import { getNode, areAdjacent } from './navigation/graph'
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
  const currentNodeRef  = useRef(currentNodeId)
  const mismatchRef     = useRef(0)

  routeRef.current       = route
  stepIndexRef.current   = stepIndex
  navPhaseRef.current    = navPhase
  destinationRef.current = destinationId
  currentNodeRef.current = currentNodeId

  const handleNodeDetected = useCallback((nodeId: string) => {
    // Topological gate: accept a detected node only if it is the current node or
    // directly adjacent to it. On a corridor the user can only move to a
    // neighbour, so non-adjacent detections are localisation noise and ignored.
    if (!areAdjacent(currentNodeRef.current, nodeId)) return

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

  function handleNavigate(destId: string, targetView: AppView = 'camera', startId: string = currentNodeId) {
    const steps = computeRoute(startId, destId)
    if (!steps || steps.length === 0) return
    setRoute(steps)
    setStepIndex(0)
    setDestinationId(destId)
    setNavPhase('navigating')
    mismatchRef.current = 0
    setCurrentNodeId(startId)
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

  // Demo aid: press "f" to force the "you have arrived" screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'f' || e.key === 'F') {
        if (!destinationRef.current) setDestinationId(currentNodeRef.current)
        setNavPhase('arrived')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
          onCancelRoute={handleCancelRoute}
          onNodeDetected={handleNodeDetected}
        />
      ) : view === 'test' ? (
        <TestView
          currentStep={currentStep}
          stepIndex={stepIndex}
          totalSteps={route.length}
          currentNodeId={currentNodeId}
          destinationId={destinationId}
          onNavigate={(destId) => handleNavigate(destId, 'test')}
          onStartFromEnd={() => handleNavigate(destinationId ?? 'conn_0_1', 'test', 'conn_4_5')}
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
          onOpenTest={() => {
            // Test mode always starts at the end of the corridor (hall5 = conn_4_5)
            // and routes to the far end, so the guiding arrow shows immediately.
            handleNavigate('conn_0_1', 'test', 'conn_4_5')
          }}
        />
      )}

      {navPhase !== 'arrived' && view !== 'test' && (
        <ToggleButton view={view} onToggle={setView} />
      )}
    </div>
  )
}
