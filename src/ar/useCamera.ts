import { useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'error'

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: CameraStatus
  error: string | null
}

export function useCamera(): CameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null

    async function start() {
      setStatus('requesting')
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStatus('active')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Camera unavailable'
        setError(msg)
        setStatus('error')
      }
    }

    start()

    return () => {
      stream?.getTracks().forEach(t => t.stop())
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [])

  return { videoRef, status, error }
}
