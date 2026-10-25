import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DayContent, SubmitResult } from '../types'
import { formatDate } from '../lib/format'
import SpeechButton from '../components/SpeechButton'
import VoiceInput from '../components/VoiceInput'
import FeedbackCard from '../components/FeedbackCard'

export default function ChinesePage() {
  const { date = '' } = useParams()
  const [day, setDay] = useState<DayContent | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .day(date)
      .then(setDay)
      .catch((err) => setError(err.message))
  }, [date])

  const submit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(answers)) payload[k] = { text: v }
      const r = await api.submit(date, 'chinese', payload)
      setResult(r)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败了')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
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
  if (!day.chinese) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-[var(--color-ink-soft)]">这一天没有语文作业。</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">
          回到首页
        </Link>
      </div>
    )
  }

  const cn = day.chinese

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">语文作业</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
            {formatDate(date, true)} · 《{cn.title}》
            {cn.source ? ` · ${cn.source}` : ''}
          </p>
        </div>
        <Link to="/" className="text-[13px] text-[var(--color-ink-soft)] underline">
          返回今日
        </Link>
      </header>

      {/* 阅读材料 */}
      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">先读一读</h2>
          <SpeechButton text={cn.passage} label="读给我听" />
        </div>
        <p className="whitespace-pre-wrap text-[16px] leading-[2] tracking-wide">{cn.passage}</p>
      </section>

      {/* 三个问题 */}
      <section className="space-y-3">
        <p className="text-[13px] text-[var(--color-ink-soft)]">
          下面的 3 个问题由浅入深，第 3 题要连起来说完整的话。可以打字，也可以点话筒说。
        </p>
        {cn.questions.map((q) => {
          const key = `q${q.no}`
          const r = result?.results.find((x) => x.key === key)
          return (
            <article key={key} className="card p-4">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-chinese-soft)] text-[13px] font-semibold text-[var(--color-chinese)]">
                  {q.no}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-relaxed">{q.prompt}</p>
                  <SpeechButton text={q.prompt} className="mt-1.5" />
                  <div className="mt-3">
                    <VoiceInput
                      value={answers[key] ?? ''}
                      onChange={(v) => setAnswers((p) => ({ ...p, [key]: v }))}
                    />
                  </div>
                  {r && (
                    <div className="mt-3">
                      <FeedbackCard result={r as never} no={q.no} />
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-[var(--color-line)] bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {result ? '可以改完再提交' : '写完就点提交，AI 老师会逐题批改'}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-xl bg-[var(--color-chinese)] px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? '批改中…' : result ? '再提交一次' : '提交批改'}
          </button>
        </div>
      </div>
    </div>
  )
}
