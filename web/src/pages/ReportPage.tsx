import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ReportData } from '../lib/api'
import { cn, formatDate, weekdayOf, SUBJECT_META } from '../lib/format'

/* 图表配色：跟系统主题一致，并且通过了色盲可分辨性校验 */
const SERIES = '#3778d7' // 品牌蓝：趋势线
const ERROR = '#d03b3b' // 状态色：错题（永远配文字，不靠颜色单独表意）
const GRID = '#e1e5ea'
const AXIS = '#c7ced7'
const INK = '#232933'
const INK_SOFT = '#626975'
const SURFACE = '#ffffff'

const SUBJECT_HEX: Record<string, { color: string; soft: string }> = {
  math: { color: '#3778d7', soft: '#e6f3ff' },
  chinese: { color: '#ca435f', soft: '#ffe9eb' },
  english: { color: '#cd8800', soft: '#fff4d3' },
  coding: { color: '#00986c', soft: '#ddfaec' },
}

const RANGES = [
  { key: '7', label: '最近 7 天', days: 7 },
  { key: '30', label: '最近 30 天', days: 30 },
  { key: 'all', label: '全部', days: 0 },
]

/* ---------- 小工具 ---------- */

function isoDate(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDate(d)
}

/** 量一下容器有多宽，图表按真实像素画，字才不会被缩得看不清 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** 柱子：顶端 4px 圆角，底端贴着基线是直角 */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

/* ---------- 折线图：每天的准确率 ---------- */

interface TrendPoint {
  date: string
  total: number
  correct: number
  rate: number
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const H = 220
  const PAD = { top: 16, right: 18, bottom: 28, left: 36 }
  const n = data.length
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = H - PAD.top - PAD.bottom

  const xAt = (i: number) =>
    n === 1 ? PAD.left + plotW / 2 : PAD.left + (i * plotW) / (n - 1)
  const yAt = (v: number) => PAD.top + plotH * (1 - v / 100)

