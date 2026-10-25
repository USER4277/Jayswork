import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/format'
import CameraPiP from './CameraPiP'
import { MonitoringContext } from '../lib/monitoring'

const NAV = [
  { to: '/', label: '今日作业', end: true },
  { to: '/wrong', label: '错题本' },
  { to: '/learn', label: '学习中心' },
  { to: '/report', label: '学习报告' },
  { to: '/parent', label: '家长' },
]

export default function Layout() {
  const [aiOn, setAiOn] = useState<boolean | null>(null)
  const location = useLocation()

  useEffect(() => {
    api.aiStatus().then((r) => setAiOn(r.enabled)).catch(() => setAiOn(false))
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <MonitoringContext.Provider value={{ aiOn }}>
      <div className="min-h-full flex flex-col">
        <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-semibold tracking-tight">曹昌洵专属教育系统</span>
              {aiOn === false && (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700"
                  title="没有配置 MINIMAX_API_KEY，开放题暂时用本地参考答案"
                >
                  AI 未连接
                </span>
              )}
            </div>
            <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                      isActive
                        ? 'bg-[var(--color-math-soft)] font-medium text-[var(--color-math)]'
                        : 'text-[var(--color-ink-soft)] hover:bg-neutral-100'
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
          <Outlet />
        </main>

        <footer className="border-t border-[var(--color-line)] py-4 text-center text-[12px] text-[var(--color-ink-soft)]">
          作业内容来自《小学 14 天作业本》 · 本地运行，不上传任何内容
        </footer>

        <CameraPiP />
      </div>
    </MonitoringContext.Provider>
  )
}
