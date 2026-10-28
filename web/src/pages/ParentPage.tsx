import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cn, formatDate } from '../lib/format'
import ParentRazPanel from '../components/ParentRazPanel'

interface AnswerDay {
  day: number
  math: {
    key: string
    title: string
    questions: { no: number; prompt: string; reference: string }[]
  }[]
  chinese: { title: string; questions: { no: number; prompt: string; reference: string }[] } | null
}

export default function ParentPage() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState('')

  const verify = async () => {
    setError('')
    try {
      const r = await api.parentLogin(pin)
      if (r.ok) setUnlocked(true)
      else setError('PIN 不对，再试一次')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '连不上服务')
    }
  }

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-sm px-5 py-10">
        <h1 className="text-lg font-semibold">家长区</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">请输入家长 PIN</p>
        <input
          className="field mt-4 text-center text-lg tracking-[0.4em]"
          inputMode="numeric"
          type="password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && verify()}
          placeholder="••••"
        />
        {error && <p className="mt-2 text-[13px] text-amber-600">{error}</p>}
        <button
          type="button"
          onClick={verify}
          className="mt-4 rounded-xl bg-[var(--color-math)] px-5 py-2.5 text-[15px] font-medium text-white"
        >
          进入
        </button>
      </div>
    )
  }

  return <ParentContent onLock={() => { void api.parentLogout().then(() => setUnlocked(false)).catch(() => setUnlocked(false)) }} />
}

