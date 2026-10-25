import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { TopicDetail } from '../lib/api'
import { cn } from '../lib/format'
import type { GraphEdge, Topic } from '../types'

declare global {
  interface Window {
    cytoscape: any
    dagre: any
    cytoscapeDagre: any
  }
}

/* cytoscape 不认识 CSS 变量，这里用主题色换算好的固定色值 */
const MATH = '#3778d7'
const MATH_SOFT = '#e6f3ff'
const MATH_LINE = '#c9d6ea'
const INK = '#232933'

/* dagre 扩展只需要注册一次 */
let dagreRegistered = false

const GRADES = [1, 2, 3, 4, 5, 6]

interface PracticeResult {
  correct: boolean
  expected: string
  explanation: string
}

export default function GraphPage() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<any>(null)

  const [grade, setGrade] = useState(2)
  const [topics, setTopics] = useState<Topic[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [graphError, setGraphError] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TopicDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailNonce, setDetailNonce] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)

  const [practiceAns, setPracticeAns] = useState<Record<string, string>>({})
  const [practiceRes, setPracticeRes] = useState<Record<string, PracticeResult>>({})
  const [checking, setChecking] = useState<string | null>(null)
  const [cyReady, setCyReady] = useState(0)

  /* 从错题本跳过来时带着 ?topic=xxx */
  const [searchParams, setSearchParams] = useSearchParams()
  const topicParam = searchParams.get('topic')

  useEffect(() => {
    if (topicParam) setSelectedId(topicParam)
  }, [topicParam])

  /* 选中的知识点写回地址，刷新页面还在这里 */
  useEffect(() => {
    if (!selectedId) return
    if (searchParams.get('topic') === selectedId) return
    setSearchParams({ topic: selectedId }, { replace: true })
  }, [selectedId, searchParams, setSearchParams])

  /* ---------- 数据 ---------- */
  const loadTopics = useCallback((g: number) => {
    setLoading(true)
    setError('')
    api
      .topics('math', g)
      .then((r) => {
        setTopics(r.topics)
        setEdges(r.dependencies)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '知识点图谱没能打开，再试一次吧')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadTopics(grade)
  }, [loadTopics, grade])

  /* ---------- 图谱 ---------- */
  useEffect(() => {
    const cy = window.cytoscape
    if (!cy || !window.cytoscapeDagre) {
      setGraphError('图谱工具没有加载成功，先看看别的内容吧')
      return
    }
    if (!dagreRegistered) {
      cy.use(window.cytoscapeDagre)
      dagreRegistered = true
    }
    const host = containerRef.current
    if (!host) return

    const instance = cy({
      container: host,
      elements: [
        ...topics.map((t) => ({ data: { id: t.id, label: t.name, grade: t.grade } })),
        ...edges.map((e, i) => ({
          data: { id: `e${i}`, source: e.source, target: e.target, strength: e.strength },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            'background-color': MATH_SOFT,
            'border-color': MATH,
            'border-width': 1.5,
            label: 'data(label)',
            color: INK,
            'font-size': 12,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': 120,
            width: 'label',
            padding: 9,
            'min-zoomed-font-size': 9,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'background-color': '#d5e8fd',
            'border-width': 3,
            'border-color': MATH,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'curve-style': 'bezier',
            'line-color': MATH_LINE,
            'target-arrow-color': MATH_LINE,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
          },
        },
        {
          selector: 'edge[strength = "soft"]',
          style: { 'line-style': 'dashed' },
        },
      ],
      layout: { name: 'dagre', rankDir: 'TB', nodeSep: 24, rankSep: 60 },
      minZoom: 0.15,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    })

    instance.on('tap', 'node', (evt: any) => {
      const id = evt.target.id()
      setSelectedId(id)
      setShowAnswer(false)
      setPracticeAns({})
      setPracticeRes({})
    })

    cyRef.current = instance
    setCyReady((n) => n + 1)
    return () => {
      instance.destroy()
      cyRef.current = null
    }
  }, [topics, edges])

  /* 把选中的知识点挪到画面中间 */
  useEffect(() => {
    if (!selectedId) return
    const cy = cyRef.current
    if (!cy) return
    const node = cy.getElementById(selectedId)
    if (!node || node.length === 0) return
    cy.center(node)
  }, [selectedId, cyReady])

  /* ---------- 知识点详情 ---------- */
  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError('')
    api
      .topic(selectedId)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        setDetailLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setDetailError(e instanceof Error ? e.message : '这个知识点没能打开')
        setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, detailNonce])

  /** 点「先修知识点 / 能学到的知识点」时，把图谱挪到那一个点 */
  const focusTopic = useCallback((id: string) => {
    setSelectedId(id)
    setShowAnswer(false)
    setPracticeAns({})
    setPracticeRes({})
    const cy = cyRef.current
    if (!cy) return
    const node = cy.getElementById(id)
    if (!node || node.length === 0) return
    cy.zoom(Math.max(cy.zoom(), 0.9))
  }, [])

  const zoomBy = useCallback((factor: number) => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  }, [])

  const fitAll = useCallback(() => {
    cyRef.current?.fit(undefined, 40)
  }, [])

  const checkPractice = useCallback(async (questionId: string) => {
    const answer = (practiceAns[questionId] ?? '').trim()
    if (!answer) return
    setChecking(questionId)
    try {
      const r = await api.practice(questionId, answer)
      setPracticeRes((prev) => ({ ...prev, [questionId]: r }))
    } catch (e: unknown) {
      setPracticeRes((prev) => ({
        ...prev,
        [questionId]: {
          correct: false,
          expected: '',
          explanation: e instanceof Error ? e.message : '检查的时候出了点问题，再试一次吧',
        },
      }))
    } finally {
      setChecking(null)
    }
  }, [practiceAns])

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedId) ?? null,
    [topics, selectedId]
  )

  /* ---------- 渲染 ---------- */
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">知识点图谱</h1>
          <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
            数学知识点像一张地图：先学会上面的，下面才会出现。点一个方框看看它的故事。
          </p>
        </div>
      </header>

      {/* 年级筛选：统一放在图表上方，作用范围覆盖整页 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] text-[var(--color-ink-soft)]">看几年级的：</span>
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[13px] transition-colors',
              grade === g
                ? 'bg-[var(--color-math)] font-medium text-white'
                : 'bg-white text-[var(--color-ink-soft)] ring-1 ring-[var(--color-line)]'
            )}
          >
            {g} 年级
          </button>
        ))}
      </div>

      {error && (
        <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
          <p className="text-[13px]">{error}</p>
          <button
            className="rounded-lg bg-[var(--color-math)] px-3 py-1.5 text-[13px] font-medium text-white"
            onClick={() => loadTopics(grade)}
          >
            再试一次
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* 图谱本体 */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
            <span className="text-[13px] font-medium">
              {grade} 年级 · {topics.length} 个知识点
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                className="h-8 w-8 rounded-lg text-[15px] leading-none ring-1 ring-[var(--color-line)]"
                onClick={() => zoomBy(1.2)}
                aria-label="放大"
              >
                ＋
              </button>
              <button
                className="h-8 w-8 rounded-lg text-[15px] leading-none ring-1 ring-[var(--color-line)]"
                onClick={() => zoomBy(0.8)}
                aria-label="缩小"
              >
                －
              </button>
              <button
                className="rounded-lg px-2 py-1.5 text-[12px] ring-1 ring-[var(--color-line)]"
                onClick={fitAll}
              >
                看全部
              </button>
            </div>
          </div>

          <div className="relative">
            {graphError ? (
              <div className="flex h-[520px] items-center justify-center px-6 text-center">
                <div>
                  <p className="text-[15px] font-medium">图谱工具没有加载成功</p>
                  <p className="mt-1.5 text-[13px] text-[var(--color-ink-soft)]">
                    {graphError}。刷新一下页面通常就好了，实在不行可以去错题本做几道题。
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div ref={containerRef} className="h-[520px] w-full bg-white" />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[var(--color-ink-soft)]">
                    加载中…
                  </div>
                )}
                {!loading && topics.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                    <p className="text-[13px] text-[var(--color-ink-soft)]">
                      这个年级还没有知识点，先看看别的年级吧。
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <p className="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-ink-soft)]">
            实线箭头是「必须先学会」，虚线箭头是「顺便学一学就更好了」。
          </p>
        </section>

        {/* 详情面板 */}
        <aside className="space-y-3">
          {!selectedId ? (
            <div className="card px-4 py-8 text-center">
              <p className="text-[14px] font-medium">点一个知识点看看</p>
              <p className="mx-auto mt-1.5 max-w-[240px] text-[13px] text-[var(--color-ink-soft)]">
                左边图谱里的每个方框都可以点开，里面有讲解、诊断题和练一练。
              </p>
            </div>
          ) : (
            <>
              <div className="card overflow-hidden">
                <div className="border-b border-[var(--color-line)] px-4 py-3" style={{ background: MATH_SOFT }}>
                  <h2 className="text-[17px] font-semibold">
                    {detail?.topic.name ?? selectedTopic?.name ?? '知识点'}
                  </h2>
                  {detail?.topic && (
                    <p className="mt-0.5 text-[12px] text-[var(--color-ink-soft)]">
                      {detail.topic.grade} 年级 {detail.topic.semester} · {detail.topic.chapter}
                    </p>
                  )}
                </div>

                {detailLoading && (
                  <p className="px-4 py-6 text-center text-[13px] text-[var(--color-ink-soft)]">
                    加载中…
                  </p>
                )}

                {detailError && (
                  <div className="px-4 py-5 text-center">
                    <p className="text-[13px]">{detailError}</p>
                    <button
                      className="mt-3 rounded-lg bg-[var(--color-math)] px-3 py-1.5 text-[13px] font-medium text-white"
                      onClick={() => setDetailNonce((n) => n + 1)}
                    >
                      点我重试
                    </button>
                  </div>
                )}

                {detail && !detailLoading && (
                  <div className="space-y-4 px-4 py-3">
                    {detail.topic.description && (
                      <p className="text-[13px] leading-relaxed">{detail.topic.description}</p>
                    )}

                    {detail.topic.masteryCriteria.length > 0 && (
                      <section>
                        <h3 className="text-[13px] font-semibold">掌握标准</h3>
                        <ul className="mt-1.5 space-y-1">
                          {detail.topic.masteryCriteria.map((c) => (
                            <li key={c} className="flex gap-1.5 text-[13px] leading-relaxed">
                              <span className="text-emerald-600">✓</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {detail.topic.diagnostic && (
                      <section className="rounded-lg bg-[var(--color-paper)] px-3 py-2.5">
                        <h3 className="text-[13px] font-semibold">诊断题</h3>
                        <p className="mt-1 text-[13px] leading-relaxed">
                          {detail.topic.diagnostic.question}
                        </p>
                        {showAnswer ? (
                          <p className="mt-1.5 text-[13px] text-emerald-700">
                            答案：{detail.topic.diagnostic.answer}
                          </p>
                        ) : (
                          <button
                            className="mt-2 rounded-lg px-2.5 py-1 text-[12px] text-[var(--color-math)] ring-1 ring-[var(--color-math)]/30"
                            onClick={() => setShowAnswer(true)}
                          >
                            看答案
                          </button>
                        )}
                      </section>
                    )}

                    {detail.prerequisites.length > 0 && (
                      <section>
                        <h3 className="text-[13px] font-semibold">先学这些更好懂</h3>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {detail.prerequisites.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => focusTopic(p.id)}
                              className="rounded-full bg-[var(--color-paper)] px-2.5 py-1 text-[12px] text-[var(--color-ink-soft)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-math)]"
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </section>
                    )}

                    {detail.unlocks.length > 0 && (
                      <section>
                        <h3 className="text-[13px] font-semibold">学会了能接着学</h3>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {detail.unlocks.map((u) => (
                            <button
                              key={u.id}
                              onClick={() => focusTopic(u.id)}
                              className="rounded-full bg-[var(--color-paper)] px-2.5 py-1 text-[12px] text-[var(--color-ink-soft)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-math)]"
                            >
                              {u.name}
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>

              {/* 练一练 */}
              {detail && detail.questions.length > 0 && (
                <div className="card space-y-3 px-4 py-3">
                  <h3 className="text-[14px] font-semibold">练一练</h3>
                  {detail.questions.map((q) => {
                    const res = practiceRes[q.id]
                    const answer = practiceAns[q.id] ?? ''
                    return (
                      <div key={q.id} className="space-y-2 rounded-lg bg-[var(--color-paper)] px-3 py-2.5">
                        <p className="text-[13px] leading-relaxed">{q.prompt}</p>

                        {q.choices.length > 0 ? (
                          <div className="space-y-1.5">
                            {q.choices.map((c) => (
                              <label
                                key={c.key}
                                className="flex cursor-pointer items-start gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[13px] ring-1 ring-[var(--color-line)]"
                              >
                                <input
                                  type="radio"
                                  name={`q-${q.id}`}
                                  className="mt-0.5"
                                  checked={answer === c.key}
                                  onChange={() =>
                                    setPracticeAns((prev) => ({ ...prev, [q.id]: c.key }))
                                  }
                                />
                                <span>
                                  <span className="font-medium">{c.key}.</span> {c.text}
                                </span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <input
                            className="field"
                            value={answer}
                            inputMode="numeric"
                            placeholder="写出答案"
                            onChange={(e) =>
                              setPracticeAns((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') checkPractice(q.id)
                            }}
                          />
                        )}

                        <button
                          className="rounded-lg bg-[var(--color-math)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
                          onClick={() => checkPractice(q.id)}
                          disabled={checking === q.id || !answer.trim()}
                        >
                          {checking === q.id ? '检查中…' : '检查'}
                        </button>

                        {res && (
                          <div
                            className={cn(
                              'rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                              res.correct
                                ? 'bg-emerald-50 text-emerald-800'
                                : 'bg-amber-50 text-amber-900'
                            )}
                          >
                            <p className="font-medium">{res.correct ? '✓ 答对啦！' : '✗ 再想想～'}</p>
                            {!res.correct && res.expected && (
                              <p className="mt-0.5">正确答案是：{res.expected}</p>
                            )}
                            {res.explanation && <p className="mt-0.5">{res.explanation}</p>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
