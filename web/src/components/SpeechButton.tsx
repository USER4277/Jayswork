import { useEffect, useState } from 'react'
import { onSpeakingChange, speak, stopSpeaking, speechSupported, speakingText } from '../lib/speech'
import { cn } from '../lib/format'
import { Square, Volume2 } from 'lucide-react'

interface Props {
  text: string
  lang?: string
  rate?: number
  label?: string
  className?: string
  /** 大一些，适合点一下就朗读长段落 */
  large?: boolean
}

/** 朗读按钮：点一下读，再点一下停 */
export default function SpeechButton({
  text,
  lang = 'zh-CN',
  rate = 0.95,
  label = '朗读',
  className,
  large,
}: Props) {
  const [active, setActive] = useState(false)
  const supported = speechSupported()

  useEffect(() => onSpeakingChange((speaking) => setActive(speaking && speakingText() === text)), [text])

  if (!supported || !text) return null

  return (
    <button
      type="button"
      onClick={() => (active ? stopSpeaking() : speak(text, { lang, rate }))}
      aria-label={active ? '停止朗读' : label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border transition-colors',
        large ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
        active
          ? 'border-[var(--color-math)] bg-[var(--color-math)] text-white'
          : 'border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:border-[var(--color-math)] hover:text-[var(--color-math)]',
        active && 'speaking',
        className
      )}
    >
      {active ? <Square className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
      <span>{active ? '停止' : label}</span>
    </button>
  )
}
