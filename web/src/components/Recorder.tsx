import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/format'
import { stopSpeaking } from '../lib/speech'
import { Mic, Square } from 'lucide-react'

interface Props {
  label?: string
  onRecorded?: (blob: Blob) => void
  /** 录音时长上限（秒） */
  maxSeconds?: number
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  onStart?: () => void
}

/** 跟读录音：录下来可以自己回放，对比读得像不像 */
export default function Recorder({ label = '录音', onRecorded, maxSeconds = 60, disabled = false, onBusyChange, onStart }: Props) {
  const [recording, setRecording] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const readyTimerRef = useRef<number | undefined>(undefined)
  const stopTimerRef = useRef<number | undefined>(undefined)
  const mountedRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const urlRef = useRef<string | null>(null)
  const secondsRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) window.clearInterval(timerRef.current)
      window.clearTimeout(readyTimerRef.current)
      window.clearTimeout(stopTimerRef.current)
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstart = null
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const start = async () => {
    if (starting || recording || stopping || recorderRef.current || disabled) return
    setError('')
    setStarting(true)
    onBusyChange?.(true)
    stopSpeaking()
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('请使用支持录音的浏览器并从 localhost 打开')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      )
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      rec.onstop = () => {
        window.clearTimeout(readyTimerRef.current)
        window.clearTimeout(stopTimerRef.current)
        window.clearInterval(timerRef.current)
        recorderRef.current = null
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setStarting(false)
        setRecording(false)
        setStopping(false)
        onBusyChange?.(false)
        if (!blob.size) { setError('没有录到声音，请重新录音'); return }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = URL.createObjectURL(blob)
        setUrl(urlRef.current)
        onRecorded?.(blob)
      }
      rec.onerror = () => { setError('录音失败，请重试'); stop() }
      recorderRef.current = rec
      rec.onstart = () => {
        readyTimerRef.current = window.setTimeout(() => {
          setStarting(false)
          setRecording(true)
          onStart?.()
          setSeconds(0)
          secondsRef.current = 0
          timerRef.current = window.setInterval(() => {
            secondsRef.current++
            setSeconds(secondsRef.current)
            if (secondsRef.current >= maxSeconds) stop()
          }, 1000)
        }, 400)
      }
      rec.start(250)
    } catch (failure) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      setStarting(false)
      setError(failure instanceof Error && failure.name !== 'NotAllowedError' ? failure.message : '没有拿到麦克风权限，可以在浏览器里允许一下')
      onBusyChange?.(false)
    }
  }

  const stop = () => {
    if (stopTimerRef.current !== undefined || !recorderRef.current || recorderRef.current.state === 'inactive') return
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = undefined
    setStopping(true)
    stopTimerRef.current = window.setTimeout(() => {
      stopTimerRef.current = undefined
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }, 500)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={starting || stopping || (disabled && !recording)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
          recording
            ? 'border-red-300 bg-red-50 text-red-600'
            : 'border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:border-[var(--color-english)]'
        )}
      >
        {recording ? <Square className="h-5 w-5" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
        {starting ? '准备中…' : stopping ? '收尾中…' : recording ? `停止 (${seconds}s)` : label}
      </button>

      {url && !recording && (
        <>
          <audio controls src={url} className="h-9 max-w-[16rem]" />
          <span className="text-[12px] text-[var(--color-ink-soft)]">听听自己读得像不像</span>
        </>
      )}

      {error && <span className="text-[12px] text-amber-600">{error}</span>}
    </div>
  )
}
