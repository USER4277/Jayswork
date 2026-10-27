import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, type EnglishReading } from '../lib/api'
import { cn, formatDate } from '../lib/format'
import { speak, stopSpeaking, speechSupported } from '../lib/speech'
import { Check, Volume2 } from 'lucide-react'
import SubjectFlow from '../components/SubjectFlow'
import Recorder from '../components/Recorder'
import type { DayContent } from '../types'

const emptyReading: EnglishReading = { recording: null, result: null }
const readingPassed = (reading?: EnglishReading) => reading?.result?.passed === true && reading.result.score >= 7

export default function EnglishPage() {
  const { date = '' } = useParams()
  const [day, setDay] = useState<DayContent | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [completedDate, setCompletedDate] = useState('')
  const [spoken, setSpoken] = useState<{ date: string; en: string; zh: string } | null>(null)
  const [readings, setReadings] = useState<Record<string, EnglishReading>>({})
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [assessingKey, setAssessingKey] = useState<string | null>(null)
  const [loadedReadings, setLoadedReadings] = useState(false)
  const [newReading, setNewReading] = useState(false)

  useEffect(() => () => stopSpeaking(), [date])
  useEffect(() => {
    let active = true
    setDay(null)
    setError('')
    setReadings({})
    setLoadedReadings(false)
    setNewReading(false)
    api.day(date, 'english').then(async (content) => {
      if (!active) return
      setDay(content)
      const lines = content.english?.dialogues[0]?.lines || []
      if (!lines.length) return
      const entries = await Promise.all([undefined, ...lines.map((_, index) => index)].map(async (line) => [line === undefined ? 'dialogue' : String(line), await api.englishReading(date, line)] as const))
      if (active) { setReadings(Object.fromEntries(entries)); setLoadedReadings(true) }
    }).catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [date])

  const assess = async (line?: number, audio?: Blob) => {
    const key = line === undefined ? 'dialogue' : String(line)
    setAssessingKey(key)
    setError('')
    try {
      const value = audio ? await api.gradeEnglishReading(date, audio, line) : await api.retryEnglishReading(date, readings[key].recording!.id, line)
      setReadings((previous) => ({ ...previous, [key]: value }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '评分失败，请重试')
      try {
        const value = await api.englishReading(date, line)
        setReadings((previous) => ({ ...previous, [key]: value }))
      } catch { /* 保留本地录音回放 */ }
    } finally { setAssessingKey(null) }
  }

  const pronounce = (en: string, zh: string) => {
    if (recordingKey !== null || assessingKey !== null) return
    setSpoken({ date, en, zh })
    setError('')
    if (!speechSupported()) {
      setError('当前浏览器不支持发音，请使用 Chrome、Edge 或 Safari。')
      return
    }
    speak(en, { lang: 'en-US', rate: 0.85 })
  }

  const submit = async () => {
    setSubmitting(true)
    setError('')
    try {
      await api.englishComplete(date)
      setCompletedDate(date)
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败了')
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !day) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-amber-700">{error}</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">
          回到首页
        </Link>
      </div>
    )
  }
  if (!day) {
    return <p className="py-16 text-center text-sm text-[var(--color-ink-soft)]">加载中…</p>
  }
  if (!day.english) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-[var(--color-ink-soft)]">这一天没有英语作业。</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">
          回到首页
        </Link>
      </div>
    )
  }

  const en = day.english
  const dialogue = en.dialogues[0]
  const sentencesReady = Boolean(dialogue?.lines.length && dialogue.lines.every((_, index) => readingPassed(readings[String(index)])))
  const passed = sentencesReady && readingPassed(readings.dialogue)
  const busy = recordingKey !== null || assessingKey !== null
  const completed = passed && (completedDate === date || (!newReading && day.progress.some((progress) => progress.subject === 'english' && progress.status === 'submitted')))
  const renderReading = (line?: number) => {
    const key = line === undefined ? 'dialogue' : String(line)
    const reading = readings[key] || emptyReading
    const label = line === undefined ? '整段' : `第${line + 1}句`
    const eligible = line !== undefined || sentencesReady
    return <div className="mt-3 space-y-2" data-reading={key}>
      {!eligible && <p className="text-sm text-[var(--color-ink-soft)]">每句达到 7 分后，开放整段录音。</p>}
      <Recorder key={`${date}-${key}`} label={reading.result && !readingPassed(reading) ? `${label}重新跟读` : `${label}跟读录音`} maxSeconds={line === undefined ? 90 : 30} disabled={!loadedReadings || !eligible || busy || completed || submitting} onBusyChange={(value) => setRecordingKey(value ? key : null)} onStart={() => { setNewReading(true); setCompletedDate(''); setReadings((previous) => ({ ...previous, [key]: emptyReading })); setError('') }} onRecorded={(audio) => { void assess(line, audio) }} />
      {assessingKey === key && <p role="status">正在识别{label}录音并评分…</p>}
      {reading.recording && recordingKey !== key && <audio aria-label={`${label}已保存的跟读录音`} controls src={reading.recording.url} className="h-11 w-full max-w-md" />}
      {reading.result && <div className="space-y-2 border-l-4 border-[var(--color-english)] pl-3" aria-live="polite">
        <p className="font-semibold">{label}得分：{reading.result.score} / 10 · {readingPassed(reading) ? '通过' : '请重新跟读'}</p>
        <p className="whitespace-pre-line text-sm leading-relaxed">{reading.result.explanation}</p>
        {reading.result.hint && <p className="text-sm">{reading.result.hint}</p>}
        <details><summary className="text-sm">{label}识别文字</summary><p className="mt-2 whitespace-pre-line break-words text-sm">{reading.result.transcript}</p></details>
      </div>}
      {reading.recording && !reading.result && !busy && <button type="button" className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm" disabled={!eligible} onClick={() => void assess(line)}>{label}重新识别并评分</button>}
    </div>
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">英语作业</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
            {formatDate(date, true)} · 今日主题「{en.theme}」
          </p>
        </div>
        <Link to="/" className="text-[13px] text-[var(--color-ink-soft)] underline">
          返回今日
        </Link>
      </header>

      <section>
        <p className="text-[13px] text-[var(--color-ink-soft)]">生活场景：{en.scene}</p>
      </section>

      {dialogue && <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{dialogue.title}</h2>
          <button type="button" disabled={busy} onClick={() => pronounce(dialogue.lines.map((line) => line.en).join('\n'), dialogue.lines.map((line) => line.zh).join('\n'))} className="inline-flex items-center gap-2 rounded-lg border-2 border-[var(--color-english)] bg-white px-3 py-2 text-sm">
            <Volume2 className="h-5 w-5" aria-hidden="true" /> 整段发音
          </button>
        </div>
            <div className="card p-4">
              <ul className="space-y-2">
                {dialogue.lines.map((line, index) => (
                  <li key={index} className={cn('rounded-lg border-b border-[var(--color-line)] px-3 py-4 last:border-b-0', readings[String(index)]?.result ? (readingPassed(readings[String(index)]) ? 'bg-emerald-50' : 'bg-red-50') : spoken?.date === date && spoken.en === line.en && 'bg-[var(--color-english-soft)]')}>
                    <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium',
                        line.speaker === 'A'
                          ? 'bg-[var(--color-english-soft)] text-[var(--color-english)]'
                          : 'bg-[var(--color-math-soft)] text-[var(--color-math)]'
                      )}
                    >
                      {line.speaker}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[15px] leading-relaxed">{line.en}</p>
                      <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{line.zh}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => pronounce(line.en, line.zh)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-[13px] hover:border-[var(--color-english)]"
                      aria-label={`第${index + 1}句发音`}
                      disabled={busy}
                    >
                      <Volume2 className="h-4 w-4" aria-hidden="true" /> 发音
                    </button>
                    </div>
                    {renderReading(index)}
                  </li>
                ))}
              </ul>
            </div>
      </section>}

      {spoken?.date === date && <section className="border-l-4 border-[var(--color-english)] pl-4" aria-live="polite">
        <h2 className="mb-2 text-sm font-medium">发音文字</h2>
        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">{spoken.en}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-ink-soft)]">{spoken.zh}</p>
      </section>}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {dialogue && <section className="space-y-3 border-t border-[var(--color-line)] pt-5">
        <h2 className="text-lg font-semibold">整段跟读评分</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">每句和整段分别评分，满分 10 分，7 分通过。录音发送至 MiniMax 识别；评分不含音准和语调。</p>
        <div className="space-y-2 border-l-4 border-[var(--color-english)] pl-4" lang="en">
          {dialogue.lines.map((line, index) => <p key={index} className="break-words text-[15px] leading-relaxed"><span className="font-semibold">{line.speaker}: </span>{line.en}</p>)}
        </div>
        {renderReading()}
      </section>}
      {completed && <div className="space-y-2"><p className="flex items-center gap-2 text-sm"><Check className="h-5 w-5 text-[var(--color-coding)]" aria-hidden="true" />今日对话已完成</p><SubjectFlow day={day} date={date} subject="english" /></div>}

      <div className="sticky bottom-0 -mx-4 border-t border-[var(--color-line)] bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {completed ? '完成记录已保存' : passed ? '跟读已达标' : '跟读达到 7 分后完成'}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || completed || !dialogue || !passed || busy}
            className="shrink-0 whitespace-nowrap rounded-xl bg-[var(--color-english)] px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? '保存中…' : completed ? '已完成' : '完成今日对话'}
          </button>
        </div>
      </div>
    </div>
  )
}
