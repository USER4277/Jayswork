import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Play, RotateCcw, Save } from 'lucide-react'
import { parentRaz } from '../lib/api'

type Info = Awaited<ReturnType<typeof parentRaz.info>>

export default function ParentRazPanel() {
  const navigate = useNavigate()
  const [info, setInfo] = useState<Info | null>(null)
  const [level, setLevel] = useState('')
  const [minutes, setMinutes] = useState(20)
  const [date, setDate] = useState('')
  const [testLevel, setTestLevel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    Promise.all([parentRaz.info(), parentRaz.dates()]).then(([value, dates]) => {
      if (!active) return
      setInfo(value)
      setLevel(value.profile.level || '')
      setMinutes(value.profile.targetMinutes)
      const today = new Date().toLocaleDateString('sv-SE')
      setDate(dates.items.find(item => item.date >= today)?.date || dates.items[0]?.date || '')
    }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请重试') }
    finally { setBusy(false) }
  }
  const save = async (selected = level) => {
    const profile = await parentRaz.profile(selected, minutes)
    setInfo(previous => previous ? { ...previous, profile } : previous)
    setLevel(profile.level || '')
    setNotice(`已保存 Level ${profile.level} · 每次约 ${profile.targetMinutes} 分钟；已生成课程保留原进度`)
  }
  return <section className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-4"><h2 className="text-lg font-semibold">RAZ 英语课程</h2><button type="button" disabled={busy} className="inline-flex items-center gap-2 text-sm disabled:opacity-40" onClick={() => void run(async () => { await parentRaz.rescan(); setInfo(await parentRaz.info()); setNotice('资源检查完成') })}><RotateCcw className="h-4 w-4" />检查资源</button></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {!info ? <p>正在读取本地书库…</p> : <>
      <section className="space-y-3"><h3 className="font-semibold">本地书库</h3><p className="text-sm">{info.available ? `${info.levels.length} 个级别 · ${info.ready} 本已配对音频 · ${info.issues.length} 本待检查` : '资源目录不可用'}</p><p className="break-all text-xs text-[var(--color-ink-soft)]">{info.resourceRoot}</p>
        <details><summary className="cursor-pointer text-sm">分级书目与资源问题</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--color-line)]"><th className="py-2">级别</th><th>候选绘本</th><th>配对音频</th></tr></thead><tbody>{info.levels.map(item => <tr key={item.level} className="border-b border-[var(--color-line)]"><td className="py-2">{item.level}</td><td>{item.total}</td><td>{item.ready}</td></tr>)}</tbody></table></div>{info.issues.length > 0 && <ul className="mt-4 space-y-2 text-xs text-amber-700">{info.issues.map(item => <li key={`${item.level}-${item.title}`}>{item.level} · {item.title}：{item.reason}</li>)}</ul>}</details>
      </section>
      <section className="space-y-4 border-t border-[var(--color-line)] pt-5"><h3 className="font-semibold">正式课程</h3><p className="text-sm text-[var(--color-ink-soft)]">{info.profile.level ? `当前 Level ${info.profile.level} · 已完成 ${info.profile.masteredBooks} 本有首答成绩的读物` : '尚未测级'}</p><div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm"><span className="block">起始级别</span><select aria-label="正式英语级别" className="field min-w-36" value={level} disabled={busy} onChange={event => setLevel(event.target.value)}><option value="">先进行测级</option>{info.levels.filter(item => item.ready > 0).map(item => <option key={item.level} value={item.level}>Level {item.level}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block">每次学习分钟数</span><input aria-label="每次学习分钟数" className="field w-32" type="number" min={10} max={40} step={5} value={minutes} disabled={busy} onChange={event => setMinutes(Number(event.target.value))} /></label>
        <button type="button" disabled={busy || !level} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-english)] px-4 py-2 text-white disabled:opacity-40" onClick={() => void run(() => save())}><Save className="h-4 w-4" />保存课程设置</button>
      </div><div className="flex flex-wrap gap-5 text-sm"><p>首次理解：{info.profile.firstAccuracy === null ? '暂无' : `${Math.round(info.profile.firstAccuracy)}%`}</p><p>延迟复习：{info.profile.reviewAccuracy === null ? '暂无' : `${Math.round(info.profile.reviewAccuracy)}%`}</p></div>{info.profile.recommendedLevel && <button type="button" disabled={busy} onClick={() => void run(() => save(info.profile.recommendedLevel!))} className="inline-flex items-center gap-2 text-sm text-emerald-700"><ArrowUpRight className="h-4 w-4" />确认升级至 Level {info.profile.recommendedLevel}</button>}</section>
      <section className="space-y-4 border-t border-[var(--color-line)] pt-5"><div className="flex items-center gap-3"><h3 className="font-semibold">英语测试</h3><span className="text-sm text-amber-700">独立数据</span></div><div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm"><span className="block">测试日期</span><input type="date" aria-label="英语测试日期" value={date} onChange={event => setDate(event.target.value)} className="field" disabled={busy} /></label>
        <label className="space-y-1 text-sm"><span className="block">测试起点</span><select aria-label="英语测试级别" value={testLevel} onChange={event => setTestLevel(event.target.value)} className="field" disabled={busy}><option value="">先测级／延续测试进度</option>{info.levels.filter(item => item.ready > 0).map(item => <option key={item.level} value={item.level}>Level {item.level}</option>)}</select></label>
        <button type="button" disabled={busy || !date} onClick={() => void run(async () => { if (testLevel) await parentRaz.testProfile(testLevel, minutes); navigate(`/parent/english-test/${date}`) })} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-english)] px-4 py-2 text-white disabled:opacity-40"><Play className="h-4 w-4" />开始测试</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm('清空全部 RAZ 测试课程、测级和复习记录？正式学习数据不受影响。')) void run(async () => { await parentRaz.reset(); setNotice('RAZ 测试课程已重置') }) }} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-4 py-2 disabled:opacity-40"><RotateCcw className="h-4 w-4" />重置测试</button>
      </div></section>
    </>}
  </section>
}