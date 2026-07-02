import { useCallback, useEffect, useRef, useState } from 'react'
import CameraView from './ui/CameraView'
import MenuView from './ui/MenuView'
import TestView from './ui/TestView'
import ToggleButton from './ui/ToggleButton'
import ThemeToggle from './ui/ThemeToggle'
import ArrivalScreen from './ui/ArrivalScreen'
import type { RouteStep } from './navigation/types'
import { getNode, areAdjacent } from './navigation/graph'
import { computeRoute } from './navigation/routing'
import './styles/app.css'

export type AppView = 'camera' | 'menu' | 'test'
type NavPhase = 'idle' | 'navigating' | 'arrived'
export type Theme = 'dark' | 'light'

// The far end of the corridor from the entrance — a sensible default position
// before any localisation result has come in.
const FALLBACK_NODE    = 'exit'
const REROUTE_THRESHOLD = 3
const THEME_KEY = 'ilv-theme'

export default function App() {
  const [view, setView]               = useState<AppView>('camera')
  const [currentNodeId, setCurrentNodeId] = useState(FALLBACK_NODE)
  const [route, setRoute]             = useState<RouteStep[]>([])
  const [stepIndex, setStepIndex]     = useState(0)
  const [destinationId, setDestinationId] = useState<string | null>(null)
  const [navPhase, setNavPhase]       = useState<NavPhase>('idle')
  const [theme, setTheme]             = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark'
    return (window.localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light')
    document.documentElement.classList.toggle('theme-dark', theme !== 'light')
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Refs keep navigation callbacks free of stale closures
  const routeRef        = useRef(route)
  const stepIndexRef    = useRef(stepIndex)
  const navPhaseRef     = useRef(navPhase)
  const destinationRef  = useRef(destinationId)
  const currentNodeRef  = useRef(currentNodeId)
  const mismatchRef     = useRef(0)
  // Once q/e manually moves the room, automatic localisation-driven stepping
  // is suspended — it would otherwise fight (or silently undo) the manual
  // move — until 'u' resets back to fully automatic.
  const manualSteppingRef = useRef(false)

  routeRef.current       = route
  stepIndexRef.current   = stepIndex
  navPhaseRef.current    = navPhase
  destinationRef.current = destinationId
  currentNodeRef.current = currentNodeId

  const handleNodeDetected = useCallback((nodeId: string) => {
    // Manual q/e stepping takes full control of position until 'u' resets it.
    if (manualSteppingRef.current) return

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
    manualSteppingRef.current = false  // a fresh route starts in automatic mode
    setCurrentNodeId(startId)
    setView(targetView)
  }

  function handleCancelRoute() {
    setRoute([])
    setStepIndex(0)
    setDestinationId(null)
    setNavPhase('idle')
    mismatchRef.current = 0
    manualSteppingRef.current = false
  }

  /** Set the current position directly, without starting a route — e.g. a
   *  demo clip's known entry point, which the presenter then picks their own
   *  destination for (rather than hardcoding one). */
  function handleSetCurrentNode(nodeId: string) {
    setCurrentNodeId(nodeId)
    mismatchRef.current = 0
    manualSteppingRef.current = false
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

  // Demo aid: while navigating, "e"/"q" manually move the current position to
  // the next/previous room in the route's node list — a stand-in for
  // localisation actually detecting the move, for when you want to advance
  // the demo without waiting on (or fighting) the live detection. The first
  // press of either suspends automatic (localisation-driven) stepping, since
  // otherwise a live detection could immediately fight or undo the manual
  // move — 'u' resets back to fully automatic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const key = e.key.toLowerCase()

      if (key === 'u') {
        manualSteppingRef.current = false
        return
      }
      if (key !== 'e' && key !== 'q') return

      const r   = routeRef.current
      const idx = stepIndexRef.current
      if (navPhaseRef.current !== 'navigating' || r.length === 0) return

      if (key === 'e') {
        const step = r[idx]
        if (!step) return
        mismatchRef.current = 0
        manualSteppingRef.current = true
        setCurrentNodeId(step.toNodeId)
        if (idx + 1 >= r.length) {
          setNavPhase('arrived')
        } else {
          setStepIndex(idx + 1)
        }
        e.preventDefault()
      } else {
        if (idx <= 0) return
        const prevStep = r[idx - 1]
        if (!prevStep) return
        mismatchRef.current = 0
        manualSteppingRef.current = true
        setCurrentNodeId(prevStep.fromNodeId)
        setStepIndex(idx - 1)
        e.preventDefault()
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
          currentNodeId={currentNodeId}
          destinationId={destinationId}
          route={route}
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
          route={route}
          onNavigate={(destId, startId) => handleNavigate(destId, 'test', startId)}
          onCancelRoute={handleCancelRoute}
          onSetCurrentNode={handleSetCurrentNode}
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

      {navPhase !== 'arrived' && (
        <ThemeToggle theme={theme} onToggle={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))} />
      )}
    </div>
  )
}
