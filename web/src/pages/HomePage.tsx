import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CalendarItem, type TodayOverview } from '../lib/api'
import { cn, formatDate, weekdayOf } from '../lib/format'
import StartSessionButton from '../components/StartSessionButton'
import { homeworkCompleted, nextHomeworkSubject } from '../lib/session'
import { BookOpen, Calculator, CodeXml, MessagesSquare, type LucideIcon } from 'lucide-react'

export default function HomePage() {
  const [overview, setOverview] = useState<TodayOverview | null>(null)
  const [calendar, setCalendar] = useState<CalendarItem[]>([])
  const [anchor, setAnchor] = useState('')
  const [today, setToday] = useState('')
  const [due, setDue] = useState(0)
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
        setToday(c.today)
        setDue(d.count)
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

  const beforeStart = today < anchor
  const selected = today
  const isToday = selected === today
  const dayItem = calendar.find((c) => c.date === selected)
  const progressFor = (subject: string) =>
    overview?.date === selected ? overview.progress.find((p) => p.subject === subject && (subject !== 'math' || overview.chineseUnlocked)) : undefined
  const planned = dayItem ? [...(dayItem.mathDay ? ['math'] : []), ...(dayItem.languageIndex ? [dayItem.languageSubject] : []), ...(dayItem.codingDay ? ['coding'] : [])] : []
  const finished = planned.filter((subject) => progressFor(subject)?.status === 'submitted').length
  const nextSubject = overview?.date === selected ? nextHomeworkSubject(overview) : undefined
  const allCompleted = overview?.date === selected && homeworkCompleted(overview)

  return (
    <div className="space-y-5">
      {/* 日期条 */}
      <details>
        <summary className="cursor-pointer text-sm text-[var(--color-ink-soft)]">未来 28 天作业安排</summary>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-[var(--color-ink-soft)]">作业安排</h2>
          <span className="text-[12px] text-[var(--color-ink-soft)]">
            作业从 {formatDate(anchor)} 开始
          </span>
        </div>
        <div role="list" aria-label="只读作业日历" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
          {calendar.map((c) => {
            const activeTab = c.date === selected
            return (
              <div
                key={c.date}
                role="listitem"
                aria-current={activeTab ? 'date' : undefined}
                title={formatDate(c.date, true)}
                className={cn(
                  'flex min-w-[3.4rem] shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 transition-colors',
                  activeTab
                    ? 'border-[var(--color-math)] bg-[var(--color-math-soft)]'
                    : 'border-[var(--color-line)] bg-white',
                  !activeTab && 'opacity-40'
                )}
              >
                <span className="text-[15px] font-medium leading-tight">
                  {Number(c.date.slice(8, 10))}
                </span>
                <span className="text-[11px] leading-tight text-[var(--color-ink-soft)]">
                  {weekdayOf(c.date)}
                </span>
              </div>
            )
          })}
        </div>
      </details>

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
              {formatDate(today, true)}{dayItem && ` · 第 ${dayItem.dayIndex} 天`}
            </p>
          </div>
          {dayItem && !dayItem.locked && <StartSessionButton date={selected} label={isToday ? '开始今日作业' : '开始这天的作业'} to={nextSubject ? `/${nextSubject}/${selected}` : undefined} completed={allCompleted} />}
        </div>

        {planned.length > 0 ? <div className="space-y-2 py-2">
          <p className="text-sm font-medium">今天已完成 {finished} / {planned.length} 项</p>
          <progress aria-label="今日完成进度" max={planned.length} value={finished} className="block h-3 w-full accent-[var(--color-coding)]" />
        </div> : <p className="text-sm text-[var(--color-ink-soft)]">今天没有安排作业。</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <SubjectCard
            subject="math"
            title="数学作业"
            desc="10 道题 · 自动批改"
            locked={!dayItem?.mathDay || dayItem.locked}
            progress={progressFor('math')}
            extra={dayItem && dayItem.mathDay ? `第 ${dayItem.mathDay} 天` : '今天没有数学作业'}
          />
          {dayItem?.languageSubject === 'chinese' ? (
            <SubjectCard
              subject="chinese"
              title="语文作业"
              desc="1 篇阅读 + 3 个问题"
              locked={!dayItem || dayItem.locked || overview?.date !== selected || !overview?.chineseUnlocked}
              progress={progressFor('chinese')}
              extra={overview?.date === selected && overview.chineseUnlocked ? '可以打字，也可以录音作答' : '当天数学全部答对后解锁'}
            />
          ) : (
            <SubjectCard
              subject="english"
              title="英语作业"
              desc="RAZ 原声听读与绘本阅读"
              locked={!dayItem || dayItem.locked || !dayItem.languageIndex}
              progress={progressFor('english')}
              extra="测级 · 听读 · 理解 · 复习"
            />
          )}
          <SubjectCard
            subject="coding"
            title="编程作业"
            desc="今天的小游戏任务"
            locked={!dayItem?.codingDay || dayItem.locked}
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

    </div>
  )
}

interface CardProps {
  to?: string
  subject: 'math' | 'chinese' | 'english' | 'coding'
  title: string
  desc: string
  extra?: string
  locked?: boolean
  progress?: { status: string; score: number | null; total: number | null }
}

const CARD_COLORS: Record<string, { bg: string; fg: string; soft: string; icon: LucideIcon }> = {
  math: { bg: 'var(--color-math)', fg: 'var(--color-math-ink)', soft: 'var(--color-math-soft)', icon: Calculator },
  chinese: {
    bg: 'var(--color-chinese)',
    fg: 'var(--color-chinese-ink)',
    soft: 'var(--color-chinese-soft)',
    icon: BookOpen,
  },
  english: {
    bg: 'var(--color-english)',
    fg: 'var(--color-english-ink)',
    soft: 'var(--color-english-soft)',
    icon: MessagesSquare,
  },
  coding: { bg: 'var(--color-coding)', fg: 'var(--color-coding-ink)', soft: 'var(--color-coding-soft)', icon: CodeXml },
}

function SubjectCard({ to, subject, title, desc, extra, locked, progress }: CardProps) {
  const c = CARD_COLORS[subject]
  const done = progress?.status === 'submitted'
  const body = (
    <div
      className={cn(
        'card flex h-full flex-col p-4 transition-all',
        locked ? 'pointer-events-none opacity-50' : to ? 'hover:-translate-y-0.5 hover:shadow-md' : ''
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ background: c.soft, color: c.fg }}
          aria-hidden
        >
          <c.icon className="h-6 w-6" aria-hidden="true" />
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
                已完成 {subject === 'math' && progress?.score != null ? `${progress.score} 分` : ''}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{desc}</p>
          {extra && <p className="mt-1 text-[12px] text-[var(--color-ink-soft)]">{extra}</p>}
        </div>
      </div>
    </div>
  )

  if (locked || !to) return body
  return (
    <Link to={to} className="block">
      {body}
    </Link>
  )
}
