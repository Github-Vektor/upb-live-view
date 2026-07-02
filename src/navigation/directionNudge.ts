import { useEffect, useRef } from 'react'

export interface DirectionNudge {
  /** Extra yaw (left/right), in degrees, added on top of whichever heading
   *  source is currently driving the arrow — the visually-tracked hallway
   *  direction, or a manual w/a/s/d override. j/l adjust it, 'o' resets it. */
  yawDeg: number
  /** Extra vertical nudge, in the normalised image units the vanishing-point
   *  tracking uses — only meaningful there (a manual w/a/s/d heading has no
   *  pitch axis). i/k adjust it, 'o' resets it. */
  pitchOffset: number
}

const YAW_STEP_DEG = 2
const PITCH_STEP   = 0.03
const MAX_YAW_DEG  = 90
const MAX_PITCH    = 0.5

// Hardcoded baseline nudge tuned for the demo recordings: 3 clicks right
// (+yaw) and 11 clicks up (-pitch, originally 3, bumped 8 clicks further up).
// 'o' resets back to this baseline.
const DEF_YAW_DEG = 3 * YAW_STEP_DEG
const DEF_PITCH   = -11 * PITCH_STEP

/**
 * Demo aid: i/j/k/l nudge the arrow's steering by hand, 'o' resets back to
 * the baseline above. This composes with whatever is currently driving the
 * arrow — the visually-tracked hallway direction (the usual case) or a
 * manual w/a/s/d override — so the nudge keeps working no matter which one
 * is active, instead of only affecting the automatic tracking.
 */
export function useDirectionNudge(): React.RefObject<DirectionNudge> {
  const nudgeRef = useRef<DirectionNudge>({ yawDeg: DEF_YAW_DEG, pitchOffset: DEF_PITCH })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const n = nudgeRef.current
      switch (e.key.toLowerCase()) {
        case 'j': n.yawDeg -= YAW_STEP_DEG; break                       // left
        case 'l': n.yawDeg += YAW_STEP_DEG; break                       // right
        case 'i': n.pitchOffset -= PITCH_STEP; break                    // up
        case 'k': n.pitchOffset += PITCH_STEP; break                    // down
        case 'o': n.yawDeg = DEF_YAW_DEG; n.pitchOffset = DEF_PITCH; break // reset to baseline
        default: return
      }
      n.yawDeg = Math.max(-MAX_YAW_DEG, Math.min(MAX_YAW_DEG, n.yawDeg))
      n.pitchOffset = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, n.pitchOffset))
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return nudgeRef
}
