import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/format'
import CameraPiP from './CameraPiP'
import { MonitoringContext } from '../lib/monitoring'
import { BookOpen, CalendarCheck, ChartColumn, LibraryBig, Moon, NotebookPen, Settings, Sun } from 'lucide-react'

const NAV = [
  { to: '/', label: '今日作业', icon: CalendarCheck, end: true },
  { to: '/wrong', label: '错题本', icon: NotebookPen },
  { to: '/learn', label: '学习中心', icon: LibraryBig },
  { to: '/report', label: '学习报告', icon: ChartColumn },
  { to: '/parent', label: '家长', icon: Settings },
]

export default function Layout() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [aiOn, setAiOn] = useState<boolean | null>(null)
  const [settings, setSettings] = useState({ monitoring: false, deadline: '', speechScoring: false })
  const [clock, setClock] = useState(() => new Date())
  const location = useLocation()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151b19' : '#f8fafc')
    try { localStorage.setItem('jayswork:theme', theme) } catch {}
  }, [theme])

  useEffect(() => {
    api.aiStatus().then((r) => setAiOn(r.enabled)).catch(() => setAiOn(false))
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
    const updateSettings = () => { void api.settings().then(setSettings).catch(() => {}) }
    updateSettings()
    window.addEventListener('jayswork:settings', updateSettings)
    return () => window.removeEventListener('jayswork:settings', updateSettings)
  }, [location.pathname])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const time = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
  const homeworkPage = /^\/(math|chinese|english|coding)\//.test(location.pathname)

  return (
    <MonitoringContext.Provider value={{ aiOn, ...settings }}>
      <div className={cn('min-h-full flex flex-col', !location.pathname.startsWith('/parent') && 'child-interface')}>
        <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="flex min-w-0 flex-wrap items-baseline gap-2">
              <BookOpen className="h-6 w-6 self-center text-[var(--color-coding)]" aria-hidden="true" />
              <span className="text-[15px] font-semibold">曹昌洵的学习时光</span>
              {aiOn === false && (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700"
                  title="语文有离线参考讲解；数学计算过程仍需 AI 核对"
                >
                  AI 未连接
                </span>
              )}
            </div>
            <button type="button" onClick={() => setTheme((previous) => previous === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'} title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'} className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--color-line)]">
              {theme === 'dark' ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
            </button>
            <nav aria-label="主要导航" className="grid w-full grid-cols-5 gap-1 sm:ml-auto sm:flex sm:w-auto">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-2 text-[12px] transition-colors sm:flex-row sm:gap-2 sm:px-3',
                      isActive
                        ? 'bg-[var(--color-math-soft)] font-medium text-[var(--color-math)]'
                        : 'text-[var(--color-ink-soft)] hover:bg-neutral-100'
                    )
                  }
                >
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
          {homeworkPage && settings.deadline && <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{time >= settings.deadline ? `已过 ${settings.deadline}，请完成当前题目后休息。` : `今天的作业提醒时间：${settings.deadline}`}</p>}
          <Outlet />
        </main>

        <footer className="border-t border-[var(--color-line)] py-4 text-center text-[12px] text-[var(--color-ink-soft)]">
          作业本与本地 RAZ 资源 · 录像仅存本机 · 启用 AI 时会发送相关作业文字用于批改
        </footer>

        <CameraPiP />
      </div>
    </MonitoringContext.Provider>
  )
}
