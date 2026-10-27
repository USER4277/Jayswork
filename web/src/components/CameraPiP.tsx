import { useCallback, useEffect, useRef, useState } from 'react'
import { openCamera, Recorder } from '../lib/camera'
import { onStartSession, onHomeworkProgress, homeworkCompleted } from '../lib/session'
import { api } from '../lib/api'
import { cn } from '../lib/format'
import { useMonitoring } from '../lib/monitoring'

export default function CameraPiP() {
  const { monitoring } = useMonitoring()
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startingRef = useRef(false)
  const recordingDateRef = useRef<string | null>(null)
  const stopPromiseRef = useRef<Promise<void> | null>(null)

  const [active, setActive] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const stopEverything = useCallback(() => {
    if (stopPromiseRef.current) return stopPromiseRef.current
    recordingDateRef.current = null
    setStopping(true)
    const finishing = (async () => {
      try {
        await recorderRef.current?.stop()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : '录像未完整保存')
      } finally {
        recorderRef.current = null
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setActive(false)
        setMinimized(false)
        setSessionId(null)
        setStopping(false)
        stopPromiseRef.current = null
      }
    })()
    stopPromiseRef.current = finishing
    return finishing
  }, [])

  const checkCompletion = useCallback(async (date: string) => {
    if (recordingDateRef.current !== date) return
    try {
      const overview = await api.today(date)
      if (recordingDateRef.current === date && overview.date === date && homeworkCompleted(overview)) await stopEverything()
    } catch {
      setError('暂时无法确认作业完成状态，录像仍在继续；可手动结束录像并保存。')
    }
  }, [stopEverything])

  const start = useCallback(
    async (date: string) => {
      if (startingRef.current || streamRef.current || stopPromiseRef.current) return
      startingRef.current = true
      setError('')
      try {
        const settings = await api.settings()
        if (!settings.monitoring) return
        const handle = await openCamera()
        streamRef.current = handle.stream

        const { sessionId: sid, uploadToken } = await api.startSession(date)
        setSessionId(sid)

        const recorder = new Recorder(sid, date, uploadToken)
        recorder.start(handle.stream, (msg) => setError(msg))
        recorderRef.current = recorder
        recordingDateRef.current = date

        setActive(true)
        setMinimized(false)
      } catch (err) {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setSessionId(null)
        setError(
          err instanceof Error
            ? err.message
            : '摄像头没能打开，可以先继续做题，再让家长帮忙打开监控。'
        )
      } finally { startingRef.current = false }
    },
    []
  )

  useEffect(() => onStartSession((date) => void start(date)), [start])
  useEffect(() => onHomeworkProgress((date) => void checkCompletion(date)), [checkCompletion])
  useEffect(() => {
    if (active && recordingDateRef.current) void checkCompletion(recordingDateRef.current)
  }, [active, checkCompletion])
  useEffect(() => () => void stopEverything(), [stopEverything])
  useEffect(() => {
    if (active && !monitoring) void stopEverything()
  }, [active, monitoring, stopEverything])
  useEffect(() => {
    if (!active || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    void videoRef.current.play().catch(() => setError('画面播放失败，请结束录像后重试'))
  }, [active])
  useEffect(() => {
    if (!active) return
    const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', confirmLeave)
    return () => window.removeEventListener('beforeunload', confirmLeave)
  }, [active])

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
              <span className="flex-1">{stopping ? '正在保存录像…' : '本机录像中'}</span>
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
                disabled={stopping}
                className="rounded px-1 hover:bg-white/20"
                aria-label="结束录像并保存"
                title="结束录像并保存"
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
          title="本机录像中，点击展开"
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
                <p className="font-medium">摄像头或录像提示</p>
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
          本机录像 {sessionId} 进行中
        </span>
      )}
    </>
  )
}
