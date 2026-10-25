import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CalendarItem, type TodayOverview } from '../lib/api'
import { cn, formatDate, weekdayOf } from '../lib/format'
import StartSessionButton from '../components/StartSessionButton'

export default function HomePage() {
  const [overview, setOverview] = useState<TodayOverview | null>(null)
  const [calendar, setCalendar] = useState<CalendarItem[]>([])
  const [anchor, setAnchor] = useState('')
  const [due, setDue] = useState(0)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([api.today(), api.calendar(undefined, 28), api.due()])
      .then(([t, c, d]) => {
        if (!alive) return
        setOverview(t)
        setCalendar(c.items)
        setAnchor(c.anchor)
        setDue(d.count)
        setSelected(t.date)
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (loading) {
    return <p className="py-16 text-center text-sm text-[var(--color-ink-soft)]">加载中…</p>
  }

  if (error) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <p className="text-sm text-amber-700">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm"
        >
          重新加载
        </button>
      </div>
    )
  }

  const beforeStart = overview && calendar.length > 0 && selected < anchor
  const isToday = selected === overview?.date
  const dayItem = calendar.find((c) => c.date === selected)
  const progressFor = (subject: string) =>
    overview?.progress.find((p) => p.subject === subject)

  return (
    <div className="space-y-5">
      {/* 日期条 */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-[var(--color-ink-soft)]">选择日期</h2>
          <span className="text-[12px] text-[var(--color-ink-soft)]">
            作业从 {formatDate(anchor)} 开始
          </span>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
          {calendar.map((c) => {
            const activeTab = c.date === selected
            return (
              <button
                key={c.date}
                type="button"
                disabled={c.locked}
                onClick={() => setSelected(c.date)}
                title={c.locked ? '还没到时间，不能打开' : formatDate(c.date, true)}
                className={cn(
                  'flex min-w-[3.4rem] shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 transition-colors',
                  activeTab
                    ? 'border-[var(--color-math)] bg-[var(--color-math-soft)]'
                    : 'border-[var(--color-line)] bg-white',
                  c.locked && 'cursor-not-allowed opacity-40'
                )}
              >
                <span className="text-[15px] font-medium leading-tight">
                  {Number(c.date.slice(8, 10))}
                </span>
                <span className="text-[11px] leading-tight text-[var(--color-ink-soft)]">
                  {c.locked ? '🔒' : weekdayOf(c.date)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {beforeStart && (
        <div className="card p-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          作业还没开始，{formatDate(anchor)} 才有第一天的内容。先看看下面的安排吧。
        </div>
      )}

      {/* 今日作业 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {isToday ? '今天的作业' : `${formatDate(selected)} 的作业`}
            </h1>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
              {dayItem?.languageSubject === 'chinese' ? '语文' : '英语'}日 ·{' '}
              第 {dayItem?.cycle ?? '—'} 周
            </p>
          </div>
          {isToday && <StartSessionButton date={selected} />}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SubjectCard
            to={`/math/${selected}`}
            subject="math"
            title="数学作业"
            desc="10 道题 · 自动批改"
            locked={dayItem?.locked}
            progress={progressFor('math')}
            extra={dayItem && dayItem.mathDay ? `第 ${dayItem.mathDay} 天` : '今天没有数学作业'}
          />
          {dayItem?.languageSubject === 'chinese' ? (
            <SubjectCard
              to={`/chinese/${selected}`}
              subject="chinese"
              title="语文作业"
              desc="1 篇阅读 + 3 个问题"
              locked={dayItem?.locked}
              progress={progressFor('chinese')}
              extra="可以打字，也可以说给老师听"
            />
          ) : (
            <SubjectCard
              to={`/english/${selected}`}
              subject="english"
              title="英语作业"
              desc="跟读录音 + 听音选择 + 对话"
              locked={dayItem?.locked}
              progress={progressFor('english')}
              extra="可以点小话筒练发音"
            />
          )}
          <SubjectCard
            to={`/coding/${selected}`}
            subject="coding"
            title="编程作业"
            desc="今天的小游戏任务"
            locked={dayItem?.locked}
            progress={progressFor('coding')}
            extra={dayItem?.codingDay ? `第 ${dayItem.codingDay} 天` : '今天没有编程作业'}
          />
          <SubjectCard
            to="/wrong"
            subject="math"
            title="错题本"
            desc={due > 0 ? `今天有 ${due} 道要复习` : '按科目和每周整理'}
            locked={false}
            progress={undefined}
            extra="点进去看看"
          />
        </div>
      </section>

      {/* 提示 */}
      <section className="card p-4 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
        <p className="mb-1 font-medium text-[var(--color-ink)]">小提示</p>
        <p>
          数学题做完可以直接点「提交」，系统会一道一道批改，错了会告诉你错在哪，还能听老师讲一遍。
          语文题可以说给老师听，英语题可以点小话筒练发音。
        </p>
      </section>
    </div>
  )
}

interface CardProps {
  to: string
  subject: 'math' | 'chinese' | 'english' | 'coding'
  title: string
  desc: string
  extra?: string
  locked?: boolean
  progress?: { status: string; score: number | null; total: number | null }
}

const CARD_COLORS: Record<string, { bg: string; fg: string; soft: string }> = {
  math: { bg: 'var(--color-math)', fg: 'var(--color-math)', soft: 'var(--color-math-soft)' },
  chinese: {
    bg: 'var(--color-chinese)',
    fg: 'var(--color-chinese)',
    soft: 'var(--color-chinese-soft)',
  },
  english: {
    bg: 'var(--color-english)',
    fg: 'var(--color-english)',
    soft: 'var(--color-english-soft)',
  },
  coding: { bg: 'var(--color-coding)', fg: 'var(--color-coding)', soft: 'var(--color-coding-soft)' },
}

function SubjectCard({ to, subject, title, desc, extra, locked, progress }: CardProps) {
  const c = CARD_COLORS[subject]
  const done = progress?.status === 'submitted'
  const body = (
    <div
      className={cn(
        'card flex h-full flex-col p-4 transition-all',
        locked ? 'pointer-events-none opacity-50' : 'hover:-translate-y-0.5 hover:shadow-md'
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ background: c.soft, color: c.fg }}
          aria-hidden
        >
          {{ math: '🔢', chinese: '📖', english: '🔤', coding: '🎮' }[subject]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            {locked && <span className="text-[12px]">🔒</span>}
            {done && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: c.soft, color: c.fg }}
              >
                已完成 {progress?.score ?? 0} 分
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{desc}</p>
          {extra && <p className="mt-1 text-[12px] text-[var(--color-ink-soft)]">{extra}</p>}
        </div>
      </div>
    </div>
  )

  if (locked) return <div className="card p-4 opacity-50">{locked && body}</div>
  return (
    <Link to={to} className="block">
      {body}
    </Link>
  )
}
