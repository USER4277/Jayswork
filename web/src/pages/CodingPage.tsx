import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DayContent } from '../types'
import { cn, formatDate } from '../lib/format'
import SpeechButton from '../components/SpeechButton'

interface Checklist {
  item: string
  how: string
}

export default function CodingPage() {
  const { date = '' } = useParams()
  const [day, setDay] = useState<DayContent | null>(null)
  const [gain, setGain] = useState('')
  const [learned, setLearned] = useState('')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .day(date)
      .then(setDay)
      .catch((err) => setError(err.message))
    api
      .codingNoteGet(date)
      .then((n) => {
        setGain(n.gain)
        setLearned(n.learned)
        setChecklist(n.checklist)
      })
      .catch(() => {})
  }, [date])

  const save = async () => {
    await api.codingNote(date, gain, learned, checklist)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 没有剪贴板权限时退回到选中文本
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* 放弃 */
      }
      document.body.removeChild(ta)
    }
    setCopied(label)
    window.setTimeout(() => setCopied(null), 2000)
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
  if (!day.coding) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-[var(--color-ink-soft)]">这一天没有编程作业。</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">
          回到首页
        </Link>
      </div>
    )
  }

  const c = day.coding

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">编程作业</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
            {formatDate(date, true)} · {c.project}《{c.projectTitle}》 · {c.dayTitle}
          </p>
        </div>
        <Link to="/" className="text-[13px] text-[var(--color-ink-soft)] underline">
          返回今日
        </Link>
      </header>

      {/* 今天的目标 */}
      <section className="card border-l-4 border-l-[var(--color-coding)] p-4">
        <h2 className="text-[13px] font-medium text-[var(--color-ink-soft)]">今天的目标</h2>
        <p className="mt-1 text-[15px] leading-relaxed">{c.goal}</p>
      </section>

      {/* 先读一读 */}
      {c.readFirst && (
        <section className="card bg-[var(--color-coding-soft)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-medium">开始之前，先读一读</h2>
            <SpeechButton text={c.readFirst} label="读给我听" />
          </div>
          <p className="mt-1.5 text-[14px] leading-relaxed">{c.readFirst}</p>
        </section>
      )}

      {/* 今天这样做 */}
      {c.steps.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-[15px] font-semibold">今天这样做</h2>
          <ol className="space-y-2">
            {c.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-coding-soft)] text-[12px] font-medium text-[var(--color-coding)]">
                  {i + 1}
                </span>
                <span className="flex-1 text-[14px] leading-relaxed">{s.replace(/^第\s*\d+\s*步\s*/, '')}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 可以复制给 AI 的话 */}
      {c.prompts.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-[15px] font-semibold">可以复制给 AI 的话</h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">
              整段复制，一个字都不用改 —— 复制粘贴本身也是要练的能力。
            </p>
          </div>
          {c.prompts.map((p, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-coding-soft)] px-4 py-2">
                <span className="text-[13px] font-medium text-[var(--color-coding)]">{p.label}</span>
                <button
                  type="button"
                  onClick={() => copy(p.label, p.text)}
                  className="rounded-lg bg-[var(--color-coding)] px-3 py-1 text-[13px] text-white"
                >
                  {copied === p.label ? '已复制 ✓' : '一键复制'}
                </button>
              </div>
              <p className="whitespace-pre-wrap p-4 text-[14px] leading-relaxed">{p.text}</p>
            </div>
          ))}
        </section>
      )}

      {/* 保存小抄 */}
      {c.saveTip && (
        <section className="card border-dashed p-4">
          <h2 className="text-[14px] font-semibold">保存小抄</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
            {c.saveTip}
          </p>
        </section>
      )}

      {/* 怎么知道自己做对了 */}
      {c.selfCheck && (
        <section className="card p-4">
          <h2 className="text-[14px] font-semibold">怎么知道自己做对了</h2>
          <p className="mt-1.5 text-[14px] leading-relaxed">{c.selfCheck}</p>
        </section>
      )}

      {/* 今天的收获 */}
      <section className="card p-4">
        <h2 className="text-[15px] font-semibold">今天的收获</h2>
        <p className="mt-0.5 text-[13px] text-[var(--color-ink-soft)]">{c.gain}</p>
        <textarea
          className="field mt-2 resize-y leading-relaxed"
          rows={3}
          placeholder="今天你做了什么？画了图吗？游戏能玩了吗？写下来吧。"
          value={gain}
          onChange={(e) => setGain(e.target.value)}
        />
      </section>

      {/* 今天我学到的一件事 */}
      <section className="card p-4">
        <h2 className="text-[15px] font-semibold">今天我学到的一件事</h2>
        <input
          className="field mt-2"
          placeholder="比如：原来 AI 做出来的东西也要自己再玩一遍才知道好不好"
          value={learned}
          onChange={(e) => setLearned(e.target.value)}
        />
      </section>

      {/* 自查清单 */}
      <ProjectChecklist
        projectKey={c.project === '项目一' ? 'star' : 'space'}
        checklist={checklist}
        onToggle={(no, v) =>
          setChecklist((prev) => {
            const next = { ...prev, [no]: v }
            void api.codingNote(date, gain, learned, next)
            return next
          })
        }
      />

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-[13px] text-emerald-600">已保存 ✓</span>}
        <button
          type="button"
          onClick={save}
          className="rounded-xl bg-[var(--color-coding)] px-5 py-2.5 text-[15px] font-medium text-white"
        >
          保存今天的记录
        </button>
      </div>
    </div>
  )
}

interface ChecklistProps {
  projectKey: string
  checklist: Record<string, boolean>
  onToggle: (no: string, value: boolean) => void
}

function ProjectChecklist({ projectKey, checklist, onToggle }: ChecklistProps) {
  const [items, setItems] = useState<Checklist[]>([])

  useEffect(() => {
    api
      .projects()
      .then((p) => {
        const proj = p[projectKey]
        setItems((proj?.checklist ?? []).map((c) => ({ item: c.item, how: c.how })))
      })
      .catch(() => {})
  }, [projectKey])

  if (!items.length) return null
  const done = items.filter((_, i) => checklist[String(i + 1)]).length

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">完成情况自查清单</h2>
        <span className="text-[13px] text-[var(--color-ink-soft)]">
          已完成 {done} / {items.length}
        </span>
      </div>
      <ul className="mt-2 space-y-2">
        {items.map((it, i) => {
          const no = String(i + 1)
          const checked = Boolean(checklist[no])
          return (
            <li key={no}>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggle(no, e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-coding)]"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('text-[14px]', checked && 'text-[var(--color-ink-soft)] line-through')}>
                    {it.item}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-[var(--color-ink-soft)]">
                    怎么检查：{it.how}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[12px] text-[var(--color-ink-soft)]">
        全部打勾之后，作业页会解锁参考实现，可以和 AI 做出来的版本对照一下。
      </p>
    </section>
  )
}
