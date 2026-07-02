import { useCallback, useEffect, useRef, useState } from 'react'

export interface VideoFileState {
  videoRef:    React.RefObject<HTMLVideoElement>
  hasFile:     boolean
  loading:     boolean
  error:       string | null
  isPlaying:   boolean
  currentTime: number
  duration:    number
  speed:       number
  loadUrl:     (url: string) => void
  /** Opens the OS file picker. `onPicked` (if given) receives the chosen File
   *  before the video source swaps in — lets the caller recognise the file
   *  by name (e.g. one of the hardcoded thesis-demo clips). */
  openFile:    (onPicked?: (file: File) => void) => void
  togglePlay:  () => void
  seek:        (t: number) => void
  setSpeed:    (s: number) => void
}

export function useVideoFile(): VideoFileState {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const objectUrl = useRef<string | null>(null)

  const [hasFile,     setHasFile]     = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [speed,       setSpeedState]  = useState(1)

  // Wire up video element events. The element is always mounted by the view, so
  // the ref is available on mount — this is what lets loadUrl() actually work.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime    = () => setCurrentTime(video.currentTime)
    const onMeta    = () => setDuration(video.duration)
    const onPlay    = () => setIsPlaying(true)
    const onPause   = () => setIsPlaying(false)
    const onEnded   = () => setIsPlaying(false)
    const onCanPlay = () => {
      setLoading(false)
      setError(null)
      // muted autoplay is permitted — start the clip as soon as it's ready
      video.play().catch(() => {})
    }
    const onError   = () => {
      setLoading(false)
      setError('Could not load video.')
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('error', onError)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('error', onError)
    }
  }, [])

  // Revoke object URL on unmount
  useEffect(() => {
    return () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }
  }, [])

  // Point the (always-mounted) video element at a source and reset playback
  // state. `isObjectUrl` tracks blob URLs so they can be revoked later.
  const setSource = useCallback((src: string, isObjectUrl: boolean) => {
    const video = videoRef.current
    if (!video) return
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
    if (isObjectUrl) objectUrl.current = src

    setHasFile(true)
    setLoading(true)
    setError(null)
    setIsPlaying(false)
    setCurrentTime(0)
    video.src = src
    video.load()
  }, [])

  const loadUrl = useCallback((url: string) => {
    setSource(url, false)
  }, [setSource])

  const openFile = useCallback((onPicked?: (file: File) => void) => {
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = 'video/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0]
      document.body.removeChild(input)
      if (!file) return
      // Let the caller inspect the picked file (e.g. to recognise one of the
      // hardcoded thesis-demo clips by name) before the source swaps in.
      onPicked?.(file)
      setSource(URL.createObjectURL(file), true)
    }
    input.click()
  }, [setSource])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { video.play() } else { video.pause() }
  }, [])

  const seek = useCallback((t: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = t
    setCurrentTime(t)
  }, [])

  const setSpeed = useCallback((s: number) => {
    const video = videoRef.current
    if (video) video.playbackRate = s
    setSpeedState(s)
  }, [])

  return { videoRef, hasFile, loading, error, isPlaying, currentTime, duration, speed, loadUrl, openFile, togglePlay, seek, setSpeed }
}
