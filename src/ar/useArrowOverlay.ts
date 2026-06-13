import { useEffect, useRef } from 'react'
import * as THREE from 'three'

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
) {
  const optionsRef  = useRef(options)
  const matRef      = useRef<THREE.MeshBasicMaterial | null>(null)
  const groupRef    = useRef<THREE.Group | null>(null)
  const clockRef    = useRef(new THREE.Clock())
  const rafRef      = useRef<number | null>(null)

  useEffect(() => { optionsRef.current = options }, [options])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0x000000, 0)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 100)
    // Eye height, tilted down toward the floor ahead so the floor-projected
    // chevrons land in the lower-centre of the frame (Google Live View style).
    camera.position.set(0, 1.6, 0)
    camera.lookAt(0, 0, -2.5)

    // --- Arrow geometry: a row of receding floor chevrons ----------------
    const mat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    matRef.current = mat
    const geo = new THREE.ShapeGeometry(buildArrowShape())

    // Group lies flat on the virtual floor ahead of the camera. Each chevron is
    // offset along local +Y, which maps to world -Z (forward) after the tilt, so
    // they recede into the distance pointing the way to go.
    const group = new THREE.Group()
    const CHEVRONS = 3
    for (let i = 0; i < CHEVRONS; i++) {
      const chevron = new THREE.Mesh(geo, mat)
      chevron.position.set(0, i * 0.6, 0)
      const s = 1 - i * 0.12
      chevron.scale.set(s, s, 1)
      group.add(chevron)
    }
    group.rotation.x = -Math.PI / 2   // shape's +Y → world -Z (forward)
    group.position.set(0, 0.02, -1.8)
    scene.add(group)
    groupRef.current = group

    // --- Resize observer -------------------------------------------------
    const resize = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // --- Render loop ------------------------------------------------------
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate)
      const { headingDeg, visible, confidence } = optionsRef.current
      const t = clockRef.current.getElapsedTime()

      group.visible = visible
      if (visible) {
        // Correct heading: Y rotation after flat X rotation.
        // headingDeg=0 → forward (-Z), 90 → right (+X), 180 → back (+Z)
        group.rotation.y = -(headingDeg * Math.PI) / 180

        // Pulse around a base size so the chevrons read clearly.
        const pulse = 1.5 * (0.95 + 0.05 * Math.sin(t * 2.8))
        group.scale.set(pulse, pulse, 1)

        // Opacity: kept clearly visible, lifted further by confidence, with a
        // gentle pulse so it feels alive even when localisation is uncertain.
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