  if (!width) return <div ref={wrapRef} className="h-[220px] w-full" />

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(d.rate)}`).join(' ')
  const area = `${line} L${xAt(n - 1)},${PAD.top + plotH} L${xAt(0)},${PAD.top + plotH} Z`

  const labelIdx = (() => {
    if (n <= 6) return data.map((_, i) => i)
    return [...new Set([0, Math.floor((n - 1) / 2), n - 1])]
  })()

  const active = hover !== null ? data[hover] : null

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={H}
        className="block"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const step = n === 1 ? plotW : plotW / (n - 1)
          const i = Math.round((x - PAD.left) / step)
          setHover(i >= 0 && i < n ? i : null)
        }}
      >
        {/* 网格线：一条细实线，退到背景里 */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={yAt(v)}
              y2={yAt(v)}
              stroke={v === 0 ? AXIS : GRID}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 7}
              y={yAt(v) + 3.5}
              textAnchor="end"
              fontSize={11}
              fill={INK_SOFT}
            >
              {v}%
            </text>
          </g>
        ))}

        {/* 面积是淡淡的底子，线才是主角 */}
        <path d={area} fill={SERIES} fillOpacity={0.1} />
        <path
          d={line}
          fill="none"
          stroke={SERIES}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 十字线找日期 */}
        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke={AXIS}
            strokeWidth={1}
          />
        )}

        {/* 最后一个点直接标数值 */}
        <circle
          cx={xAt(n - 1)}
          cy={yAt(data[n - 1].rate)}
          r={4.5}
          fill={SERIES}
          stroke={SURFACE}
          strokeWidth={2}
        />
        <text
          x={xAt(n - 1) - 6}
          y={yAt(data[n - 1].rate) - 8}
          textAnchor="end"
          fontSize={12}
          fontWeight={600}
          fill={INK}
        >
          {data[n - 1].rate}%
        </text>

        {hover !== null && (
          <circle
            cx={xAt(hover)}
            cy={yAt(data[hover].rate)}
            r={4.5}
            fill={SERIES}
            stroke={SURFACE}
            strokeWidth={2}
          />
        )}

        {/* X 轴日期 */}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            fontSize={11}
            fill={INK_SOFT}
          >
            {formatDate(data[i].date)}
          </text>
        ))}
      </svg>

      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[112px] rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2 shadow-lg"
          style={{
            left: Math.min(Math.max(xAt(hover) - 56, 0), Math.max(width - 120, 0)),
            top: Math.max(yAt(active.rate) - 74, 0),
          }}
        >
          <div className="text-[12px] font-semibold text-[var(--color-ink)]">
            {active.rate}%
          </div>
          <div className="text-[11px] text-[var(--color-ink-soft)]">
            {formatDate(active.date)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--color-ink-soft)]">
            <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: SERIES }} />
            答对 {active.correct} / {active.total} 题
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 柱状图：每个 7 天周期的错题数 ---------- */

function CycleBars({
  data,
  cycles,
}: {
  data: { cycle: number; wrong: number }[]
  cycles: { cycle: number; start: string; end: string }[]
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const H = 200
  const PAD = { top: 22, right: 12, bottom: 26, left: 30 }
  const n = data.length
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...data.map((d) => d.wrong))
  const band = n ? plotW / n : 0
  const barW = Math.min(24, band * 0.55)

  if (!width) return <div ref={wrapRef} className="h-[200px] w-full" />

  const active = hover !== null ? data[hover] : null
  const rangeOf = (cycle: number) => cycles.find((c) => c.cycle === cycle)

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg width={width} height={H} className="block" onMouseLeave={() => setHover(null)}>
        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke={AXIS}
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const h = (d.wrong / max) * plotH
          const x = PAD.left + band * i + (band - barW) / 2
          const y = PAD.top + plotH - h
          return (
            <g key={d.cycle}>
              {/* 透明的大热区，好点得中 */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <path
                d={barPath(x, y, barW, h)}
                fill={ERROR}
                fillOpacity={hover === null || hover === i ? 1 : 0.45}
              />
              <text
                x={x + barW / 2}
                y={y - 7}
                textAnchor="middle"
                fontSize={11}
                fill={INK}
              >
                {d.wrong}
              </text>
              <text
                x={x + barW / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={11}
                fill={INK_SOFT}
              >
                第{d.cycle}周
              </text>
            </g>
          )
        })}
      </svg>

      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2 shadow-lg"
          style={{
            left: Math.min(
              Math.max(PAD.left + band * hover + band / 2 - 60, 0),
              Math.max(width - 130, 0)
            ),
            top: 0,
          }}
        >
          <div className="text-[12px] font-semibold text-[var(--color-ink)]">
            {active.wrong} 道错题
          </div>
          <div className="text-[11px] text-[var(--color-ink-soft)]">
            第 {active.cycle} 周
            {(() => {
              const r = rangeOf(active.cycle)
              return r ? `（${formatDate(r.start)} ~ ${formatDate(r.end)}）` : ''
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 页面 ---------- */

export default function ReportPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [range, setRange] = useState('7')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showTrendTable, setShowTrendTable] = useState(false)

  const load = useCallback((key: string) => {
    const preset = RANGES.find((r) => r.key === key)
    const from = preset && preset.days ? daysAgo(preset.days) : undefined
    setLoading(true)
    setRefreshing(true)
    setError('')
    api
      .report(from)
      .then((r) => {
        setData(r)
        setLoading(false)
        setRefreshing(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '报告没能打开，再试一次吧')
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    load(range)
  }, [load, range])

  const totals = useMemo(() => {
    const list = data?.subjects ?? []
    const total = list.reduce((n, s) => n + s.total, 0)
    const correct = list.reduce((n, s) => n + s.correct, 0)
    return { total, correct, rate: total ? Math.round((correct / total) * 100) : 0 }
  }, [data])

  if (loading && !data) {
    return <div className="py-16 text-center text-[var(--color-ink-soft)]">加载中…</div>
  }

  if (!data) {
    return (
      <div className="card mx-auto max-w-md px-6 py-8 text-center">
        <p className="text-[15px] font-medium">学习报告没能打开</p>
        <p className="mt-1.5 text-[13px] text-[var(--color-ink-soft)]">{error}</p>
        <button
          className="mt-4 rounded-lg bg-[var(--color-math)] px-4 py-2 text-[14px] font-medium text-white"
          onClick={() => load(range)}
        >
          再试一次
        </button>
      </div>
    )
  }

  const byDate = data.byDate
  const hasData = totals.total > 0 || byDate.length > 0

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">学习报告</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          看看这段时间做得怎么样，进步了就奖励自己一下。
        </p>
      </header>

      {/* 时间范围：单独一行，作用范围是下面所有内容 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] text-[var(--color-ink-soft)]">看时间段：</span>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] transition-colors',
              range === r.key
                ? 'bg-[var(--color-math)] font-medium text-white'
                : 'bg-white text-[var(--color-ink-soft)] ring-1 ring-[var(--color-line)]'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{error}</p>
      )}

      {!hasData ? (
        <div className="card px-5 py-10 text-center">
          <p className="text-[16px] font-medium">还没有数据</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[var(--color-ink-soft)]">
            先去做几道今天的作业吧，做完这里就会长出你的学习曲线啦。
          </p>
        </div>
      ) : (
        <div className={cn('space-y-4 transition-opacity', refreshing && 'opacity-60')}>
          {/* 主角数字 + 各科小结 */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card px-4 py-3 sm:col-span-2 lg:col-span-1">
              <div className="text-[12px] text-[var(--color-ink-soft)]">这段时间的总正确率</div>
              <div className="mt-1 text-[46px] font-semibold leading-none">{totals.rate}%</div>
              <div className="mt-1.5 text-[12px] text-[var(--color-ink-soft)]">
                一共做了 {totals.total} 道题，答对 {totals.correct} 道
              </div>
            </div>

            {data.subjects.map((s) => {
              const hex = SUBJECT_HEX[s.subject] ?? { color: SERIES, soft: '#eef2f7' }
              return (
                <div key={s.subject} className="card px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: hex.color }}
                    />
                    <span className="text-[12px] text-[var(--color-ink-soft)]">
                      {SUBJECT_META[s.subject]?.label ?? s.label}
                    </span>
                  </div>
                  <div className="mt-1 text-[26px] font-semibold leading-none">{s.rate}%</div>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full"
                    style={{ background: hex.soft }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${s.rate}%`, background: hex.color }}
                    />
                  </div>
                  <div className="mt-1.5 text-[12px] text-[var(--color-ink-soft)]">
                    答对 {s.correct} / {s.total} 题
                  </div>
                </div>
              )
            })}
          </section>

          {/* 每天的正确率 */}
          <section className="card px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <h2 className="text-[15px] font-semibold">每天的正确率</h2>
                <p className="text-[12px] text-[var(--color-ink-soft)]">
                  越高说明当天做得越顺，慢慢往上走就很好
                </p>
              </div>
              <button
                className="ml-auto rounded-lg px-2.5 py-1 text-[12px] text-[var(--color-math)] ring-1 ring-[var(--color-math)]/30"
                onClick={() => setShowTrendTable((v) => !v)}
              >
                {showTrendTable ? '看图' : '看数据表'}
              </button>
            </div>

            {byDate.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[var(--color-ink-soft)]">
                这段时间还没有做题记录。
              </p>
            ) : showTrendTable ? (
              <div className="mt-2 max-h-[260px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-[12px] text-[var(--color-ink-soft)]">
                      <th className="py-1.5 pr-3 font-normal">日期</th>
                      <th className="py-1.5 pr-3 font-normal">正确率</th>
                      <th className="py-1.5 pr-3 font-normal">答对</th>
                      <th className="py-1.5 font-normal">总题数</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {byDate.map((d) => (
                      <tr key={d.date} className="border-t border-[var(--color-line)]">
                        <td className="py-1.5 pr-3">{formatDate(d.date)}</td>
                        <td className="py-1.5 pr-3">{d.rate}%</td>
                        <td className="py-1.5 pr-3">{d.correct}</td>
                        <td className="py-1.5">{d.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-2">
                <TrendChart data={byDate} />
              </div>
            )}
          </section>

          {/* 每个周期的错题数 */}
          <section className="card px-4 py-3">
            <h2 className="text-[15px] font-semibold">每个 7 天周期的新增错题</h2>
            <p className="text-[12px] text-[var(--color-ink-soft)]">
              错题少的周期，说明那几天学得很稳
            </p>
            {data.wrongByCycle.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[var(--color-ink-soft)]">
                这段时间还没有错题，真棒！
              </p>
            ) : (
              <div className="mt-2">
                <CycleBars data={data.wrongByCycle} cycles={data.cycles} />
              </div>
            )}
          </section>

          {/* 每日完成情况 */}
          <section className="card px-4 py-3">
            <h2 className="text-[15px] font-semibold">每日完成情况</h2>
            <p className="text-[12px] text-[var(--color-ink-soft)]">每天每科做了多少题</p>
            {data.progress.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[var(--color-ink-soft)]">
                还没有完成记录。
              </p>
            ) : (
              <div className="mt-2 max-h-[420px] overflow-auto">
                <table className="w-full min-w-[420px] text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-[12px] text-[var(--color-ink-soft)]">
                      <th className="py-1.5 pr-3 font-normal">日期</th>
                      <th className="py-1.5 pr-3 font-normal">科目</th>
                      <th className="py-1.5 pr-3 font-normal">状态</th>
                      <th className="py-1.5 pr-3 font-normal">得分</th>
                      <th className="py-1.5 font-normal">总题数</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.progress.map((row) => (
                      <tr
                        key={`${row.date}-${row.subject}`}
                        className="border-t border-[var(--color-line)]"
                      >
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {formatDate(row.date)} 周{weekdayOf(row.date)}
                        </td>
                        <td className="py-1.5 pr-3">
                          {SUBJECT_META[row.subject]?.label ?? row.subject}
                        </td>
                        <td className="py-1.5 pr-3">
                          {row.status === 'submitted'
                            ? '已完成'
                            : row.status === 'in_progress'
                              ? '做了一半'
                              : row.status}
                        </td>
                        <td className="py-1.5 pr-3">{row.score ?? '—'}</td>
                        <td className="py-1.5">{row.total ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
