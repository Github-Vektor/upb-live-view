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
const Y_TOP      = Math.floor(H * 0.50)   // only the bottom half ever has floor tiles
const Y_BOT      = Math.floor(H * 0.98)
const MAG_THRESH = 60                     // min Sobel magnitude to count as an edge
const HFOV_DEG   = 60
const VFOV_DEG   = 40

// Vanishing point
const VP_SMOOTH  = 0.40
const INIT_FALLBACK_TICKS = 20            // give up waiting for the grid after ~0.8 s
const VP_GAIN    = HFOV_DEG / 2
const VP_PITCH_G = VFOV_DEG / 2

// Wobble odometry (parallax), seeded at the grid VP
const SEARCH       = 4
const GRID_CORRECT = 0.15   // how strongly the fused estimate is pulled to the grid

const MAX_YAW    = 40
const MAX_PITCH  = 22
const MIN_DT_MS  = 40                      // ~25 fps

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// Map a yaw/pitch (degrees) back to a normalised image point, so the wobble and
// fused estimates can be drawn as on-screen markers alongside the grid VP.
const BASE_Y = 0.42
function yawToX(yaw: number)   { return clamp(0.5 + (yaw / VP_GAIN) * 0.5, 0, 1) }
function pitchToY(pitch: number) { return clamp(BASE_Y * (1 - pitch / VP_PITCH_G), 0, 1) }

export function useHallwayDirection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
): {
  motion: React.RefObject<Motion>
  grid: React.RefObject<VP>
  wobble: React.RefObject<VP>
  combined: React.RefObject<VP>
} {
  const motionRef   = useRef<Motion>({ yaw: 0, pitch: 0 })
  const gridRef     = useRef<VP>({ x: 0.5, y: BASE_Y, valid: false })
  const wobbleVp    = useRef<VP>({ x: 0.5, y: BASE_Y, valid: false })
  const combinedVp  = useRef<VP>({ x: 0.5, y: BASE_Y, valid: false })
  const vpSmooth    = useRef<{ x: number; y: number }>({ x: W / 2, y: H * BASE_Y })
  const wobbleRef   = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 })
  const fusedRef    = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 })
  const initRef     = useRef(false)
  const initTries   = useRef(0)
  const gridSeeded  = useRef(false)
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
          // Prioritise lines higher up the feed (nearer the vanishing point,
          // where the corridor lines converge most informatively).
          const yb = (y - Y_TOP) / (Y_BOT - Y_TOP)   // 0 top → 1 bottom
          const w  = mag * (0.6 + 0.8 * (1 - yb))
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
      if (!cur) {
        prevRef.current = null
        gridRef.current.valid = false
        wobbleVp.current.valid = false
        combinedVp.current.valid = false
        return
      }

      // --- (1) vanishing point from the grid ---
      const vp = estimateVP(cur)
      if (vp) {
        if (!gridSeeded.current) {
          // Snap to the first detection so the grid marker (and the wobble seed
          // taken from it) start exactly on the real vanishing point.
          vpSmooth.current.x = vp.x
          vpSmooth.current.y = vp.y
          gridSeeded.current = true
        } else {
          vpSmooth.current.x += (vp.x - vpSmooth.current.x) * VP_SMOOTH
          vpSmooth.current.y += (vp.y - vpSmooth.current.y) * VP_SMOOTH
        }
        gridRef.current.valid = true
      } else {
        gridRef.current.valid = false
      }
      gridRef.current.x = clamp(vpSmooth.current.x / W, 0, 1)
      gridRef.current.y = clamp(vpSmooth.current.y / H, 0, 1)

      const nx = clamp((vpSmooth.current.x - W / 2) / (W / 2), -1.5, 1.5)
      const ny = clamp((H * BASE_Y - vpSmooth.current.y) / (H * BASE_Y), -1.2, 1.2)
      const vpYaw   = nx * VP_GAIN
      const vpPitch = ny * VP_PITCH_G

      // --- (2) wobble odometry (parallax), seeded at the grid VP ---
      const prev = prevRef.current
      prevRef.current = cur
      let dYaw = 0, dPitch = 0
      if (prev) {
        const { dx, dy } = estimateShift(prev, cur)
        dYaw   = -(HFOV_DEG * dx / W)
        dPitch = -(VFOV_DEG * dy / H)
      }

      if (!initRef.current) {
        // Seed both dead-reckoning estimates AT the grid vanishing point. Wait for
        // a valid grid so the wobble truly starts on it; only fall back to centre
        // if the grid never appears (plain/blank footage).
        initTries.current++
        if (gridRef.current.valid || initTries.current > INIT_FALLBACK_TICKS) {
          const seedYaw   = gridRef.current.valid ? vpYaw   : 0
          const seedPitch = gridRef.current.valid ? vpPitch : 0
          wobbleRef.current.yaw   = seedYaw
          wobbleRef.current.pitch = seedPitch
          fusedRef.current.yaw    = seedYaw
          fusedRef.current.pitch  = seedPitch
          initRef.current = true
        }
      } else {
        // Wobble: pure dead-reckoning from the grid seed (free to drift).
        wobbleRef.current.yaw   = clamp(wobbleRef.current.yaw   + dYaw,   -MAX_YAW,   MAX_YAW)
        wobbleRef.current.pitch = clamp(wobbleRef.current.pitch + dPitch, -MAX_PITCH, MAX_PITCH)

        // Fused: dead-reckon, then correct toward the grid VP when available
        // (complementary filter — smooth like wobble, anchored like the grid).
        fusedRef.current.yaw   = clamp(fusedRef.current.yaw   + dYaw,   -MAX_YAW,   MAX_YAW)
        fusedRef.current.pitch = clamp(fusedRef.current.pitch + dPitch, -MAX_PITCH, MAX_PITCH)
        if (gridRef.current.valid) {
          fusedRef.current.yaw   += (vpYaw   - fusedRef.current.yaw)   * GRID_CORRECT
          fusedRef.current.pitch += (vpPitch - fusedRef.current.pitch) * GRID_CORRECT
        }
      }

      wobbleVp.current.x = yawToX(wobbleRef.current.yaw)
      wobbleVp.current.y = pitchToY(wobbleRef.current.pitch)
      wobbleVp.current.valid = initRef.current

      motionRef.current.yaw   = fusedRef.current.yaw
      motionRef.current.pitch = fusedRef.current.pitch
      combinedVp.current.x = yawToX(fusedRef.current.yaw)
      combinedVp.current.y = pitchToY(fusedRef.current.pitch)
      combinedVp.current.valid = initRef.current
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      prevRef.current = null
    }
  }, [videoRef])

  return { motion: motionRef, grid: gridRef, wobble: wobbleVp, combined: combinedVp }
}
