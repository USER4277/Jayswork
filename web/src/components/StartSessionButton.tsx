import { useState } from 'react'
import { announceStart, announceCompleted, START_ANNOUNCEMENT, COMPLETED_ANNOUNCEMENT } from '../lib/announce'
import { emitStartSession, startHomeworkSession, emitHomeworkProgress } from '../lib/session'
import { useNavigate } from 'react-router-dom'
import { useMonitoring } from '../lib/monitoring'

interface Props {
  date: string
  className?: string
  label?: string
  to?: string
  completed?: boolean
}

/**
 * 「开始今日作业」按钮。
 *
 * 点下去会做三件事：
 *  1. 语音播报监控提示（必须在点击的同步栈里触发，否则浏览器不让出声）
 *  2. 在页面上把这段话大字显示出来
 *  3. 通知摄像头浮层打开摄像头、开始录像
 */
export default function StartSessionButton({ date, className, label = '开始今日作业', to, completed = false }: Props) {
  const [notice, setNotice] = useState('')
  const navigate = useNavigate()
  const { monitoring } = useMonitoring()

  const start = () => {
    window.setTimeout(() => setNotice(''), 8000)
    if (completed) {
      announceCompleted()
      setNotice(COMPLETED_ANNOUNCEMENT)
      emitHomeworkProgress(date)
      return
    }
    startHomeworkSession(date)
    // 语音要在用户手势里发起
    if (monitoring) {
      announceStart()
      emitStartSession(date)
      setNotice(START_ANNOUNCEMENT)
    }
    if (to) navigate(to)
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className={
          className ??
          'inline-flex items-center gap-2 rounded-xl bg-[var(--color-math)] px-5 py-3 text-[15px] font-medium text-white shadow-sm transition-colors hover:bg-[oklch(0.52_0.16_258)]'
        }
      >
        <span aria-hidden>🎬</span>
        {label}
      </button>

      {notice && (
        <div className="fixed inset-x-0 top-16 z-50 mx-auto max-w-xl px-4">
          <div className="rounded-xl border border-[var(--color-line)] bg-white/95 p-4 shadow-lg backdrop-blur">
            <div className="flex items-start gap-3">
              <span aria-hidden className="text-2xl">
                📢
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium leading-relaxed text-[var(--color-ink)]">
                  {notice}
                </p>
                <button
                  type="button"
                  onClick={() => setNotice('')}
                  className="mt-2 text-[12px] text-[var(--color-ink-soft)] underline"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
