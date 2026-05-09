import { useCallback, useEffect, useRef, useState } from 'react'

export interface VideoFileState {
  videoRef:    React.RefObject<HTMLVideoElement | null>
  hasFile:     boolean
  isPlaying:   boolean
  currentTime: number
  duration:    number
  speed:       number
  openFile:    () => void
  togglePlay:  () => void
  seek:        (t: number) => void
  setSpeed:    (s: number) => void
}

export function useVideoFile(): VideoFileState {
  const videoRef    = useRef<HTMLVideoElement | null>(null)
  const objectUrl   = useRef<string | null>(null)

  const [hasFile,     setHasFile]     = useState(false)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [speed,       setSpeedState]  = useState(1)

  // Keep video time in sync for the scrubber
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime  = () => setCurrentTime(video.currentTime)
    const onMeta  = () => setDuration(video.duration)
    const onPlay  = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    }
  }, [])

  // Revoke previous object URL when unmounting
  useEffect(() => {
    return () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }
  }, [])

  const openFile = useCallback(() => {
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = 'video/*'
    input.onchange = () => {
      const file  = input.files?.[0]
      const video = videoRef.current
      if (!file || !video) return
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(file)
      video.src         = objectUrl.current
      video.load()
      setHasFile(true)
      setIsPlaying(false)
      setCurrentTime(0)
    }
    input.click()
  }, [])

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

  return { videoRef, hasFile, isPlaying, currentTime, duration, speed, openFile, togglePlay, seek, setSpeed }
}
