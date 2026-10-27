import { Fragment, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { AnswerPart, MathQuestion, GradeResult, SubmitResult } from '../types'
import { cn, formatDate } from '../lib/format'
import SudokuGrid from '../components/SudokuGrid'
import AsciiFigure from '../components/AsciiFigure'
import FeedbackCard from '../components/FeedbackCard'
import SubjectFlow from '../components/SubjectFlow'
import { useHomework } from '../lib/homework'
import { speak } from '../lib/speech'
import VoiceInput from '../components/VoiceInput'

interface AnswerState {
  parts: { label: string; value: unknown }[]
  text: string
}

const GROUP_HINTS: Record<string, string> = {
  arith: '先算括号里的，再算乘除，最后算加减',
  addsub: '注意进位和退位',
  remainder: '不够分的那部分要单独写出来',
  word: '把每一步都写出来，过程比结果更重要',
  extend: '慢慢想，想不出来可以先跳过',
}

export default function MathPage() {
  const { date = '' } = useParams()
  const { day, answers, setAnswers, result, setResult, error, setError, correctingKey, submitCorrection } = useHomework<AnswerState>(date, 'math')
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [voiceKey, setVoiceKey] = useState<string | null>(null)

  const math = day?.math

  const groups = useMemo(() => math?.groups ?? [], [math])

  const setPart = (key: string, label: string, value: unknown) => {
    setAnswers((prev) => {
      const current = prev[key] ?? { parts: [], text: '' }
      const parts = current.parts.some((p) => p.label === label)
        ? current.parts.map((p) => (p.label === label ? { ...p, value } : p))
        : [...current.parts, { label, value }]
      return { ...prev, [key]: { ...current, parts } }
    })
  }

  const setText = (key: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { parts: [] }), text } }))
  }

  const advance = (next: SubmitResult) => {
    if (!day || !next.total || next.correct !== next.total || next.results.some((item) => item.status !== 'correct' || item.pendingAi)) return
    const subject = day.schedule.languageSubject
    navigate(`/${subject}/${date}`)
    speak(subject === 'chinese' ? '下面开始今日的语文作业' : '下面开始今日的英语作业', { lang: 'zh-CN' })
  }

  const submit = async () => {
    if (voiceKey) return
    setSubmitting(true)
    setError('')
    try {
      const r = await api.submit(date, 'math', answers)
      setResult(r)
      advance(r)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败了')
    } finally {
      setSubmitting(false)
    }
  }

  const correct = async (key: string) => {
    if (voiceKey) return
    const next = await submitCorrection(key)
    if (next) advance(next)
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

  if (!math) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-[var(--color-ink-soft)]">这一天没有数学作业。</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">
          回到首页
        </Link>
      </div>
    )
  }

  const answeredCount = groups.reduce(
    (n, g) =>
      n +
      g.questions.filter((q) => {
        const a = answers[`${g.key}-${q.no}`]
        if (!a) return false
        const hasPart = q.answer.parts.some((p) => {
          const v = a.parts.find((x) => x.label === p.label)?.value
          if (v === undefined || v === null || v === '') return false
          if (Array.isArray(v)) return v.length > 0
          return true
        })
        return hasPart || a.text.trim().length > 0
      }).length,
    0
  )
  const totalQuestions = groups.reduce((n, g) => n + g.questions.length, 0)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">数学作业</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
            {formatDate(date, true)} · 共 {totalQuestions} 题
            {answeredCount > 0 && ` · 已填 ${answeredCount} 题`}
          </p>
        </div>
        <Link to="/" className="text-[13px] text-[var(--color-ink-soft)] underline">
          返回今日
        </Link>
      </header>

      {result && (
        <section className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-semibold text-white"
              style={{ background: 'var(--color-math)' }}
            >
              {result.score}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                做对 {result.correct} / {result.total} 题
                {result.wrongCount > 0 && ` · 有 ${result.wrongCount} 道要订正`}
                {result.pending > 0 && ` · ${result.pending} 道等 AI 批改`}
              </p>
              <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
                {result.wrongCount > 0
                  ? '错的题下面有讲解，读不懂可以点「听讲解」。'
                    : result.pending > 0 ? '已提交，开放题等待 AI 批改。' : '全对！真厉害。'}
              </p>
                  {result.correct === result.total && !result.results.some((item) => item.pendingAi) ? <div className="mt-3"><SubjectFlow day={day} date={date} subject="math" /></div> : <p className="mt-2 text-sm">请逐题订正，全部答对后进入下一科。{result.results.some((item) => item.pendingAi) && '计算过程仍需 AI 核对。'}</p>}
            </div>
          </div>
        </section>
      )}

      <fieldset disabled={submitting || Boolean(correctingKey)} className="min-w-0 space-y-5">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[15px] font-semibold">{group.title}</h2>
            <span className="text-[12px] text-[var(--color-ink-soft)]">
              {GROUP_HINTS[group.key] ?? group.hint}
            </span>
          </div>

          {group.questions.map((q) => {
            const key = `${group.key}-${q.no}`
            const r = result?.results.find((x) => x.key === key)
            return (
              <QuestionCard
                key={key}
                q={q}
                answer={answers[key]}
                result={r}
                onPart={(label, value) => setPart(key, label, value)}
                onText={(text) => setText(key, text)}
                onCorrect={() => void correct(key)}
                correcting={correctingKey === key}
                voiceBusy={Boolean(voiceKey)}
                voiceDisabled={Boolean(voiceKey && voiceKey !== key)}
                onVoiceBusy={(busy) => setVoiceKey((previous) => busy ? key : previous === key ? null : previous)}
              />
            )
          })}
        </section>
      ))}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-[var(--color-line)] bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            {result ? '请完成剩余订正' : `已填 ${answeredCount} / ${totalQuestions} 题`}
          </p>
          {!result && <button
            type="button"
            onClick={submit}
            disabled={submitting || Boolean(voiceKey)}
            className="shrink-0 whitespace-nowrap rounded-xl bg-[var(--color-math)] px-5 py-2.5 text-[15px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? '批改中…' : result ? '再提交一次' : '提交批改'}
          </button>}
        </div>
      </div>
    </div>
  )
}

