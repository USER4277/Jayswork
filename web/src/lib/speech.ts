/**
 * 语音能力封装（全部用浏览器原生能力，零成本、离线可用）。
 *
 * 朗读：SpeechSynthesis —— 中文讲解用 zh-CN，英文句子用 en-US（macOS 自带音色）
 * 语音输入：SpeechRecognition —— Chrome / Edge 支持，Safari 不支持时前端会降级成打字
 */

type SpeakHandler = (speaking: boolean) => void

const listeners = new Set<SpeakHandler>()
let speaking = false

function notify(next: boolean) {
  speaking = next
  listeners.forEach((fn) => fn(next))
}

export function onSpeakingChange(fn: SpeakHandler) {
  listeners.add(fn)
  fn(speaking)
  return () => {
    listeners.delete(fn)
  }
}

export const isSpeaking = () => speaking

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function recognitionSupported() {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )
}

/** 挑一个最合适的嗓音：优先精确匹配语言，其次同语言前缀 */
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const exact = voices.find((v) => v.lang.replace('_', '-') === lang)
  if (exact) return exact
  const prefix = lang.split('-')[0]
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) || null
}

export interface SpeakOptions {
  lang?: string
  rate?: number
  pitch?: number
  onEnd?: () => void
}

/** 朗读一段文字。会打断正在进行的朗读。 */
export function speak(text: string, options: SpeakOptions = {}) {
  if (!speechSupported() || !text) return
  const { lang = 'zh-CN', rate = 0.95, pitch = 1, onEnd } = options

  window.speechSynthesis.cancel()

  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = lang
  utter.rate = rate
  utter.pitch = pitch
  const voice = pickVoice(lang)
  if (voice) utter.voice = voice

  utter.onstart = () => notify(true)
  utter.onend = () => {
    notify(false)
    onEnd?.()
  }
  utter.onerror = () => {
    notify(false)
    onEnd?.()
  }

  window.speechSynthesis.speak(utter)
}

export function stopSpeaking() {
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  notify(false)
}

/**
 * 有些浏览器要等 voices 加载完才有声音，先预热一下。
 */
export function warmUpVoices() {
  if (!speechSupported()) return
  window.speechSynthesis.getVoices()
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices()
  }
}

// --------------------------------------------------------------------------
// 语音识别
// --------------------------------------------------------------------------

export interface ListenOptions {
  lang?: string
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (message: string) => void
  onEnd?: () => void
}

type RecognitionCtor = new () => any

let activeRecognition: any = null

/**
 * 开始一次语音输入。同一时刻只允许一个识别在跑。
 */
export function listen(options: ListenOptions = {}) {
  if (!recognitionSupported()) {
    options.onError?.('这个浏览器不支持语音输入，可以用打字代替')
    options.onEnd?.()
    return
  }
  stopListening()

  const Ctor: RecognitionCtor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const rec = new Ctor()
  rec.lang = options.lang || 'zh-CN'
  rec.continuous = false
  rec.interimResults = true
  rec.maxAlternatives = 1

  let finalText = ''

  rec.onresult = (event: any) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const text = result[0]?.transcript || ''
      if (result.isFinal) finalText += text
      else interim += text
    }
    if (interim) options.onPartial?.(finalText + interim)
  }

  rec.onerror = (event: any) => {
    const map: Record<string, string> = {
      'not-allowed': '没有拿到麦克风权限，请在浏览器里允许一下',
      'no-speech': '没有听清，再说一次试试',
      'audio-capture': '找不到麦克风',
      network: '语音识别连不上网络，改用打字吧',
    }
    options.onError?.(map[event.error] || `语音输入出错了：${event.error}`)
  }

  rec.onend = () => {
    activeRecognition = null
    if (finalText.trim()) options.onFinal?.(finalText.trim())
    options.onEnd?.()
  }

  try {
    rec.start()
    activeRecognition = rec
  } catch (err) {
    activeRecognition = null
    options.onError?.('语音输入没能启动，用打字吧')
    options.onEnd?.()
  }
}

export function stopListening() {
  if (activeRecognition) {
    try {
      activeRecognition.stop()
    } catch {
      /* 已经停了 */
    }
    activeRecognition = null
  }
}
