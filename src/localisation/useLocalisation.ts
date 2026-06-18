import { useCallback, useEffect, useRef, useState } from 'react'
import { queryFrame, checkServerStatus } from './LocalisationService'

export type LocalisationStatus = 'unavailable' | 'idle' | 'querying' | 'ok' | 'error'

export interface Timing {
  captureMs:   number
  inferenceMs: number
  totalMs:     number
}

export interface LocalisationState {
  nodeId:     string | null
  confidence: number
  status:     LocalisationStatus
  timing:     Timing | null
}

const INTERVAL_MS  = 1500   // query every 1.5 s
// Rolling majority vote over the last N predictions. Each query is slow (a few
// seconds), so a large window made the reported node lag badly — it only
// switched after you had already left a room. Kept small for responsiveness;
// the adjacency gate in App still filters out stray non-neighbour guesses.
const WINDOW_SIZE  = 3
const CAPTURE_H    = 480    // resize before sending to save bandwidth

function captureJpeg(video: HTMLVideoElement): Promise<Blob> {
  const scale  = CAPTURE_H / video.videoHeight
  const w      = Math.round(video.videoWidth * scale)
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = CAPTURE_H
  canvas.getContext('2d')!.drawImage(video, 0, 0, w, CAPTURE_H)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.82),
  )
}

function majority(arr: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const v of arr) {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n }
  }
  return best
}

export function useLocalisation(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  /** Current (adjacency-gated) node. When given, the server restricts matching
   *  to this node and its neighbours for a large speed-up. */
  currentNodeId?: string | null,
): LocalisationState {
  const [state, setState] = useState<LocalisationState>({
    nodeId: null, confidence: 0, status: 'idle', timing: null,
  })
  const nodeRef = useRef<string | null | undefined>(currentNodeId)
  nodeRef.current = currentNodeId
  const historyRef  = useRef<(string | null)[]>([])
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const queryingRef = useRef(false)

  const runQuery = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || queryingRef.current) return

    queryingRef.current = true
    setState(s => ({ ...s, status: 'querying' }))
    try {
      const t0         = performance.now()
      const jpeg       = await captureJpeg(video)
      const captureMs  = Math.round(performance.now() - t0)
      const result     = await queryFrame(jpeg, nodeRef.current)
      const totalMs    = Math.round(performance.now() - t0)

      historyRef.current = [...historyRef.current.slice(-(WINDOW_SIZE - 1)), result.node_id]
      const smoothed = majority(historyRef.current)

      setState({
        nodeId: smoothed,
        confidence: result.confidence,
        status: 'ok',
        timing: { captureMs, inferenceMs: result.inference_ms, totalMs },
      })
    } catch {
      setState(s => ({ ...s, status: 'error' }))
    } finally {
      queryingRef.current = false
    }
  }, [videoRef])

  useEffect(() => {
    let cancelled = false

    checkServerStatus().then(ready => {
      if (cancelled) return
      if (!ready) {
        setState(s => ({ ...s, status: 'unavailable' }))
        return
      }
      timerRef.current = setInterval(runQuery, INTERVAL_MS)
    })

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [runQuery])

  return state
}