interface QProps {
  q: MathQuestion
  answer?: AnswerState
  result?: GradeResult
  onPart: (label: string, value: unknown) => void
  onText: (text: string) => void
  onCorrect: () => void
  correcting: boolean
  voiceBusy: boolean
  voiceDisabled: boolean
  onVoiceBusy: (busy: boolean) => void
}

function QuestionCard({ q, answer, result, onPart, onText, onCorrect, correcting, voiceBusy, voiceDisabled, onVoiceBusy }: QProps) {
  const valueOf = (label: string) => answer?.parts.find((p) => p.label === label)?.value
  const needsText = q.answer.aiText
  const inlineParts = q.answer.parts.filter((part) => ['number', 'choice', 'expression'].includes(part.kind))
  const promptSegments = q.prompt.split(/_{2,}|[（(]\s*[）)]|□/)
  const hasInlineBlanks = inlineParts.length > 0 && promptSegments.length === inlineParts.length + 1
  const remainingParts = q.answer.parts.filter((part) => !inlineParts.includes(part) && part.kind !== 'grid')

  return (
    <article className="card p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-math-soft)] text-[13px] font-semibold text-[var(--color-math)]">
          {q.no}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-loose">
            {hasInlineBlanks ? promptSegments.map((segment, index) => (
              <Fragment key={index}>
                {segment}
                {inlineParts[index] && <PartInput part={inlineParts[index]} value={valueOf(inlineParts[index].label)} onChange={(value) => onPart(inlineParts[index].label, value)} disabled={result?.status === 'correct'} inline />}
              </Fragment>
            )) : <>
              {q.prompt}
              {inlineParts.map((part) => (
                <span key={part.label} className="ml-2 inline-block max-w-full">
                  {inlineParts.length > 1 && <span className="mr-1 text-sm">{part.label}</span>}
                  <PartInput part={part} value={valueOf(part.label)} onChange={(value) => onPart(part.label, value)} disabled={result?.status === 'correct'} inline />
                </span>
              ))}
            </>}
          </p>

          {/* 数独网格 */}
          {q.figure?.type === 'sudoku' && (
            <div className="mt-3">
              <SudokuGrid
                rows={q.figure.rows}
                cols={q.figure.cols}
                boxRows={q.figure.boxRows}
                boxCols={q.figure.boxCols}
                values={q.figure.values}
                given={q.answer.parts.find((p) => p.kind === 'grid')?.given ?? []}
                value={(valueOf(q.answer.parts[0]?.label ?? '') as string[][]) ?? emptyGrid(q.figure.rows, q.figure.cols)}
                onChange={(grid) => onPart(q.answer.parts[0].label, grid)}
                disabled={result?.status === 'correct'}
              />
            </div>
          )}

          {/* 一笔画那种 ASCII 图 */}
          {q.figure?.type === 'ascii' && (
            <div className="mt-3">
              <AsciiFigure lines={q.figure.lines} />
            </div>
          )}

          {/* 数图形：3×3 空格子 */}
          {q.figure?.type === 'grid3' && (
            <div className="mt-3">
              <Grid3 />
            </div>
          )}

          {/* 作答区 */}
          {(remainingParts.length > 0 || needsText) && <div className="mt-3 space-y-2">
            {remainingParts.map((part) => (
              <PartInput
                key={part.label}
                part={part}
                value={valueOf(part.label)}
                onChange={(v) => onPart(part.label, v)}
                disabled={result?.status === 'correct'}
              />
            ))}
            {needsText && (
              <VoiceInput
                rows={3}
                label={`第${q.no}题，语音输入想法`}
                placeholder="我的想法和计算过程"
                value={answer?.text ?? ''}
                onChange={onText}
                disabled={voiceDisabled || (result?.status === 'correct' && !result.pendingAi)}
                onBusyChange={onVoiceBusy}
              />
            )}
          </div>}

          {result && (
            <div className="mt-3 space-y-2">
              <FeedbackCard result={result} no={q.no} title={q.prompt.slice(0, 12)} />
              {result.status !== 'correct' && (
                <button
                  type="button"
                  onClick={onCorrect}
                  disabled={correcting || voiceBusy}
                  className="rounded-lg border-2 border-[var(--color-math)] px-4 py-2 text-sm font-semibold text-[var(--color-math)] disabled:opacity-50"
                >
                  {correcting ? '订正批改中…' : '提交订正'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function emptyGrid(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
}

/** 3×3 空格子，用来数图形 */
function Grid3() {
  return (
    <div className="inline-block rounded-lg border-2 border-[var(--color-ink)] bg-white">
      <div className="grid grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className={cn(
              'h-12 w-12 border border-[var(--color-line)]',
              i % 3 !== 2 && 'border-r',
              i < 6 && 'border-b'
            )}
          />
        ))}
      </div>
    </div>
  )
}

interface PartProps {
  part: AnswerPart
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  inline?: boolean
}

function PartInput({ part, value, onChange, disabled, inline = false }: PartProps) {
  const str = typeof value === 'string' ? value : ''
  const inlineClass = 'mx-1 inline-block h-12 max-w-full rounded-md border-2 border-[var(--color-math)] bg-white px-2 text-center align-middle outline-none focus:ring-2 focus:ring-[var(--color-math-soft)] disabled:bg-[var(--color-math-soft)]'

  switch (part.kind) {
    case 'number':
      return (
        <label className={inline ? 'inline-flex max-w-full align-middle' : 'flex items-center gap-2 text-sm'}>
          <span className={inline ? 'sr-only' : 'shrink-0 text-[var(--color-ink-soft)]'}>{part.label}</span>
          <input
            className={inline ? `${inlineClass} w-24` : 'field w-28 text-center'}
            inputMode="numeric"
            disabled={disabled}
            value={str}
            onChange={(e) => onChange(e.target.value.replace(/[^\d.\-]/g, ''))}
          />
        </label>
      )

    case 'choice':
      return (
        <label className={inline ? 'inline-flex max-w-full align-middle' : 'flex items-center gap-2 text-sm'}>
          <span className={inline ? 'sr-only' : 'shrink-0 text-[var(--color-ink-soft)]'}>{part.label}</span>
          <select
            className={inline ? `${inlineClass} w-36` : 'field w-40'}
            disabled={disabled}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">选一个</option>
            {(part.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )

    case 'ranking': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <div>
          <span className="text-sm text-[var(--color-ink-soft)]">{part.label}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <select
                key={i}
                className="field w-28"
                disabled={disabled}
                value={arr[i] ?? ''}
                onChange={(e) => {
                  const next = [0, 1, 2].map((j) => arr[j] ?? '')
                  next[i] = e.target.value
                  onChange(next)
                }}
              >
                <option value="">第 {i + 1} 名</option>
                {(part.options ?? ['甲', '乙', '丙']).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
      )
    }

    case 'expression':
      return (
        <label className={inline ? 'inline-flex max-w-full align-middle' : 'flex items-center gap-2 text-sm'}>
          <span className={inline ? 'sr-only' : 'shrink-0 text-[var(--color-ink-soft)]'}>{part.label}</span>
          <input
            className={inline ? `${inlineClass} w-48 font-mono` : 'field flex-1 font-mono'}
            placeholder="写出你的算式"
            disabled={disabled}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )

    case 'lines': {
      const lines = Array.isArray(value) ? (value as string[]) : []
      return (
        <div>
          <span className="text-sm text-[var(--color-ink-soft)]">{part.label}</span>
          <div className="mt-1 space-y-1.5">
            {Array.from({ length: part.rows ?? 5 }, (_, i) => (
              <input
                key={i}
                className="field"
                placeholder={`第 ${i + 1} 种：2 本笔记本 + 1 支铅笔`}
                disabled={disabled}
                value={lines[i] ?? ''}
                onChange={(e) => {
                  const next = Array.from({ length: part.rows ?? 5 }, (_, j) => lines[j] ?? '')
                  next[i] = e.target.value
                  onChange(next)
                }}
              />
            ))}
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-ink-soft)]">
            小卖部：笔记本 4 元、铅笔 2 元、橡皮 1 元、棒棒糖 3 元，一共 10 元
          </p>
        </div>
      )
    }

    case 'grid':
      // 数独由专门的 SudokuGrid 渲染，这里不再重复
      return null

    default:
      return null
  }
}
