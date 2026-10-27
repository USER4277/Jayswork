import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { DayContent } from '../types'
import { formatDate } from '../lib/format'
import { Check, Gamepad2 } from 'lucide-react'
import SpeechButton from '../components/SpeechButton'
import SubjectFlow from '../components/SubjectFlow'

export default function CodingPage() {
  const { date = '' } = useParams()
  const [day, setDay] = useState<DayContent | null>(null)
  const [saving, setSaving] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [references, setReferences] = useState<{ project: string; title: string; unlocked: boolean; url: string }[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .day(date)
      .then((content) => { setDay(content); setCompleted(content.progress.some((progress) => progress.subject === 'coding' && progress.status === 'submitted')) })
      .catch((err) => setError(err.message))
    api.references().then((value) => setReferences(value.items)).catch(() => {})
  }, [date])

  const complete = async () => {
    setSaving(true)
    setError('')
    try {
      await api.codingComplete(date)
      setCompleted(true)
      setReferences((await api.references()).items)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '提交失败，请重试') }
    finally { setSaving(false) }
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
  const features = c.features || []
  const playtest = c.playtest || c.selfCheck
  const taskSpeech = [`今天的目标：${c.goal}`, ...features, `今天的试玩里程碑：${playtest}`].join('\n')

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

      <section className="space-y-3 border-l-4 border-[var(--color-coding)] pl-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">今天的目标</h2>
          <SpeechButton text={taskSpeech} label="听今天的任务" large />
        </div>
        <p className="leading-relaxed">{c.goal}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">今天的功能</h2>
        <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {features.map((feature, index) => <li key={index} className="flex items-start gap-3 py-4"><Gamepad2 className="mt-1 h-5 w-5 shrink-0 text-[var(--color-coding)]" aria-hidden="true" /><p className="min-w-0 leading-relaxed">{feature}</p></li>)}
        </ul>
      </section>
      <section className="space-y-2"><h2 className="text-lg font-semibold">今天的试玩里程碑</h2><p className="leading-relaxed">{playtest}</p></section>

      {references.filter((reference) => reference.project === (c.project === '项目一' ? 'star' : 'space')).map((reference) => <section key={reference.project} className="border-t border-[var(--color-line)] pt-4"><h2 className="text-sm font-semibold">参考实现 · {reference.title}</h2>{reference.unlocked ? <div className="mt-2 flex gap-4 text-sm underline"><a href={reference.url} target="_blank" rel="noreferrer">打开游戏</a><a href={reference.url} download={`${reference.title}.html`}>下载参考实现</a></div> : <p className="mt-2 text-sm text-[var(--color-ink-soft)]">完成这个项目的 7 天编程作业后解锁。</p>}</section>)}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {completed && <div className="space-y-2"><p className="text-sm text-emerald-700">今天的编程作业已提交。</p><SubjectFlow day={day} date={date} subject="coding" /></div>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button type="button" onClick={complete} disabled={saving || completed} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-coding)] px-5 py-3 font-medium text-white disabled:opacity-50"><Check className="h-5 w-5" aria-hidden="true" />{saving ? '保存中…' : completed ? '今天的版本已完成' : '我做出的版本能玩了'}</button>
      </div>
    </div>
  )
}
