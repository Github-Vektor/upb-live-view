import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Motion } from './useHallwayDirection'

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
  /** Fused yaw/pitch (degrees) the chevrons should rotate by. */
  motionRef?: React.RefObject<Motion>
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
      const s = 1 - 0.12 * Math.abs(i - (CHEVRONS - 1) / 2)
      chevron.scale.set(s, s, 1)
      path.add(chevron)
    }

    const pivot = new THREE.Group()
    pivot.add(path)
    scene.add(pivot)

    // Fixed screen anchor for the middle chevron: horizontal centre, middle of
    // the bottom third (screen y ≈ 0.833 → NDC y).
    const ANCHOR_NDC_Y = -(0.833 * 2 - 1)
    const ANCHOR_DIST  = 2.5
    const _v   = new THREE.Vector3()
    const _dir = new THREE.Vector3()

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

        // Rotate by the fused yaw/pitch (degrees), amplified so the chevrons
        // visibly swing/tilt even for modest hallway-end deviations.
        const motion = extrasRef.current?.motionRef?.current
        const yaw    = (motion ? motion.yaw : 0) * 1.8
        const pitch  = (motion ? motion.pitch : 0) * 1.8

        // Yaw about the pivot's vertical axis (middle chevron is on that axis → stays put).
        // headingDeg=0 → forward, +yaw → toward a hall-end on the right.
        pivot.rotation.y = -((headingDeg + yaw) * Math.PI) / 180
        // Pitch about path's X axis through the origin (middle chevron stays put).
        path.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitch, -32, 32))

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