function ParentContent({ onLock }: { onLock: () => void }) {
  const [tab, setTab] = useState<'answers' | 'progress' | 'recordings' | 'settings' | 'english-test'>('answers')
  const [answers, setAnswers] = useState<AnswerDay[]>([])
  const [overview, setOverview] = useState<
    { date: string; subject: string; status: string; score: number; total: number }[]
  >([])
  const [recordings, setRecordings] = useState<
    { file: string; date: string; size: number; mtime: string }[]
  >([])
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [day, setDay] = useState(1)
  const [error, setError] = useState('')

  useEffect(() => {
    api.parentAnswers().then(setAnswers).catch((failure: Error) => setError(failure.message))
    fetch('/api/parent/overview')
      .then((response) => { if (!response.ok) throw new Error('请重新登录家长区'); return response.json() })
      .then(setOverview)
      .catch((failure: Error) => setError(failure.message))
    api.recordings().then((r) => setRecordings(r.items)).catch((failure: Error) => setError(failure.message))
    api.parentSettings().then(setSettings).catch((failure: Error) => setError(failure.message))
  }, [])

  const saveSetting = async (patch: Record<string, unknown>) => {
    await api.parentSettingsSave(patch)
    const next = await api.parentSettings()
    setSettings(next)
  }

  const current = answers.find((a) => a.day === day)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">家长区</h1>
        <button type="button" onClick={onLock} className="text-[13px] underline">
          锁定
        </button>
      </header>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <nav className="flex gap-1">
        {(
          [
            ['answers', '参考答案'],
            ['progress', '完成情况'],
            ['recordings', '录像'],
            ['settings', '设置'],
            ['english-test', '英语测试'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[13px] transition-colors',
              tab === key
                ? 'bg-[var(--color-math-soft)] font-medium text-[var(--color-math)]'
                : 'text-[var(--color-ink-soft)] hover:bg-neutral-100'
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'english-test' && <ParentRazPanel />}

      {tab === 'answers' && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-[13px] text-[var(--color-ink-soft)]">选择第几天</label>
            <select
              className="field w-28"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              {answers.map((a) => (
                <option key={a.day} value={a.day}>
                  第 {a.day} 天
                </option>
              ))}
            </select>
          </div>

          {current?.math.map((g) => (
            <div key={g.key} className="card p-4">
              <h3 className="text-[14px] font-semibold">{g.title}</h3>
              <ol className="mt-2 space-y-2">
                {g.questions.map((q) => (
                  <li key={q.no} className="text-[13px] leading-relaxed">
                    <span className="font-medium">{q.no}. </span>
                    <span>{q.prompt}</span>
                    {q.reference && (
                      <span className="mt-0.5 block text-[var(--color-ink-soft)]">
                        答案：{q.reference}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {current?.chinese && (
            <div className="card p-4">
              <h3 className="text-[14px] font-semibold">语文 · {current.chinese.title}</h3>
              <ol className="mt-2 space-y-2">
                {current.chinese.questions.map((q) => (
                  <li key={q.no} className="text-[13px] leading-relaxed">
                    <span className="font-medium">
                      问题 {q.no}：{q.prompt}
                    </span>
                    {q.reference && (
                      <span className="mt-0.5 block text-[var(--color-ink-soft)]">
                        参考答案：{q.reference}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {tab === 'progress' && <WeeklySummary />}
      {tab === 'progress' && (
        <section className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-[var(--color-paper)] text-left">
              <tr>
                <th className="px-3 py-2 font-medium">日期</th>
                <th className="px-3 py-2 font-medium">科目</th>
                <th className="px-3 py-2 font-medium">得分</th>
                <th className="px-3 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {overview.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[var(--color-ink-soft)]">
                    还没有做过作业
                  </td>
                </tr>
              )}
              {overview.map((r, i) => (
                <tr key={i} className="border-t border-[var(--color-line)]">
                  <td className="px-3 py-2">{formatDate(r.date)}</td>
                  <td className="px-3 py-2">{r.subject}</td>
                  <td className="px-3 py-2">{r.score ?? '—'}</td>
                  <td className="px-3 py-2">{r.status === 'submitted' ? '已完成' : '进行中'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'recordings' && (
        <section className="space-y-3">
          <p className="text-[13px] text-[var(--color-ink-soft)]">
            每次「开始今日作业」之后录的视频，存在这台电脑上，不会上传到任何地方。
          </p>
          {recordings.length === 0 && (
            <div className="card p-6 text-center text-[13px] text-[var(--color-ink-soft)]">
              还没有录像
            </div>
          )}
          {recordings.map((r) => (
            <div key={r.file} className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{formatDate(r.date)} 的录像</p>
                  <p className="text-[12px] text-[var(--color-ink-soft)]">
                    {new Date(r.mtime).toLocaleString('zh-CN')} ·{' '}
                    {(r.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <a
                  href={`/api/parent/recordings/${r.file}`}
                  download
                  className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[13px]"
                >
                  下载
                </a>
              </div>
              <video
                controls
                className="mt-3 w-full rounded-lg bg-black"
                src={`/api/parent/recordings/${r.file}`}
              />
            </div>
          ))}
        </section>
      )}

      {tab === 'settings' && <Settings settings={settings} onSave={saveSetting} />}
    </div>
  )
}

function Settings({
  settings,
  onSave,
}: {
  settings: Record<string, unknown>
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [deadline, setDeadline] = useState(String(settings.deadline ?? ''))
  const [pin, setPin] = useState('')
  const [monitoring, setMonitoring] = useState(
    settings.monitoring !== false && settings.monitoring !== false
  )
  const [referenceUnlocked, setReferenceUnlocked] = useState(
    Boolean(settings.referenceUnlocked)
  )
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDeadline(String(settings.deadline ?? ''))
    setMonitoring(settings.monitoring !== false)
    setReferenceUnlocked(Boolean(settings.referenceUnlocked))
  }, [settings])

  const save = async () => {
    const patch: Record<string, unknown> = { deadline, monitoring, referenceUnlocked }
    if (pin) patch.pin = pin
    setError('')
    setSaving(true)
    try {
      await onSave(patch)
      setPin('')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
    finally { setSaving(false) }
  }

  return (
    <section className="space-y-4">
      <div className="card space-y-3 p-4">
        <label className="block text-[13px]">
          <span className="text-[var(--color-ink-soft)]">每日提醒截止时间</span>
          <input
            className="field mt-1 w-40"
            type="time"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={monitoring}
            onChange={(e) => setMonitoring(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-math)]"
          />
          <span>开启本机录像（开始作业时打开摄像头，录像保存在这台电脑）</span>
        </label>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={referenceUnlocked}
            onChange={(e) => setReferenceUnlocked(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-math)]"
          />
          <span>解锁参考实现（默认要等孩子做完 7 天才能对照）</span>
        </label>

        <label className="block text-[13px]">
          <span className="text-[var(--color-ink-soft)]">修改家长 PIN（留空表示不改）</span>
          <input
            className="field mt-1 w-40"
            inputMode="numeric"
            type="password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-[var(--color-math)] px-4 py-2 text-[14px] font-medium text-white"
          >
            保存设置
          </button>
          {saved && <span className="text-[13px] text-emerald-600">已保存 ✓</span>}
          {error && <span role="alert" className="text-[13px] text-red-600">{error}</span>}
        </div>
      </div>

      <div className="card p-4 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
        <p className="mb-1 font-medium text-[var(--color-ink)]">本机录像</p>
        <p>摄像头只用于本机预览和录像，不连接远程观看端。结束前请点击摄像头画面上的结束按钮，等待录像保存后再关闭页面。</p>
      </div>
    </section>
  )
}

function WeeklySummary() {
  const [cycle, setCycle] = useState(1)
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setSummary(null)
    fetch(`/api/review/summary/${cycle}`).then((response) => response.json()).then((value) => { if (!cancelled) setSummary(value.summary) }).catch(() => {})
    return () => { cancelled = true }
  }, [cycle])
  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/ai/weekly-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cycle }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '小结生成失败')
      setSummary(value)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '生成失败') }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 border-y border-[var(--color-line)] py-4"><div className="flex flex-wrap items-center gap-3"><h2 className="text-sm font-semibold">每周学习小结</h2><select aria-label="小结周期" className="field w-28" value={cycle} onChange={(event) => setCycle(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>第 {value} 周</option>)}</select><button type="button" onClick={generate} disabled={busy} className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm">{busy ? '生成中…' : '生成 AI 小结'}</button></div>{error && <p role="alert" className="text-sm text-amber-700">{error}</p>}{summary && <dl className="space-y-2 text-sm">{Object.entries(summary).map(([key, value]) => <div key={key}><dt className="font-medium">{key}</dt><dd className="mt-1 whitespace-pre-wrap leading-relaxed">{typeof value === 'string' ? value : Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : JSON.stringify(value)}</dd></div>)}</dl>}</section>
}
