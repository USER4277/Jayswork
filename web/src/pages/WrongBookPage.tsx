import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { cn, formatDate, friendlyDate, SUBJECT_META } from '../lib/format'
import type { WrongGroup, WrongItem } from '../types'

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'math', label: '数学' },
  { key: 'chinese', label: '语文' },
  { key: 'english', label: '英语' },
  { key: 'coding', label: '编程' },
]

interface CardProps {
  item: WrongItem
  today: string
  retryOpen: boolean
  typed: string
  result: { correct: boolean; message: string } | null
  explainOpen: boolean
  busy: boolean
  topicNames: Record<string, string>
  onToggleRetry: () => void
  onTyped: (value: string) => void
  onSubmitRetry: () => void
  onToggleExplain: () => void
  onToggleMastered: () => void
}

function WrongCard({
  item,
  today,
  retryOpen,
  typed,
  result,
  explainOpen,
  busy,
  topicNames,
  onToggleRetry,
  onTyped,
  onSubmitRetry,
  onToggleExplain,
  onToggleMastered,
}: CardProps) {
  const meta = SUBJECT_META[item.subject]
  const mastered = item.mastery > 0

  return (
    <article
      className={cn(
        'card overflow-hidden',
        item.due && 'ring-2 ring-[var(--color-math)]/25'
      )}
    >
      {/* 顶部一条学科色 + 状态徽章 */}
      <div
        className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2"
        style={{ background: meta?.soft }}
      >
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
          style={{ background: meta?.color }}
        >
          {meta?.label ?? item.subject}
        </span>
        {item.due && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-math)] ring-1 ring-[var(--color-math)]/30">
            今天要复习
          </span>
        )}
        {mastered && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
            已掌握
          </span>
        )}
        <span className="ml-auto text-[11px] text-[var(--color-ink-soft)]">
          错过 {item.wrongCount} 次
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-[15px] leading-relaxed">{item.questionText}</p>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-[var(--color-paper)] px-3 py-2">
            <div className="text-[11px] text-[var(--color-ink-soft)]">我写的</div>
            <div className="text-[14px] font-medium text-rose-700">{item.myAnswer || '（空着）'}</div>
          </div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2">
            <div className="text-[11px] text-[var(--color-ink-soft)]">正确答案</div>
            <div className="text-[14px] font-medium text-emerald-700">{item.correctAnswer}</div>
          </div>
        </div>

        {item.reason && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
            <span className="font-medium">错在哪：</span>
            {item.reason}
          </p>
        )}

        {item.knowledgePoint.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[var(--color-ink-soft)]">知识点</span>
            {item.knowledgePoint.map((kp) => {
              const name = topicNames[kp]
              const chip =
                'rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[11px] text-[var(--color-ink-soft)] ring-1 ring-[var(--color-line)]'
              // 认得出的知识点可以直接跳到图谱去看
              return name ? (
                <Link
                  key={kp}
                  to={`/graph?subject=${item.subject}&topic=${kp}`}
                  className={cn(chip, 'hover:text-[var(--color-math)]')}
                >
                  {name}
                </Link>
              ) : (
                <span key={kp} className={chip}>
                  {kp}
                </span>
              )
            })}
          </div>
        )}

        <p className="text-[12px] text-[var(--color-ink-soft)]">
          下次复习：
          {item.nextReviewDate ? friendlyDate(item.nextReviewDate, today) : '还没安排好'}
        </p>

        {/* 重做区 */}
        {retryOpen && (
          <div className="space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2.5">
            <label className="block text-[13px] text-[var(--color-ink-soft)]">
              再做一遍，把答案写在下面：
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                className="field flex-1 min-w-[160px]"
                value={typed}
                autoFocus
                onChange={(e) => onTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSubmitRetry()
                }}
                placeholder="写出你的答案"
              />
              <button
                className="rounded-lg bg-[var(--color-math)] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
                onClick={onSubmitRetry}
                disabled={busy || !typed.trim()}
              >
                {busy ? '检查中…' : '检查一下'}
              </button>
            </div>
            {result && (
              <p
                className={cn(
                  'rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                  result.correct
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-900'
                )}
              >
                {result.message}
              </p>
            )}
          </div>
        )}

        {explainOpen && item.explanation && (
          <div className="space-y-1.5 rounded-lg bg-[var(--color-math-soft)] px-3 py-2.5 text-[13px] leading-relaxed">
            <div className="font-medium">讲解</div>
            <p className="whitespace-pre-wrap">{item.explanation}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-0.5">
          <Link className="rounded-lg px-3 py-1.5 text-[13px] underline" to={`/${item.subject}/${item.date}`}>回原题订正</Link>
          <button
            className="rounded-lg bg-[var(--color-math)] px-3 py-1.5 text-[13px] font-medium text-white"
            onClick={onToggleRetry}
          >
            {retryOpen ? '先不做了' : '重做'}
          </button>
          <button
            className="rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-math)] ring-1 ring-[var(--color-math)]/30"
            onClick={onToggleExplain}
          >
            {explainOpen ? '收起讲解' : '看讲解'}
          </button>
          <button
            className={cn(
              'rounded-lg px-3 py-1.5 text-[13px] ring-1',
              mastered
                ? 'text-emerald-700 ring-emerald-200'
                : 'text-[var(--color-ink-soft)] ring-[var(--color-line)]'
            )}
            onClick={onToggleMastered}
            disabled={busy}
          >
            {mastered ? '取消「已掌握」' : '已掌握'}
          </button>
        </div>
      </div>
    </article>
  )
}

