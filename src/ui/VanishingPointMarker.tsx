import { useEffect, useRef } from 'react'
import type { VP } from '../ar/useHallwayDirection'

/**
 * Debug overlay: draws a marker at the detected hallway vanishing point. Reads
 * the VP ref on its own animation frame (no React re-renders) and maps the
 * normalised image coords onto the letterboxed video display rect.
 */
export default function VanishingPointMarker({
  videoRef,
  vpRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  vpRef: React.RefObject<VP>
}) {
  const dotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = requestAnimationFrame(update)
      const dot = dotRef.current
      const video = videoRef.current
      const vp = vpRef.current
      if (!dot || !video || !vp) return
      if (!vp.valid || video.videoWidth === 0) {
        dot.style.opacity = '0'
        return
      }
      // The <video> box fills the stage; the image is letterboxed inside it.
      const bw = video.clientWidth
      const bh = video.clientHeight
      const vAR = video.videoWidth / video.videoHeight
      const bAR = bw / bh
      let dispW: number, dispH: number, offX: number, offY: number
      if (vAR < bAR) {
        dispH = bh; dispW = bh * vAR; offX = (bw - dispW) / 2; offY = 0
      } else {
        dispW = bw; dispH = bw / vAR; offX = 0; offY = (bh - dispH) / 2
      }
      dot.style.opacity = '1'
      dot.style.left = `${offX + vp.x * dispW}px`
      dot.style.top = `${offY + vp.y * dispH}px`
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [videoRef, vpRef])

  return (
    <div ref={dotRef} className="vp-marker">
      <span className="vp-marker__label">END</span>
    </div>
  )
}
