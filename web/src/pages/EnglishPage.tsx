import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DayContent, EnglishChoice, SubmitResult } from '../types'
import { cn, formatDate } from '../lib/format'
import { speak } from '../lib/speech'
import SpeechButton from '../components/SpeechButton'
import Recorder from '../components/Recorder'
import FeedbackCard from '../components/FeedbackCard'

export default function EnglishPage() {
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
      for (const [k, v] of Object.entries(answers)) payload[k] = { value: v }
      const r = await api.submit(date, 'english', payload)
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
  const ex = day.englishExercises

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

      {/* 场景 */}
      <section className="card p-4">
        <p className="text-[13px] text-[var(--color-ink-soft)]">生活场景：{en.scene}</p>
      </section>

      {/* 一、跟读录音 */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">一、听一听，跟着读</h2>
        <p className="text-[13px] text-[var(--color-ink-soft)]">
          先点喇叭听一遍，再按住话筒读一遍，读完听听自己的声音。
        </p>
        <div className="space-y-2">
          {(ex?.shadowing ?? []).map((s, i) => (
            <div key={i} className="card flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{s.en}</p>
                <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{s.zh}</p>
              </div>
              <button
                type="button"
                onClick={() => speak(s.en, { lang: 'en-US', rate: 0.85 })}
                className="rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-[13px] hover:border-[var(--color-english)]"
              >
                🔊 听
              </button>
              <Recorder label="我来读" maxSeconds={30} />
            </div>
          ))}
        </div>
      </section>

      {/* 二、听 → 选 */}
      {ex && ex.listening.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">二、听一听，选一选</h2>
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            点喇叭听句子，听清楚了就选出你听到的那一句。
          </p>
          {ex.listening.map((q, i) => (
            <ChoiceBlock
              key={`listen-${i}`}
              q={q}
              index={i}
              answerKey={`listen-${i}`}
              value={answers[`listen-${i}`] ?? ''}
              onChange={(v) => setAnswers((p) => ({ ...p, [`listen-${i}`]: v }))}
              result={result?.results.find((r) => r.key === `listen-${i}`)}
            />
          ))}
        </section>
      )}

      {/* 三、对话 */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">三、今天的对话</h2>
        <div className="space-y-3">
          {en.dialogues.map((d, di) => (
            <div key={di} className="card p-4">
              <h3 className="mb-2 text-[13px] font-medium text-[var(--color-ink-soft)]">
                对话{di === 0 ? '一' : '二'} · {d.title}
              </h3>
              <ul className="space-y-2">
                {d.lines.map((l, li) => (
                  <li key={li} className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium',
                        l.speaker === 'A'
                          ? 'bg-[var(--color-english-soft)] text-[var(--color-english)]'
                          : 'bg-[var(--color-math-soft)] text-[var(--color-math)]'
                      )}
                    >
                      {l.speaker}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] leading-relaxed">{l.en}</p>
                      <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{l.zh}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => speak(l.en, { lang: 'en-US', rate: 0.85 })}
                      className="shrink-0 rounded-lg border border-[var(--color-line)] px-2 py-1 text-[13px] hover:border-[var(--color-english)]"
                      aria-label="朗读这句"
                    >
                      🔊
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 对话补全 */}
      {ex && ex.dialogue.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">四、这段话用英语怎么说？</h2>
          {ex.dialogue.map((q, i) => (
            <ChoiceBlock
              key={`dialog-${i}`}
              q={q}
              index={i}
              answerKey={`dialog-${i}`}
              value={answers[`dialog-${i}`] ?? ''}
              onChange={(v) => setAnswers((p) => ({ ...p, [`dialog-${i}`]: v }))}
              result={result?.results.find((r) => r.key === `dialog-${i}`)}
            />
          ))}
        </section>
      )}

      {/* 今天要会用的句子 */}
      {en.sentences.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-[15px] font-semibold">今天要会用的句子</h2>
          <ul className="space-y-1.5">
            {en.sentences.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px] leading-relaxed">
                <span className="text-[var(--color-ink-soft)]">·</span>
                <span className="flex-1">{s}</span>
                <SpeechButton text={s} label="听" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 小任务 */}
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-[15px] font-semibold">今天的小任务</h2>
          <p className="mt-1 text-[14px] leading-relaxed">{en.task}</p>
        </div>
        {en.tip && (
          <div>
            <h3 className="text-[13px] font-medium text-[var(--color-ink-soft)]">小提示</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
              {en.tip}
            </p>
          </div>
        )}
        {en.parentTip && (
          <details className="rounded-lg bg-[var(--color-paper)] p-3">
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--color-ink-soft)]">
              给家长的提醒
            </summary>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
              {en.parentTip}
            </p>
          </details>
        )}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-[var(--color-line)] bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {result ? '可以改完再提交' : '选好了就点提交'}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-xl bg-[var(--color-english)] px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? '批改中…' : result ? '再提交一次' : '提交批改'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ChoiceProps {
  q: EnglishChoice
  index: number
  answerKey: string
  value: string
  onChange: (v: string) => void
  result?: { status: string; message: string }
}

function ChoiceBlock({ q, index, value, onChange, result }: ChoiceProps) {
  const isZh = q.type === 'zh_choose_en'
  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-english-soft)] text-[13px] font-semibold text-[var(--color-english)]">
          {index + 1}
        </span>
        <p className="text-[15px]">{q.prompt}</p>
      </div>

      <div className="mt-2 rounded-lg bg-[var(--color-paper)] px-3 py-2">
        {isZh ? (
          <p className="text-[15px]">{q.audio}</p>
        ) : (
          <button
            type="button"
            onClick={() => speak(q.audio, { lang: 'en-US', rate: 0.85 })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-[13px] hover:border-[var(--color-english)]"
          >
            🔊 再听一遍
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.options.map((opt) => {
          const picked = value === opt
          const reveal = result?.status === 'wrong' && q.answer === opt
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-[14px] transition-colors',
                picked
                  ? 'border-[var(--color-english)] bg-[var(--color-english-soft)]'
                  : 'border-[var(--color-line)] bg-white hover:border-[var(--color-english)]',
                reveal && 'border-emerald-400 bg-emerald-50'
              )}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {result && (
        <div className="mt-3">
          <FeedbackCard result={result as never} />
        </div>
      )}
    </article>
  )
}
