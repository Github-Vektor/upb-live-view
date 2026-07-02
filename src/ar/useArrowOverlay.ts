import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { VP, Motion } from './useHallwayDirection'
import type { DirectionNudge } from '../navigation/directionNudge'

export interface ArrowOverlayOptions {
  /**
   * Relative heading in degrees: 0 = straight ahead, 90 = right, 180 = back, 270 = left.
   * Computed as (routeHeading - compassHeading + 360) % 360 by the caller.
   */
  headingDeg: number
  visible: boolean
  /** 0–1 localisation confidence — scales arrow opacity. */
  confidence: number
}

export interface ArrowOverlayExtras {
  /** Video element — the canvas is fitted to its letterboxed rect so screen
   *  space matches the video (and any debug markers drawn over it). */
  videoRef?: React.RefObject<HTMLVideoElement | null>
  /** Fused vanishing point (normalised image coords) the chevrons should aim at. */
  targetRef?: React.RefObject<VP>
  /** Manual i/j/k/l/o nudge (see useDirectionNudge) — its yaw applies on top of
   *  headingDeg whenever `targetRef` isn't driving the arrow (e.g. a w/a/s/d
   *  override), so the same nudge keeps working no matter which is active. */
  nudgeRef?: React.RefObject<DirectionNudge>
  /** Pure wobble (parallax dead-reckoning) yaw/pitch, in degrees — added on
   *  top of headingDeg whenever `targetRef` isn't driving the arrow, so a
   *  manual w/a/s/d override still reacts to the camera's natural wobble
   *  instead of holding a perfectly rigid heading. */
  wobbleRef?: React.RefObject<Motion>
}

// How quickly the arrow eases toward a new heading when it isn't following a
// tracked vanishing point (manual w/a/s/d turns, or a route-heading change on
// the live camera view) — fraction of the remaining angular gap closed per
// frame. Lower = smoother/slower, higher = snappier.
const TURN_SMOOTH = 0.12

// Resting vertical aim of the floor-projected chevrons (Google Live View
// style — camera at eye height, tilted down at the floor just ahead). Pitch
// nudge/wobble can lift the arrow above this but never push it lower.
const BASE_TARGET_Y = -0.29

// How much of the raw wobble signal (which can drift up to ±40° yaw on its
// own) reaches the arrow when it's headingDeg-driven. Kept well under 1 so
// wobble reads as natural jitter around the current heading rather than
// something that can swamp or cancel out a deliberate w/a/s/d turn.
const WOBBLE_INFLUENCE = 0.3

/** Shortest signed angular distance from `a` to `b`, in degrees, in (-180, 180]. */
function angleDelta(a: number, b: number): number {
  return ((b - a) % 360 + 540) % 360 - 180
}

function buildArrowShape(): THREE.Shape {
  // Chevron arrow pointing +Y in local XY plane.
  // The group is rotated -90° around X so it lies flat on the virtual floor pointing -Z (forward).
  const s = new THREE.Shape()
  s.moveTo(0, 0.45)        // tip
  s.lineTo(0.28, 0.02)     // right shoulder
  s.lineTo(0.12, 0.02)     // right notch
  s.lineTo(0.12, -0.45)    // right tail
  s.lineTo(-0.12, -0.45)   // left tail
  s.lineTo(-0.12, 0.02)    // left notch
  s.lineTo(-0.28, 0.02)    // left shoulder
  s.closePath()
  return s
}