export default function WrongBookPage() {
  const [groups, setGroups] = useState<WrongGroup[]>([])
  const [today, setToday] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')

  const [retryOpen, setRetryOpen] = useState<Record<number, boolean>>({})
  const [typed, setTyped] = useState<Record<number, string>>({})
  const [result, setResult] = useState<Record<number, { correct: boolean; message: string }>>({})
  const [explainOpen, setExplainOpen] = useState<Record<number, boolean>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [topicNames, setTopicNames] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api
      .wrongBook()
      .then((r) => {
        setGroups(r.groups)
        setToday(r.today)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '错题本没能打开，再试一次吧')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** 局部更新一条错题（掌握状态、下次复习日等） */
  const patchItem = useCallback((id: number, patch: Partial<WrongItem>) => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        cycles: g.cycles.map((c) => ({
          ...c,
          items: c.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        })),
      }))
    )
  }, [])

  const submitRetry = useCallback(
    async (item: WrongItem) => {
      const value = (typed[item.id] ?? '').trim()
      if (!value) return
      setBusyId(item.id)
      try {
        const r = await api.retryWrong(item.id, value)
        const correct = r.correct
        // 后端规则：答对了就不再算「已掌握」，并安排好下一次复习的日子
        patchItem(item.id, {
          nextReviewDate: r.nextReviewDate,
          due: r.pending ? item.due : false,
          mastery: r.mastery ?? item.mastery,
          wrongCount: item.wrongCount + (!correct && !r.pending ? 1 : 0),
        })
        setResult((prev) => ({
          ...prev,
          [item.id]: {
            correct,
            message: r.pending ? r.message || '等待 AI 老师批改' : correct
              ? '答对啦！这道题已经安排好下次复习的日子，太棒了！'
              : '这次还没对，没关系～看看讲解，过一天我们再来一次。',
          },
        }))
      } catch (e: unknown) {
        setResult((prev) => ({
          ...prev,
          [item.id]: {
            correct: false,
            message: e instanceof Error ? e.message : '保存的时候出了点小问题，再试一次吧',
          },
        }))
      } finally {
        setBusyId(null)
      }
    },
    [typed, patchItem]
  )

  const toggleMastered = useCallback(
    async (item: WrongItem) => {
      setBusyId(item.id)
      const next = !(item.mastery > 0)
      try {
        await api.markMastered(item.id, next)
        patchItem(item.id, { mastery: next ? 1 : 0 })
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '操作没有成功，再试一次吧')
      } finally {
        setBusyId(null)
      }
    },
    [patchItem]
  )

  const allItems = useMemo(
    () => groups.flatMap((g) => g.cycles.flatMap((c) => c.items)),
    [groups]
  )
  const totalCount = allItems.length
  const masteredCount = allItems.filter((i) => i.mastery > 0).length
  const dueCount = allItems.filter((i) => i.due).length

  const countBySubject = useMemo(() => {
    const map: Record<string, number> = {}
    for (const g of groups) {
      map[g.subject] = g.cycles.reduce((n, c) => n + c.count, 0)
    }
    return map
  }, [groups])

  /* 错题里存的是知识点编号，这里换成看得懂的名字 */
  const needTopicNames = useMemo(
    () => allItems.some((i) => i.knowledgePoint.some((k) => /^cn[mec]_p\d+$/.test(k))),
    [allItems]
  )

  useEffect(() => {
    if (!needTopicNames) return
    let cancelled = false
    Promise.all(['math', 'chinese', 'english'].map((subject) => api.topics(subject, 6)))
      .then((rows) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const row of rows) for (const topic of row.topics) map[topic.id] = topic.name
        setTopicNames(map)
      })
      .catch(() => {
        // 拿不到名字就显示编号，不影响做题
      })
    return () => {
      cancelled = true
    }
  }, [needTopicNames])

  const visibleGroups = useMemo(
    () => groups.filter((g) => (tab === 'all' ? true : g.subject === tab)),
    [groups, tab]
  )

  if (loading) {
    return <div className="py-16 text-center text-[var(--color-ink-soft)]">加载中…</div>
  }

  if (error && allItems.length === 0) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <p className="text-[15px] font-medium">错题本没能打开</p>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">{error}</p>
        <button
          className="mt-4 rounded-lg bg-[var(--color-math)] px-4 py-2 text-[14px] font-medium text-white"
          onClick={load}
        >
          再试一次
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">错题本</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          把做错的题放在一起，过几天再来挑战一次，做对了就算拿下一道。
        </p>
      </header>

      {/* 小结 */}
      <section className="card grid grid-cols-3 divide-x divide-[var(--color-line)] overflow-hidden">
        <div className="px-3 py-3">
          <div className="text-[12px] text-[var(--color-ink-soft)]">一共</div>
          <div className="mt-0.5 text-[22px] font-semibold">{totalCount} 道</div>
        </div>
        <div className="px-3 py-3">
          <div className="text-[12px] text-[var(--color-ink-soft)]">已掌握</div>
          <div className="mt-0.5 text-[22px] font-semibold text-emerald-700">{masteredCount} 道</div>
        </div>
        <div className="px-3 py-3">
          <div className="text-[12px] text-[var(--color-ink-soft)]">今天该复习</div>
          <div className="mt-0.5 text-[22px] font-semibold text-[var(--color-math)]">{dueCount} 道</div>
        </div>
      </section>

      {error && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{error}</p>
      )}

      {/* 学科标签 */}
      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const active = tab === t.key
          const count = t.key === 'all' ? totalCount : countBySubject[t.key] ?? 0
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-full px-3 py-1.5 text-[13px] transition-colors',
                active
                  ? 'bg-[var(--color-math)] font-medium text-white'
                  : 'bg-white text-[var(--color-ink-soft)] ring-1 ring-[var(--color-line)]'
              )}
            >
              {t.label}
              <span className={cn('ml-1 text-[11px]', active ? 'text-white/80' : 'text-[var(--color-ink-soft)]')}>
                {count}
              </span>
            </button>
          )
        })}
      </nav>

      {totalCount === 0 ? (
        <div className="card px-5 py-10 text-center">
          <p className="text-[16px] font-medium">错题本还是空的，真棒！</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[var(--color-ink-soft)]">
            说明你最近做的题都答对啦。以后遇到不会的题，这里会自己收好它们，陪你再练一遍。
          </p>
        </div>
      ) : (
        visibleGroups.map((group) => {
          const meta = SUBJECT_META[group.subject]
          const groupCount = group.cycles.reduce((n, c) => n + c.count, 0)
          return (
            <section key={group.subject} className="space-y-3">
              {tab === 'all' && (
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <span className="h-3 w-1.5 rounded-full" style={{ background: meta?.color }} />
                  {group.label}
                  <span className="text-[12px] font-normal text-[var(--color-ink-soft)]">
                    {groupCount} 道
                  </span>
                </h2>
              )}

              {group.cycles.length === 0 ? (
                <div className="card px-4 py-6 text-center text-[13px] text-[var(--color-ink-soft)]">
                  这一科暂时没有错题，继续保持！
                </div>
              ) : (
                group.cycles.map((cycle) => (
                  <div key={cycle.cycle} className="space-y-2.5">
                    <div className="flex flex-wrap items-baseline gap-2 px-1">
                      <h3 className="text-[14px] font-semibold">
                        第 {cycle.cycle} 周
                        <span className="ml-1.5 text-[12px] font-normal text-[var(--color-ink-soft)]">
                          {cycle.range
                            ? `${formatDate(cycle.range.start)} ~ ${formatDate(cycle.range.end)}`
                            : cycle.label}
                        </span>
                      </h3>
                      <span className="text-[12px] text-[var(--color-ink-soft)]">
                        {cycle.count} 道 · 已掌握 {cycle.mastered} 道
                      </span>
                    </div>
                    {cycle.items.map((item) => (
                      <WrongCard
                        key={item.id}
                        item={item}
                        today={today}
                        retryOpen={!!retryOpen[item.id]}
                        typed={typed[item.id] ?? ''}
                        result={result[item.id] ?? null}
                        explainOpen={!!explainOpen[item.id]}
                        busy={busyId === item.id}
                        topicNames={topicNames}
                        onToggleRetry={() =>
                          setRetryOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                        }
                        onTyped={(value) => setTyped((prev) => ({ ...prev, [item.id]: value }))}
                        onSubmitRetry={() => submitRetry(item)}
                        onToggleExplain={() =>
                          setExplainOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                        }
                        onToggleMastered={() => toggleMastered(item)}
                      />
                    ))}
                  </div>
                ))
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
