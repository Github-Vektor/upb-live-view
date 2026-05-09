import { useCallback, useEffect, useState } from 'react'

export type OrientationStatus = 'unsupported' | 'needs-permission' | 'active' | 'denied'

export interface DeviceOrientationState {
  /** Compass bearing in degrees: 0 = north, 90 = east, clockwise. 0 when unavailable. */
  compassHeading: number
  status: OrientationStatus
  /** Call this from a user-gesture handler (button tap) — required on iOS 13+. */
  requestPermission: () => Promise<void>
}

function needsIOSPermission(): boolean {
  return (
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function'
  )
}

function extractHeading(e: DeviceOrientationEvent): number | null {
  // iOS: webkitCompassHeading is 0=north, clockwise — use directly
  const ios = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading
  if (ios != null) return ios

  // Android absolute: alpha is counterclockwise from north when device is flat
  if ((e as DeviceOrientationEvent & { absolute?: boolean }).absolute && e.alpha != null) {
    return (360 - e.alpha) % 360
  }
  return null
}

export function useDeviceOrientation(): DeviceOrientationState {
  const [compassHeading, setCompassHeading] = useState(0)
  const [status, setStatus] = useState<OrientationStatus>(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return 'unsupported'
    if (needsIOSPermission()) return 'needs-permission'
    return 'active'
  })

  useEffect(() => {
    if (status !== 'active') return

    function onOrientation(e: DeviceOrientationEvent) {
      const h = extractHeading(e)
      if (h != null) setCompassHeading(h)
    }

    // Prefer the absolute variant (Android Chrome) then fall back
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, true)
    window.addEventListener('deviceorientation', onOrientation as EventListener, true)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener, true)
      window.removeEventListener('deviceorientation', onOrientation as EventListener, true)
    }
  }, [status])

  const requestPermission = useCallback(async () => {
    if (!needsIOSPermission()) {
      setStatus('active')
      return
    }
    try {
      const result = await (
        DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission()
      setStatus(result === 'granted' ? 'active' : 'denied')
    } catch {
      setStatus('denied')
    }
  }, [])

  return { compassHeading, status, requestPermission }
}
