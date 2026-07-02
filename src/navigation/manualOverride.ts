import { useEffect, useState } from 'react'
import type { StepAction } from './types'

/** The subset of StepAction the presenter can force by hand. */
export type ManualAction = Extract<StepAction, 'continue' | 'turn-left' | 'turn-right' | 'turn-around'>

const KEY_ACTION: Record<string, ManualAction> = {
  w: 'continue',
  a: 'turn-left',
  d: 'turn-right',
  s: 'turn-around',
}

/** Screen-relative heading (same convention as ArrowOverlayOptions.headingDeg:
 *  0 = straight ahead, 90 = right, 180 = back, 270 = left) for each manual action.
 *  Turn left/right (a/d) swing the arrow by 30° (lowered from 45°) rather
 *  than a full 90°. */
export const MANUAL_HEADING_OFFSET: Record<ManualAction, number> = {
  continue:      0,
  'turn-right':  30,
  'turn-around': 180,
  'turn-left':   330,
}

export interface ManualOverrideState {
  /** The action currently forced by the presenter, or null when following the
   *  calculated recommendation. */
  action: ManualAction | null
  /** Heading offset to feed the arrow overlay when `action` is set. */
  headingOffset: number
  /** Snap back to the calculated recommended direction (same as pressing 'u'). */
  reset: () => void
}

/**
 * Demo aid: w/a/s/d let the presenter manually overwrite the recommended
 * navigation instruction and the direction the AR arrow points to — handy for
 * narrating a recalibration or a turn the underlying recording hasn't shown
 * yet. 'u' snaps back to the calculated route recommendation.
 *
 *   w = forward (continue)   a = turn left
 *   d = turn right            s = turn around
 *   u = reset to calculated recommendation
 */
export function useManualOverride(): ManualOverrideState {
  const [action, setAction] = useState<ManualAction | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const key = e.key.toLowerCase()
      if (key === 'u') {
        setAction(null)
        e.preventDefault()
        return
      }
      const next = KEY_ACTION[key]
      if (!next) return
      setAction(next)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return {
    action,
    headingOffset: action ? MANUAL_HEADING_OFFSET[action] : 0,
    reset: () => setAction(null),
  }
}
