import { useEffect, useRef, useState } from 'react'
import { openWatchSocket } from '../lib/camera'
import { api } from '../lib/api'
import { cn } from '../lib/format'

/**
 * 爸爸手机的观看页。
 *
 * 孩子端把摄像头画面压成 JPEG 帧推过来，这里收到就显示。
 * 需要家长 PIN，避免孩子自己把监控关掉。
 */
export default function WatchPage() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState('')
  const [childOnline, setChildOnline] = useState(false)
  const [lastFrame, setLastFrame] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const verify = async () => {
    setError('')
    try {
      const r = await api.parentLogin(pin)
      if (r.ok) setUnlocked(true)
      else setError('PIN 不对，再试一次')
    } catch {
      setError('连不上服务，检查一下服务是不是开着')
    }
  }

  useEffect(() => {
    if (!unlocked) return
    const socket = openWatchSocket('parent', 'default', {
      onFrame: (blob) => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        const url = URL.createObjectURL(blob)
        objectUrlRef.current = url
        setLastFrame(url)
      },
      onStatus: (s) => setChildOnline(s.childOnline),
    })
    socketRef.current = socket
    return () => {
      socket.close()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [unlocked])

  if (!unlocked) {
    return (
      <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-5 py-10">
        <h1 className="text-lg font-semibold">监控观看</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          请输入家长 PIN
        </p>
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

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col px-4 py-5">
      <header className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">孩子的作业画面</h1>
        <span
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]',
            childOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-600'
          )}
        >
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              childOnline ? 'animate-pulse bg-emerald-500' : 'bg-neutral-400'
            )}
          />
          {childOnline ? '孩子的设备在线' : '等待孩子开始'}
        </span>
      </header>

      <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-black">
        {lastFrame ? (
          <img
            ref={imgRef}
            src={lastFrame}
            alt="孩子的作业画面"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-neutral-400">
            {childOnline
              ? '正在等待画面…'
              : '孩子点「开始今日作业」之后，这里就能看到画面了。'}
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-[12px] text-[var(--color-ink-soft)]">
        画面只在家里这台设备和你的手机之间传递，不会上传到任何地方。
      </p>
    </div>
  )
}
