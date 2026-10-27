import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { VoiceAnswer } from '../lib/api'
import { formatDate } from '../lib/format'
import SpeechButton from '../components/SpeechButton'
import VoiceInput from '../components/VoiceInput'
import FeedbackCard from '../components/FeedbackCard'
import SubjectFlow from '../components/SubjectFlow'
import { useHomework } from '../lib/homework'

export default function ChinesePage() {
  const { date = '' } = useParams()
  const { day, answers, setAnswers, result, setResult, error, setError, correctingKey, submitCorrection } = useHomework<string>(date, 'chinese')
  const [submitting, setSubmitting] = useState(false)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [voiceAnswers, setVoiceAnswers] = useState<VoiceAnswer[]>([])
  const [busyVoice, setBusyVoice] = useState<string | null>(null)
  const [audioErrors, setAudioErrors] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setOpened({})
    setVoiceAnswers([])
    if (!day?.chinese) return
    let cancelled = false
    api.voiceAnswers(date).then(({ items }) => {
      if (cancelled) return
      setVoiceAnswers(items)
      setAnswers((previous) => {
        const next = { ...previous }
        for (const item of [...items].reverse()) if (!next[item.questionKey]) next[item.questionKey] = item.transcript
        return next
      })
    }).catch((failure: Error) => { if (!cancelled) setError(failure.message) })
    return () => { cancelled = true }
  }, [date, day, setAnswers, setError])

  const submit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(answers)) payload[k] = { text: v }
      const r = await api.submit(date, 'chinese', payload)
      setResult(r)
      setOpened({})
      window.scrollTo({ top: 0, behavior: 'smooth' })
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
          这些都是开放作答题，可以打字，也可以说出自己的理解。解答提供参考思路，不是唯一标准答案。
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
                      disabled={submitting || Boolean(correctingKey) || Boolean(busyVoice && busyVoice !== key)}
                      onBusyChange={(busy) => setBusyVoice((current) => busy ? key : current === key ? null : current)}
                      onRecorded={async (audio, transcript) => {
                        const saved = await api.saveVoice(date, key, audio, transcript)
                        setVoiceAnswers((previous) => [...previous, saved])
                        setAnswers((previous) => ({ ...previous, [key]: transcript }))
                      }}
                    />
                  </div>
                  {voiceAnswers.filter((item) => item.questionKey === key).map((item, index) => <div key={item.id} className="mt-3 border-t border-[var(--color-line)] pt-2"><p className="text-[12px] text-[var(--color-ink-soft)]">录音 {index + 1} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p><audio controls preload="metadata" src={item.url} onError={() => setAudioErrors((previous) => ({ ...previous, [item.id]: true }))} className="mt-1 h-10 w-full" /><a className="mt-1 inline-block text-[13px] underline" href={item.url} download={`语文-${date}-${key}-${item.id}.${item.mimeType === 'audio/mp4' ? 'm4a' : item.mimeType.split('/')[1]}`}>下载录音</a>{audioErrors[item.id] && <p className="mt-1 text-[12px] text-amber-700">当前浏览器无法播放此录音，可下载后播放，或使用 Chrome、Edge 打开。</p>}<p className="mt-1 whitespace-pre-wrap text-[13px]">{item.transcript || '未识别出文字，可在作答区补充。'}</p></div>)}
                  {r && (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap gap-3"><button type="button" aria-expanded={Boolean(opened[key])} className="text-sm underline" onClick={() => setOpened((previous) => ({ ...previous, [key]: !previous[key] }))}>解答</button>{r.status !== 'correct' && <button type="button" disabled={submitting || Boolean(correctingKey) || Boolean(busyVoice)} className="text-sm underline disabled:opacity-50" onClick={() => void submitCorrection(key)}>{correctingKey === key ? '提交中…' : r.status === 'pending' ? '提交本题' : '提交订正'}</button>}</div>
                      {opened[key] && <FeedbackCard result={{ ...r, referenceAnswer: r.referenceAnswer || q.reference, explanation: r.explanation || q.explanation }} no={q.no} openEnded />}
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && <div className="space-y-2"><p className="text-sm">本次作答已保存。{result.pending ? 'AI 暂不可用，可以查看本地参考思路。' : '可查看每题的阅读建议。'}</p><SubjectFlow day={day} date={date} subject="chinese" /></div>}

      <div className="sticky bottom-0 -mx-4 border-t border-[var(--color-line)] bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {busyVoice ? '请等录音保存完成' : result ? '可逐题修改并单独提交' : '写完后提交作答'}
          </p>
          {!result && <button
            type="button"
            onClick={submit}
            disabled={submitting || Boolean(busyVoice)}
            className="rounded-xl bg-[var(--color-chinese)] px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? '批改中…' : result ? '再提交一次' : '提交批改'}
          </button>}
        </div>
      </div>
    </div>
  )
}
