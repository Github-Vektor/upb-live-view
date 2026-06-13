import { useEffect, useRef } from 'react'

/**
 * Estimates the direction to the end of the hallway from the video frames, by
 * combining TWO cues:
 *
 *  1. Vanishing point (grid): the straight lines running down the corridor
 *     (tile seams, skirting, wall/floor edges) converge at the corridor's
 *     vanishing point — "the end of the hallway". Found via a weighted
 *     least-squares fit of all strong edge lines in the floor region.
 *
 *  2. Wobble odometry (parallax): the global frame-to-frame image shift gives
 *     the camera's apparent rotation, accumulated over time. This reacts to the
 *     natural hand-held wobble/panning even when the grid is weak.
 *
 * The vanishing point gives the steady absolute direction; the wobble layer adds
 * the live, high-frequency reaction (it decays back toward zero so it never
 * biases the steady direction). Both are smoothed/remembered across frames.
 *
 * Returns refs (no React re-renders): `motion` for the overlay, `vp` (normalised
 * 0–1 image coords) for the on-screen debug marker.
 */
export interface Motion {
  yaw: number   // degrees, + = end-of-hall / heading is to the right
  pitch: number // degrees, + = higher in frame
}

export interface VP {
  x: number      // 0–1 across the video frame
  y: number      // 0–1 down the video frame
  valid: boolean
}

const W          = 96
const H          = 54
const Y_TOP      = Math.floor(H * 0.30)   // skip ceiling; corridor lines live below
const Y_BOT      = Math.floor(H * 0.98)
const MAG_THRESH = 60                     // min Sobel magnitude to count as an edge
const HFOV_DEG   = 60
const VFOV_DEG   = 40

// Vanishing point
const VP_SMOOTH  = 0.25
const VP_GAIN    = HFOV_DEG / 2
const VP_PITCH_G = VFOV_DEG / 2

// Wobble odometry
const SEARCH     = 4
const DECAY      = 0.9
const WOBBLE_G   = 0.6                     // contribution of the wobble layer

const MAX_YAW    = 40
const MAX_PITCH  = 22
const MIN_DT_MS  = 40                      // ~25 fps

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function useHallwayDirection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
): { motion: React.RefObject<Motion>; vp: React.RefObject<VP> } {
  const motionRef = useRef<Motion>({ yaw: 0, pitch: 0 })
  const vpRef     = useRef<VP>({ x: 0.5, y: 0.42, valid: false })
  const vpSmooth  = useRef<{ x: number; y: number }>({ x: W / 2, y: H * 0.42 })
  const wobbleRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 })
  const prevRef   = useRef<Float32Array | null>(null)
  const rafRef    = useRef<number | null>(null)
  const lastRef   = useRef(0)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width  = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const grab = (): Float32Array | null => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) return null
      ctx.drawImage(video, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)
      const gray = new Float32Array(W * H)
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      }
      return gray
    }

    // (1) Weighted least-squares vanishing point of the floor/wall lines.
    const estimateVP = (gray: Float32Array): { x: number; y: number } | null => {
      let Sxx = 0, Sxy = 0, Syy = 0, bx = 0, by = 0, count = 0
      for (let y = Y_TOP + 1; y < Y_BOT - 1; y++) {
        const row = y * W
        for (let x = 1; x < W - 1; x++) {
          const i = row + x
          const gx =
            gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1] -
            gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1]
          const gy =
            gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1] -
            gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1]
          const mag = Math.abs(gx) + Math.abs(gy)
          if (mag < MAG_THRESH) continue
          const len = Math.hypot(gx, gy)
          const nx = gx / len
          const ny = gy / len
          const c  = nx * x + ny * y
          const w  = mag
          Sxx += w * nx * nx
          Sxy += w * nx * ny
          Syy += w * ny * ny
          bx  += w * nx * c
          by  += w * ny * c
          count++
        }
      }
      if (count < 30) return null
      const det = Sxx * Syy - Sxy * Sxy
      if (Math.abs(det) < 1e-3) return null
      const vx = (Syy * bx - Sxy * by) / det
      const vy = (Sxx * by - Sxy * bx) / det
      if (vx < -W || vx > 2 * W || vy < -H || vy > H * 1.2) return null
      return { x: vx, y: vy }
    }

    // (2) Global frame-to-frame shift (camera rotation) via SAD block search.
    const estimateShift = (prev: Float32Array, cur: Float32Array) => {
      let best = { dx: 0, dy: 0, score: Infinity }
      for (let dy = -SEARCH; dy <= SEARCH; dy++) {
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          let s = 0
          for (let y = SEARCH; y < H - SEARCH; y += 2) {
            const row = y * W
            const prow = (y + dy) * W + dx
            for (let x = SEARCH; x < W - SEARCH; x += 2) {
              s += Math.abs(cur[row + x] - prev[prow + x])
            }
          }
          if (s < best.score) best = { dx, dy, score: s }
        }
      }
      return best
    }

    const tick = (t: number) => {
      rafRef.current = requestAnimationFrame(tick)
      if (t - lastRef.current < MIN_DT_MS) return
      lastRef.current = t

      const cur = grab()
      if (!cur) { prevRef.current = null; vpRef.current.valid = false; return }

      // --- (1) vanishing point ---
      const vp = estimateVP(cur)
      if (vp) {
        vpSmooth.current.x += (vp.x - vpSmooth.current.x) * VP_SMOOTH
        vpSmooth.current.y += (vp.y - vpSmooth.current.y) * VP_SMOOTH
        vpRef.current.valid = true
      } else {
        vpRef.current.valid = false
      }
      vpRef.current.x = clamp(vpSmooth.current.x / W, 0, 1)
      vpRef.current.y = clamp(vpSmooth.current.y / H, 0, 1)

      const nx = clamp((vpSmooth.current.x - W / 2) / (W / 2), -1.5, 1.5)
      const ny = clamp((H * 0.42 - vpSmooth.current.y) / (H * 0.42), -1.2, 1.2)
      const vpYaw   = nx * VP_GAIN
      const vpPitch = ny * VP_PITCH_G

      // --- (2) wobble odometry ---
      const prev = prevRef.current
      prevRef.current = cur
      if (prev) {
        const { dx, dy } = estimateShift(prev, cur)
        const yawDelta   = -(HFOV_DEG * dx / W)
        const pitchDelta = -(VFOV_DEG * dy / H)
        wobbleRef.current.yaw   = clamp((wobbleRef.current.yaw   + yawDelta)   * DECAY, -MAX_YAW,   MAX_YAW)
        wobbleRef.current.pitch = clamp((wobbleRef.current.pitch + pitchDelta) * DECAY, -MAX_PITCH, MAX_PITCH)
      }

      // --- combine ---
      motionRef.current.yaw   = clamp(vpYaw   + WOBBLE_G * wobbleRef.current.yaw,   -MAX_YAW,   MAX_YAW)
      motionRef.current.pitch = clamp(vpPitch + WOBBLE_G * wobbleRef.current.pitch, -MAX_PITCH, MAX_PITCH)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      prevRef.current = null
    }
  }, [videoRef])

  return { motion: motionRef, vp: vpRef }
}
