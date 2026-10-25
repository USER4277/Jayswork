/**
 * 摄像头：画中画 + 录像 + 推流给爸爸手机。
 *
 * 关键约束：
 *  - getUserMedia 需要安全上下文（localhost 或 HTTPS），局域网 IP 下浏览器会禁用。
 *  - 推流用 WebSocket 转发 JPEG 帧（同一个局域网内不需要 WebRTC 打洞）。
 *  - 只在有观看者在线时才推帧，节省带宽；录像不受影响。
 */

export interface CameraHandle {
  stream: MediaStream
  stop: () => void
}

export interface PushHandle {
  send: (blob: Blob) => void
  close: () => void
}

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

/** 打开摄像头。必须在用户点击的同步调用栈里发起，否则不会弹授权框。 */
export async function openCamera(): Promise<CameraHandle> {
  if (!cameraSupported()) {
    throw new Error('这个浏览器不支持摄像头（需要用 Chrome 或 Edge，并从 localhost 打开）')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  })
  return {
    stream,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  }
}

/**
 * 把视频流画到 canvas 上压缩成 JPEG，按固定间隔推给服务器。
 */
export function startFramePush(
  video: HTMLVideoElement,
  socket: WebSocket,
  { width = 320, height = 240, quality = 0.5, fps = 3 } = {}
) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { stop: () => {} }

  let timer: number | undefined
  let stopped = false

  const tick = () => {
    if (stopped) return
    if (socket.readyState === WebSocket.OPEN && video.videoWidth > 0) {
      // 摄像头画面是镜像的，自己看着习惯
      ctx.save()
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      ctx.restore()
      canvas.toBlob(
        (blob) => {
          if (blob && socket.readyState === WebSocket.OPEN) socket.send(blob)
        },
        'image/jpeg',
        quality
      )
    }
  }

  timer = window.setInterval(tick, Math.round(1000 / fps))

  return {
    stop: () => {
      stopped = true
      if (timer) window.clearInterval(timer)
    },
  }
}

/**
 * 录像：MediaRecorder 分片上传，服务端合并成一个 webm 文件。
 */
export class Recorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private index = 0
  private sessionId: string
  private date: string
  private stopped = false

  constructor(sessionId: string, date: string) {
    this.sessionId = sessionId
    this.date = date
  }

  start(stream: MediaStream, onError?: (msg: string) => void) {
    try {
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
        (m) => MediaRecorder.isTypeSupported(m)
      )
      this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data)
          void this.flush(false)
        }
      }
      this.recorder.onerror = () => onError?.('录像出错了')
      this.recorder.start(3000)
    } catch (err) {
      onError?.('这个浏览器不能录像')
    }
  }

  private async flush(final: boolean) {
    if (!this.chunks.length) return
    const blob = new Blob(this.chunks, { type: 'video/webm' })
    this.chunks = []
    try {
      await fetch(
        `/api/watch/recordings/${encodeURIComponent(this.sessionId)}/chunk?date=${encodeURIComponent(
          this.date
        )}&index=${this.index++}${final ? '&final=1' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob,
        }
      )
    } catch {
      /* 网络断了就放弃这一片，录像不是关键路径 */
    }
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    const rec = this.recorder
    if (!rec) return
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      try {
        rec.stop()
      } catch {
        resolve()
      }
    })
    await this.flush(true)
    this.recorder = null
  }
}

/**
 * 连接到中转服务器。
 * role=child 推画面，role=parent 收画面。
 */
export function openWatchSocket(
  role: 'child' | 'parent',
  sessionId: string,
  handlers: {
    onFrame?: (blob: Blob) => void
    onStatus?: (msg: { childOnline: boolean }) => void
    onStreaming?: (on: boolean) => void
    onOpen?: () => void
    onClose?: () => void
  } = {}
): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/ws/watch?role=${role}&session=${encodeURIComponent(sessionId)}`
  const ws = new WebSocket(url)
  ws.binaryType = 'blob'

  ws.onopen = () => handlers.onOpen?.()
  ws.onclose = () => handlers.onClose?.()
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'status') handlers.onStatus?.(msg)
        if (msg.type === 'streaming') handlers.onStreaming?.(msg.on)
      } catch {
        /* 忽略 */
      }
    } else if (handlers.onFrame) {
      handlers.onFrame(ev.data as Blob)
    }
  }
  return ws
}
