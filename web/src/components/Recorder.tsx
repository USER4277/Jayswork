import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/format'

interface Props {
  label?: string
  onRecorded?: (blob: Blob) => void
  /** 录音时长上限（秒） */
  maxSeconds?: number
}

/** 跟读录音：录下来可以自己回放，对比读得像不像 */
export default function Recorder({ label = '录音', onRecorded, maxSeconds = 60 }: Props) {
  const [recording, setRecording] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  const start = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      )
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (url) URL.revokeObjectURL(url)
        setUrl(URL.createObjectURL(blob))
        onRecorded?.(blob)
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
      setSeconds(0)
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= maxSeconds) {
            stop()
            return 0
          }
          return s + 1
        })
      }, 1000)
    } catch {
      setError('没有拿到麦克风权限，可以在浏览器里允许一下')
    }
  }

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = undefined
    try {
      recorderRef.current?.stop()
    } catch {
      /* 已经停了 */
    }
    recorderRef.current = null
    setRecording(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
          recording
            ? 'border-red-300 bg-red-50 text-red-600'
            : 'border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:border-[var(--color-english)]'
        )}
      >
        <span aria-hidden>{recording ? '⏹' : '🎙'}</span>
        {recording ? `停止 (${seconds}s)` : label}
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
