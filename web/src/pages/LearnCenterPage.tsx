import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { cn } from '../lib/format'

interface ChatMessage {
  role: string
  content: string
  created_at: string
}

/** 学习中心里的四张入口卡片 */
const ENTRIES = [
  {
    to: '/graph',
    title: '知识点图谱',
    desc: '看看知识点是怎么一个连一个的，先学会上面的，下面才轻松。',
    color: 'var(--color-math)',
    soft: 'var(--color-math-soft)',
    icon: '🗺️',
  },
  {
    to: '/wrong',
    title: '错题本',
    desc: '做错的题会自动收进这里，过几天再挑战一次就算拿下。',
    color: 'var(--color-chinese)',
    soft: 'var(--color-chinese-soft)',
    icon: '📕',
  },
  {
    to: '/report',
    title: '学习报告',
    desc: '每天的正确率、错题变化，都画成图给你看。',
    color: 'var(--color-english)',
    soft: 'var(--color-english-soft)',
    icon: '📈',
  },
]

export default function LearnCenterPage() {
  const [dueCount, setDueCount] = useState<number | null>(null)
  const [dueError, setDueError] = useState('')

  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [aiError, setAiError] = useState('')

  const [history, setHistory] = useState<ChatMessage[]>([])
  const [showAllHistory, setShowAllHistory] = useState(false)
  const replyRef = useRef<HTMLDivElement | null>(null)

  /* ---------- 今天要复习多少道 ---------- */
  const loadDue = useCallback(() => {
    api
      .due()
      .then((r) => setDueCount(r.count))
      .catch(() => setDueError('今天的复习清单没能打开'))
  }, [])

  useEffect(() => {
    loadDue()
  }, [loadDue])

  /* ---------- 最近问过 AI 的问题 ---------- */
  const loadHistory = useCallback(() => {
    fetch('/api/ai/chat/history?limit=20')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ChatMessage[]) => {
        setHistory(Array.isArray(rows) ? rows : [])
      })
      .catch(() => setHistory([]))
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    // 只滚动答案框本身，不抢走页面的滚动位置
    const el = replyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [reply])

  /* ---------- 问 AI（自己读 SSE） ---------- */
  const ask = async () => {
    const text = question.trim()
    if (!text || streaming) return
    setQuestion('')
    setReply('')
    setAiError('')
    setStreaming(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })

      if (!res.ok) {
        // 出错时后端会返回 { error: '...' }
        let detail = ''
        try {
          const body = (await res.json()) as { error?: string }
          if (body?.error) detail = body.error
        } catch {
          // 不是 JSON 就用默认说法
        }
        setAiError(
          res.status === 503
            ? 'AI 老师还没上线，先看看知识点图谱吧。等爸爸把 AI 打开，随时都能问。'
            : detail || 'AI 老师答不上来，等一会儿再问一次吧'
        )
        setStreaming(false)
        return
      }

      if (!res.body) {
        setAiError('AI 老师没有回答，再试一次吧')
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE 用空行分段，一段里有 event: 和 data:
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          let event = 'message'
          const dataLines: string[] = []
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          if (!dataLines.length) continue

          let payload: { text?: string; error?: string }
          try {
            payload = JSON.parse(dataLines.join('\n'))
          } catch {
            continue
          }

          if (event === 'delta' && payload.text) {
            setReply((prev) => prev + payload.text)
          } else if (event === 'error') {
            setAiError(payload.error || 'AI 老师答到一半卡住了，再问一次吧')
          }
        }
      }
      loadHistory()
    } catch {
      setAiError('网络有点慢，AI 老师没回答上，再试一次吧')
    } finally {
      setStreaming(false)
    }
  }

  const shownHistory = showAllHistory ? history : history.slice(-5)

  return (
    <div className="space-y-4">
      {/* 开头的大卡片 */}
      <section
        className="card overflow-hidden px-5 py-5"
        style={{ background: 'linear-gradient(135deg, #e6f3ff 0%, #f8fafd 70%)' }}
      >
        <h1 className="text-[22px] font-semibold tracking-tight">学习中心</h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[var(--color-ink-soft)]">
          这里是曹昌洵专属教育系统的小书房。写作业累了就来转转：
          可以看看知识点是怎么连起来的，把错题一道道消灭，看看自己的进步，
          还可以问 AI 老师任何不会的题。慢慢来，每天进步一点点就很好。
        </p>
      </section>

      {/* 四个入口 */}
      <section className="grid gap-3 sm:grid-cols-2">
        {ENTRIES.map((e) => (
          <Link
            key={e.to}
            to={e.to}
            className="card flex items-start gap-3 px-4 py-4 transition-shadow hover:shadow-md"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[20px]"
              style={{ background: e.soft }}
              aria-hidden
            >
              {e.icon}
            </span>
            <span>
              <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: e.color }} />
                {e.title}
              </span>
              <span className="mt-1 block text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
                {e.desc}
              </span>
            </span>
          </Link>
        ))}

        {/* 每日复习 */}
        <div className="card px-4 py-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[20px]"
              style={{ background: 'var(--color-coding-soft)' }}
              aria-hidden
            >
              ⏰
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[15px] font-semibold">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: 'var(--color-coding)' }}
                />
                每日复习
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
                {dueError
                  ? dueError
                  : dueCount === null
                    ? '正在数一数今天要复习的题…'
                    : dueCount === 0
                      ? '今天没有要复习的题，可以去学点新的！'
                      : `今天有 ${dueCount} 道题等着你复习。`}
              </p>
              <Link
                to="/wrong"
                className="mt-2.5 inline-block rounded-lg bg-[var(--color-coding)] px-3 py-1.5 text-[13px] font-medium text-white"
              >
                开始复习
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 问 AI */}
      <section className="card px-4 py-4">
        <h2 className="text-[15px] font-semibold">问 AI 老师</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          哪里不懂就问这里，AI 老师会一步一步讲给你听。
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="field flex-1 min-w-[200px]"
            value={question}
            placeholder="比如：什么是进位加法？"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ask()
            }}
          />
          <button
            className="rounded-lg bg-[var(--color-math)] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50"
            onClick={ask}
            disabled={streaming || !question.trim()}
          >
            {streaming ? 'AI 正在想…' : '问一问'}
          </button>
        </div>

        {aiError && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-900">
            {aiError}
          </p>
        )}

        {(reply || streaming) && (
          <div className="mt-3 rounded-lg bg-[var(--color-paper)] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-soft)]">
              <span className="h-2 w-2 rounded-full bg-[var(--color-math)]" />
              AI 老师
            </div>
            <div
              ref={replyRef}
              className="mt-1.5 max-h-[320px] overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed"
            >
              {reply}
              {streaming && <span className="ml-0.5 animate-pulse">▍</span>}
            </div>
          </div>
        )}
      </section>

      {/* 最近的对话 */}
      {history.length > 0 && (
        <section className="card px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">最近问过的问题</h2>
            <button
              className="ml-auto rounded-lg px-2.5 py-1 text-[12px] text-[var(--color-math)] ring-1 ring-[var(--color-math)]/30"
              onClick={() => setShowAllHistory((v) => !v)}
            >
              {showAllHistory ? '只看最近 5 条' : `看全部 ${history.length} 条`}
            </button>
          </div>
          <ul className="mt-2.5 space-y-2">
            {shownHistory.map((m, i) => (
              <li
                key={`${m.created_at}-${i}`}
                className={cn(
                  'rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                  m.role === 'user'
                    ? 'bg-[var(--color-math-soft)]'
                    : 'bg-[var(--color-paper)]'
                )}
              >
                <span className="mr-1.5 text-[11px] text-[var(--color-ink-soft)]">
                  {m.role === 'user' ? '我' : 'AI'}
                </span>
                <span className="whitespace-pre-wrap">{m.content}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