export function useArrowOverlay(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: ArrowOverlayOptions,
  extras?: ArrowOverlayExtras,
) {
  const optionsRef = useRef(options)
  const extrasRef  = useRef(extras)
  const clockRef   = useRef(new THREE.Clock())
  const rafRef     = useRef<number | null>(null)

  useEffect(() => { optionsRef.current = options }, [options])
  useEffect(() => { extrasRef.current = extras }, [extras])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x000000, 0)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    // Eye height, tilted down toward the floor just ahead so the floor-projected
    // chevrons sit low in the frame (Google Live View style).
    camera.position.set(0, 1.6, 0)
    camera.lookAt(0, 0, -3.0)

    // --- Arrow geometry: a row of chevrons, CENTRED on their middle ---------
    // The chevrons sit in `path`, arranged symmetrically about the local origin
    // (the middle chevron is at the origin). `path` lives in `pivot`, which is
    // anchored to a fixed screen point (the middle of the bottom third). Because
    // the middle chevron is at the pivot/path origin, every rotation (yaw about
    // the pivot's vertical axis, pitch about path's X axis) leaves the middle
    // fixed on that screen point while the ends swing/tilt.
    const mat = new THREE.MeshBasicMaterial({ color: 0x2ecc40, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    const geo = new THREE.ShapeGeometry(buildArrowShape())
    const path = new THREE.Group()
    const CHEVRONS = 3
    const SPACING  = 0.6
    for (let i = 0; i < CHEVRONS; i++) {
      const chevron = new THREE.Mesh(geo, mat)
      chevron.position.set(0, (i - (CHEVRONS - 1) / 2) * SPACING, 0)  // …,-SP, 0, +SP
      chevron.rotation.z = Math.PI  // flip the arrowheads 180°
      const s = 1 - 0.12 * Math.abs(i - (CHEVRONS - 1) / 2)
      chevron.scale.set(s, s, 1)
      path.add(chevron)
    }

    // Tip (+Y) maps to the pivot's forward (-Z); the chevrons recede forward and
    // the pivot is aimed (lookAt) at the target, so they point at it.
    path.rotation.x = -Math.PI / 2

    const pivot = new THREE.Group()
    pivot.add(path)
    scene.add(pivot)

    // Fixed screen anchor for the middle chevron: horizontal centre, middle of
    // the bottom third (screen y ≈ 0.833 → NDC y).
    const ANCHOR_NDC_Y = -(0.833 * 2 - 1)
    const ANCHOR_DIST  = 2.5
    const _v      = new THREE.Vector3()
    const _dir    = new THREE.Vector3()
    const _target = new THREE.Vector3()

    // Fit the canvas to the video's letterboxed display rect (so the 3D scene
    // shares coordinates with the video image), or fill the parent if no video.
    let lastW = 0, lastH = 0
    const fitCanvas = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const bw = parent.clientWidth
      const bh = parent.clientHeight
      const video = extrasRef.current?.videoRef?.current
      let w = bw, h = bh, x = 0, y = 0
      if (video && video.videoWidth > 0) {
        const vAR = video.videoWidth / video.videoHeight
        const bAR = bw / bh
        if (vAR < bAR) { h = bh; w = bh * vAR; x = (bw - w) / 2; y = 0 }
        else           { w = bw; h = bw / vAR; x = 0; y = (bh - h) / 2 }
      }
      canvas.style.left = `${x}px`
      canvas.style.top = `${y}px`
      canvas.style.right = 'auto'
      canvas.style.bottom = 'auto'
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      if (w !== lastW || h !== lastH) {
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        lastW = w; lastH = h
      }
    }
    const ro = new ResizeObserver(fitCanvas)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    // Eased heading used whenever the arrow points per headingDeg rather than
    // a tracked vanishing point — lets manual turns (and route heading
    // changes) rotate smoothly instead of snapping instantly.
    let smoothedHeading: number | null = null

    // --- Render loop ------------------------------------------------------
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate)
      fitCanvas()  // also picks up the video size once it loads
      const { headingDeg, visible, confidence } = optionsRef.current
      const t = clockRef.current.getElapsedTime()

      pivot.visible = visible
      if (visible) {
        // Pin the pivot (and thus the middle chevron) to the fixed screen anchor:
        // cast the camera ray through the anchor NDC and place the pivot along it.
        _v.set(0, ANCHOR_NDC_Y, 0.5).unproject(camera)
        _dir.copy(_v).sub(camera.position).normalize()
        pivot.position.copy(camera.position).addScaledVector(_dir, ANCHOR_DIST)

        // Aim the chevrons at the fused vanishing point: unproject it to a world
        // point and lookAt it, so the receding path points exactly at the marker.
        const target = extrasRef.current?.targetRef?.current
        if (target && target.valid) {
          _v.set(target.x * 2 - 1, -(target.y * 2 - 1), 0.5).unproject(camera)
          _dir.copy(_v).sub(camera.position).normalize()
          _target.copy(camera.position).addScaledVector(_dir, 10)
          smoothedHeading = null  // re-seed from scratch if we fall back to headingDeg later
        } else {
          // No target (e.g. live camera view, or a manual w/a/s/d override):
          // point forward per the route/manual heading, easing toward it
          // rather than snapping so turns read smoothly.
          if (smoothedHeading === null) smoothedHeading = headingDeg
          smoothedHeading += angleDelta(smoothedHeading, headingDeg) * TURN_SMOOTH
          smoothedHeading = ((smoothedHeading % 360) + 360) % 360

          // The i/j/k/l nudge applies here too (not just to the tracked
          // vanishing point above), so it keeps working while a w/a/s/d
          // override — or any other headingDeg-driven heading — is active.
          // Yaw (j/l) steers left/right; pitch (i/k) steers up/down — without
          // this, up/down had no effect at all whenever this branch (rather
          // than the tracked vanishing point) was driving the arrow.
          const activeNudge = extrasRef.current?.nudgeRef?.current
          const nudgeYawDeg  = activeNudge?.yawDeg ?? 0
          const nudgePitch   = activeNudge?.pitchOffset ?? 0

          // The camera's natural wobble (parallax dead-reckoning) rides on
          // top too, so a manual override still reacts to how the phone is
          // actually moving instead of holding a perfectly rigid heading.
          // Damped to a fraction of its raw range (which can drift up to
          // ±40° yaw) — at full strength it could swing past, or even
          // cancel out, a deliberate 30° a/d turn, making "d" look like it
          // sometimes didn't turn the arrow right at all. Both are in
          // degrees; pitch is scaled down to the same rough magnitude as
          // `nudgePitch` (a raw offset, not degrees) using the hook's own
          // pitch gain (2x VFOV_DEG/2 = 40). Motion.pitch is "+ = higher in
          // frame" (opposite sign to nudgePitch, which is "+ = down"), so
          // it's added rather than subtracted.
          const wobble = extrasRef.current?.wobbleRef?.current
          const wobbleYawDeg = (wobble?.yaw ?? 0) * WOBBLE_INFLUENCE
          const wobblePitch  = wobble ? (wobble.pitch / 40) * WOBBLE_INFLUENCE : 0

          const th = THREE.MathUtils.degToRad(smoothedHeading + nudgeYawDeg + wobbleYawDeg)
          // Nudge/wobble can lift the arrow above its resting floor-projected
          // tilt (BASE_TARGET_Y), but never push it further down than that —
          // it should never point downward more steeply than the baseline.
          const y = Math.max(BASE_TARGET_Y - nudgePitch + wobblePitch, BASE_TARGET_Y)
          _target.set(Math.sin(th) * 0.95, y, -Math.cos(th) * 0.95)
            .multiplyScalar(10).add(pivot.position)
        }
        pivot.lookAt(_target)

        // Pulse around a base size (about the origin, so the middle stays fixed).
        const pulse = 0.7 * (0.95 + 0.05 * Math.sin(t * 2.8))
        path.scale.set(pulse, pulse, 1)

        // Opacity: clearly visible, lifted by confidence, with a gentle pulse.
        const base  = 0.55 + 0.45 * Math.min(confidence, 1)
        mat.opacity = base * (0.85 + 0.15 * Math.sin(t * 2.8))
      }

      renderer.render(scene, camera)
    }
    animate()

    return () => {
      ro.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      renderer.dispose()
    }
  }, [canvasRef])
}
