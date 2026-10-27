import { useEffect, useRef, useState } from 'react'
import { listen, recognitionSupported, stopListening, stopSpeaking } from '../lib/speech'
import { cn } from '../lib/format'
import { Mic, Square } from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  lang?: string
  rows?: number
  label?: string
  disabled?: boolean
  onRecorded?: (audio: Blob, transcript: string) => Promise<void>
  onBusyChange?: (busy: boolean) => void
}

/** 文字 + 语音双通道输入框 */
export default function VoiceInput({
  value,
  onChange,
  placeholder = '可以打字，也可以点话筒说给老师听…',
  lang = 'zh-CN',
  rows = 4,
  label = '说给老师听',
  disabled = false,
  onRecorded,
  onBusyChange,
}: Props) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const supported = recognitionSupported()
  const baseRef = useRef(value)
  const textRef = useRef(value)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<{ audio: Blob; transcript: string } | null>(null)
  const [preview, setPreview] = useState('')
  const previewRef = useRef('')

  useEffect(() => { textRef.current = value }, [value])
  useEffect(() => () => {
    stopListening()
    window.clearTimeout(timerRef.current)
    const recorder = recorderRef.current
    if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop() }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  const save = async (audio: Blob, transcript: string) => {
    let saved = false
    setSaving(true)
    setPending({ audio, transcript })
    try {
      await onRecorded?.(audio, transcript)
      setPending(null)
      setError('')
      saved = true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '录音保存失败，请重试')
    } finally { setSaving(false); onBusyChange?.(!saved) }
  }

  const stopRecording = () => {
    window.clearTimeout(timerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const toggle = async () => {
    setError('')
    if (recording) {
      if (supported) stopListening()
      else stopRecording()
      return
    }
    if (disabled || starting || saving) return
    setStarting(true)
    onBusyChange?.(true)
    baseRef.current = value
    textRef.current = value
    stopSpeaking()
    const updateText = (text: string) => {
      textRef.current = [baseRef.current, text].filter(Boolean).join(' ')
      onChange(textRef.current)
    }
    try {
      if (!onRecorded) {
        if (!supported) throw new Error('当前浏览器不支持语音转文字，请使用 Chrome 或 Edge。')
        setRecording(true)
        timerRef.current = window.setTimeout(stopListening, 90000)
        listen({
          lang,
          onPartial: updateText,
          onFinal: updateText,
          onError: setError,
          onEnd: () => { window.clearTimeout(timerRef.current); setRecording(false); onBusyChange?.(false) },
        })
        return
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('请使用支持录音的浏览器，并从 localhost 打开')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        setRecording(false)
        const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = URL.createObjectURL(audio)
        setPreview(previewRef.current)
        void save(audio, textRef.current)
      }
      recorder.onerror = () => { setError('录音中断，请检查麦克风'); stopListening(); stopRecording() }
      recorder.start()
      setRecording(true)
      timerRef.current = window.setTimeout(() => { stopListening(); stopRecording() }, 90000)
      if (supported) listen({ lang, onPartial: updateText, onFinal: updateText, onError: setError, onEnd: stopRecording })
    } catch (failure) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setError(failure instanceof Error ? failure.message : '麦克风无法打开')
      onBusyChange?.(false)
    } finally { setStarting(false) }
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <textarea
          className="field resize-y leading-relaxed"
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          disabled={disabled || recording || starting || saving || Boolean(pending)}
          onChange={(e) => onChange(e.target.value)}
        />
        {(supported || onRecorded) && (
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={disabled || starting || saving || Boolean(pending)}
            aria-label={recording ? '停止录音' : label}
            title={recording ? '停止录音' : label}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg transition-colors',
              recording
                ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:border-[var(--color-chinese)]'
            )}
          >
            {recording ? <Square className="h-5 w-5" aria-hidden="true" /> : <Mic className="h-6 w-6" aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        {recording && <span className="text-red-600">正在听… 请说话</span>}
        {starting && <span>正在打开麦克风…</span>}
        {saving && <span>正在保存录音…</span>}
        {!supported && (
          <span className="text-[var(--color-ink-soft)]">
            {onRecorded ? '语音识别不可用，录音后请补充文字。' : '当前浏览器不支持语音转文字，请使用 Chrome 或 Edge，也可以打字。'}
          </span>
        )}
        {error && <span className="text-amber-600">{error}</span>}
      </div>
      {pending && !saving && <div className="mt-2 space-y-2"><audio controls src={preview} className="h-10 w-full" /><button type="button" className="text-sm underline" onClick={() => { onBusyChange?.(true); void save(pending.audio, pending.transcript) }}>重新保存录音</button></div>}
    </div>
  )
}
