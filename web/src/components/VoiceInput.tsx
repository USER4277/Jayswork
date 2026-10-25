import { useEffect, useRef, useState } from 'react'
import { listen, recognitionSupported, stopListening } from '../lib/speech'
import { cn } from '../lib/format'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  lang?: string
  rows?: number
  label?: string
}

/** 文字 + 语音双通道输入框 */
export default function VoiceInput({
  value,
  onChange,
  placeholder = '可以打字，也可以点话筒说给老师听…',
  lang = 'zh-CN',
  rows = 4,
  label = '说给老师听',
}: Props) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const supported = recognitionSupported()
  const baseRef = useRef(value)

  useEffect(() => () => stopListening(), [])

  const toggle = () => {
    setError('')
    if (recording) {
      stopListening()
      setRecording(false)
      return
    }
    baseRef.current = value
    listen({
      lang,
      onPartial: (text) => onChange(text),
      onFinal: (text) => onChange(text),
      onError: (msg) => {
        setError(msg)
        setRecording(false)
      },
      onEnd: () => setRecording(false),
    })
    setRecording(true)
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <textarea
          className="field resize-y leading-relaxed"
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {supported && (
          <button
            type="button"
            onClick={toggle}
            aria-label={recording ? '停止录音' : label}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg transition-colors',
              recording
                ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:border-[var(--color-chinese)]'
            )}
          >
            {recording ? '⏹' : '🎤'}
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        {recording && <span className="text-red-600">正在听… 请说话</span>}
        {!supported && (
          <span className="text-[var(--color-ink-soft)]">
            这个浏览器不支持语音输入，用打字也一样棒
          </span>
        )}
        {error && <span className="text-amber-600">{error}</span>}
      </div>
    </div>
  )
}
