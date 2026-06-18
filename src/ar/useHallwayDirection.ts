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

const W          = 160
const H          = 90
const Y_TOP      = Math.floor(H * 0.50)   // only the bottom half ever has floor tiles
const Y_BOT      = Math.floor(H * 0.98)
const MAG_THRESH = 35                     // min Sobel magnitude to count as an edge
const HFOV_DEG   = 60
const VFOV_DEG   = 40

// Vanishing point
const VP_SMOOTH  = 0.40
const HV_RATIO   = 2.2   // gradient-axis dominance to count an edge as H or V
const VP_GAIN    = HFOV_DEG / 2
const VP_PITCH_G = VFOV_DEG / 2

// Wobble odometry (parallax), seeded at the grid VP
const SEARCH       = 4
const GRID_CORRECT = 0.05   // low → the fused estimate leans on the wobble (parallax)

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
  /** Optional debug canvas — when mounted, the edges + vanishing point used for
   *  the fit are drawn to it ("lines only" view). */
  debugCanvasRef?: React.RefObject<HTMLCanvasElement | null>,
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
  const gridSeeded  = useRef(false)
  const prevRef   = useRef<Float32Array | null>(null)
  const rafRef    = useRef<number | null>(null)
  const lastRef   = useRef(0)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width  = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    // Offscreen buffer for the debug edge image (scaled up onto the visible canvas).
    const edgeCanvas = document.createElement('canvas')
    edgeCanvas.width  = W
    edgeCanvas.height = H
    const edgeCtx = edgeCanvas.getContext('2d')!
    const edgeImg = edgeCtx.createImageData(W, H)
    const isRed = new Uint8Array(W * H)  // vertical-line pixels, for run-length weighting

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

    // (1) Vanishing point.
    //  - horizontal (x): weighted least-squares convergence (the current method).
    //  - vertical (y): LENGTH-WEIGHTED median height of the red (vertical-line)
    //    runs — longer vertical lines count more, so the prominent grout lines
    //    win over scattered speckle.
    const VP_Y_MAX = H * 0.75   // keep the VP above the bottom quarter of the screen
    const MIN_RUN  = 3          // ignore vertical runs shorter than this (speckle)
    const runYs: number[] = []
    const runWs: number[] = []
    const estimateVP = (gray: Float32Array): { x: number; y: number } | null => {
      let Sxx = 0, Sxy = 0, Syy = 0, bx = 0, by = 0, count = 0
      isRed.fill(0)
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
          const ax = Math.abs(gx), ay = Math.abs(gy)
          const mag = ax + ay
          if (mag < MAG_THRESH) continue

          // Vertical line (gradient mostly horizontal): keep it for the
          // vertical-run height estimate below, but EXCLUDE it from the
          // horizontal vanishing-point fit. Door/window frames are vertical in
          // 3D and converge to a vertical VP, not the corridor's end, so
          // including them drags vx toward whichever wall carries more frames
          // (the door side of the corridor).
          if (ax > ay * HV_RATIO) { isRed[i] = 1; continue }

          const len = Math.hypot(gx, gy)
          const nx = gx / len
          const ny = gy / len
          const c  = nx * x + ny * y
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

      // Gentle centre prior on the horizontal vanishing point: a soft "vx is
      // near the image centre" vote, weighted as a small fraction of the
      // accumulated edge evidence. On a straight corridor the true VP is near
      // centre, so this resolves ambiguity and stops any remaining one-sided
      // clutter (e.g. a cluster of diagonal door edges) from swinging vx to a
      // wall — without overriding a genuinely off-centre VP when the evidence
      // is strong. Tune via REG_FRAC (0 = off).
      const REG_FRAC = 0.18
      const reg = REG_FRAC * Sxx
      Sxx += reg
      bx  += reg * (W / 2)

      const det = Sxx * Syy - Sxy * Sxy
      if (Math.abs(det) < 1e-3) return null
      const vx = (Syy * bx - Sxy * by) / det
      if (vx < -W || vx > 2 * W) return null

      // Find vertical runs of red pixels per column; each run contributes its
      // midpoint with weight = run length (longer line → higher weight).
      runYs.length = 0
      runWs.length = 0
      let totalW = 0
      for (let x = 0; x < W; x++) {
        let start = -1
        for (let y = Y_TOP; y <= Y_BOT; y++) {
          const red = y < Y_BOT && isRed[y * W + x] === 1
          if (red) {
            if (start < 0) start = y
          } else if (start >= 0) {
            const L = y - start
            if (L >= MIN_RUN) { runYs.push((start + y - 1) / 2); runWs.push(L); totalW += L }
            start = -1
          }
        }
      }

      let vy: number
      if (totalW > 0) {
        // length-weighted median of the run midpoints
        const order = runYs.map((_, k) => k).sort((a, b) => runYs[a] - runYs[b])
        let acc = 0
        vy = runYs[order[order.length - 1]]
        for (const k of order) {
          acc += runWs[k]
          if (acc >= totalW / 2) { vy = runYs[k]; break }
        }
      } else {
        vy = (Sxx * by - Sxy * bx) / det
      }
      vy = clamp(vy, 0, VP_Y_MAX)
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

    // Debug view: classify each strong edge by orientation and colour it —
    //   RED   = vertical line   (gradient mostly horizontal)
    //   BLUE  = horizontal line (gradient mostly vertical)
    //   dim   = diagonal / other
    // so horizontal vs. vertical grout structure is readable.
    const drawDebug = (gray: Float32Array) => {
      const dbg = debugCanvasRef?.current
      if (!dbg) return
      const cw = dbg.clientWidth || W
      const ch = dbg.clientHeight || H
      if (dbg.width !== cw || dbg.height !== ch) { dbg.width = cw; dbg.height = ch }
      const d = dbg.getContext('2d')
      if (!d) return

      const px = edgeImg.data
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          const p = i * 4
          let gx = 0, gy = 0
          if (x > 0 && x < W - 1 && y > 0 && y < H - 1) {
            gx =
              gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1] -
              gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1]
            gy =
              gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1] -
              gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1]
          }
          const ax = Math.abs(gx), ay = Math.abs(gy)
          const mag = ax + ay
          let r = 0, g = 0, b = 0
          if (mag >= MAG_THRESH) {
            const v = Math.min(255, mag * 0.6)
            if (ax > ay * HV_RATIO)      { r = v }               // vertical line
            else if (ay > ax * HV_RATIO) { b = v }               // horizontal line
            else                          { g = v * 0.35 }        // diagonal — dim
          }
          px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255
        }
      }
      edgeCtx.putImageData(edgeImg, 0, 0)

      d.imageSmoothingEnabled = false
      d.clearRect(0, 0, cw, ch)
      d.drawImage(edgeCanvas, 0, 0, W, H, 0, 0, cw, ch)

      // fitted vanishing point (x = least-squares, y = median vertical-line height)
      const vx = gridRef.current.x * cw
      const vy = gridRef.current.y * ch
      d.strokeStyle = gridRef.current.valid ? '#ffd400' : 'rgba(255,212,0,0.4)'
      d.lineWidth = 2
      d.beginPath(); d.arc(vx, vy, 9, 0, Math.PI * 2); d.stroke()
      d.beginPath(); d.moveTo(vx - 14, vy); d.lineTo(vx + 14, vy)
      d.moveTo(vx, vy - 14); d.lineTo(vx, vy + 14); d.stroke()

      // legend
      d.font = '12px sans-serif'
      d.fillStyle = '#ff5050'; d.fillText('■ vertical', 8, 18)
      d.fillStyle = '#5080ff'; d.fillText('■ horizontal', 8, 34)
      d.fillStyle = '#ffd400'; d.fillText('+ VP', 8, 50)
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
        // Initialise the dead-reckoning estimates at the CENTRE of the screen
        // (yaw 0, pitch 0); the grid correction then pulls them toward the VP.
        wobbleRef.current.yaw   = 0
        wobbleRef.current.pitch = 0
        fusedRef.current.yaw    = 0
        fusedRef.current.pitch  = 0
        initRef.current = true
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

      drawDebug(cur)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      prevRef.current = null
    }
  }, [videoRef])

  return { motion: motionRef, grid: gridRef, wobble: wobbleVp, combined: combinedVp }
}
