import { useCallback, useEffect, useRef, useState } from 'react'
import { openCamera, openWatchSocket, Recorder, startFramePush } from '../lib/camera'
import { onStartSession } from '../lib/session'
import { api } from '../lib/api'
import { cn } from '../lib/format'

/**
 * 摄像头浮层：右上角显示实时画面，同时录像并把画面推给爸爸手机。
 *
 * 页面常驻一个「监控进行中」的指示 —— 这不是偷偷摸摸的功能，
 * 开始作业时孩子已经被语音告知过了，界面上也要看得见。
 */
export default function CameraPiP() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const pushRef = useRef<{ stop: () => void } | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [active, setActive] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [error, setError] = useState('')
  const [watching, setWatching] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const stopEverything = useCallback(async () => {
    pushRef.current?.stop()
    pushRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    await recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
    setWatching(false)
  }, [])

  const start = useCallback(
    async (date: string) => {
      setError('')
      try {
        const handle = await openCamera()
        streamRef.current = handle.stream
        if (videoRef.current) {
          videoRef.current.srcObject = handle.stream
          await videoRef.current.play().catch(() => {})
        }

        const { sessionId: sid } = await api.startSession(date)
        setSessionId(sid)

        const recorder = new Recorder(sid, date)
        recorder.start(handle.stream, (msg) => setError(msg))
        recorderRef.current = recorder

        const socket = openWatchSocket('child', sid, {
          onStreaming: (on) => setWatching(on),
          onClose: () => setWatching(false),
        })
        socketRef.current = socket

        // 等 socket 打开再开始推帧
        const waitOpen = () =>
          new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.OPEN) return resolve()
            socket.addEventListener('open', () => resolve(), { once: true })
            setTimeout(resolve, 1500)
          })
        await waitOpen()
        if (videoRef.current) {
          pushRef.current = startFramePush(videoRef.current, socket)
        }

        setActive(true)
        setMinimized(false)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : '摄像头没能打开，可以先继续做题，再让家长帮忙打开监控。'
        )
      }
    },
    []
  )

  useEffect(() => onStartSession((date) => void start(date)), [start])
  useEffect(() => () => void stopEverything(), [stopEverything])

  if (!active && !error) return null

  return (
    <>
      {/* 右上角画中画 */}
      {active && (
        <div
          className={cn(
            'fixed right-3 z-40 overflow-hidden rounded-xl border-2 border-red-400 bg-black shadow-lg',
            minimized ? 'top-3 h-9 w-9' : 'top-3 w-64'
          )}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className={cn('w-full', minimized ? 'h-full object-cover' : 'aspect-[4/3] object-cover')}
          />
          {!minimized && (
            <div className="flex items-center gap-1 bg-black/70 px-2 py-1 text-[11px] text-white">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="flex-1">监控进行中</span>
              {watching && <span title="爸爸手机正在看">👁️</span>}
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="rounded px-1 hover:bg-white/20"
                aria-label="最小化"
              >
                －
              </button>
              <button
                type="button"
                onClick={() => void stopEverything()}
                className="rounded px-1 hover:bg-white/20"
                aria-label="关闭监控"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="fixed right-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-full border-2 border-red-400 bg-black text-white shadow-lg"
          aria-label="展开监控画面"
          title="监控进行中"
        >
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
        </button>
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 z-40 w-[min(92vw,28rem)] -translate-x-1/2">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900 shadow-lg">
            <div className="flex items-start gap-2">
              <span aria-hidden>⚠️</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">监控没能打开</p>
                <p className="mt-0.5 leading-relaxed">{error}</p>
                <p className="mt-1 text-[12px] text-amber-700">
                  提示：摄像头需要用 localhost 打开，并且要允许浏览器使用摄像头。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setError('')}
                className="shrink-0 rounded px-1 text-amber-700 hover:bg-amber-100"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionId && (
        <span className="sr-only" aria-live="polite">
          监控会话 {sessionId} 进行中
        </span>
      )}
    </>
  )
}
