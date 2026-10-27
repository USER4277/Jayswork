export interface CameraHandle {
  stream: MediaStream
  stop: () => void
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
 * 录像：MediaRecorder 分片上传，服务端合并成一个 webm 文件。
 */
export class Recorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private index = 0
  private sessionId: string
  private date: string
  private stopped = false
  private uploadToken: string
  private uploads: Promise<void> = Promise.resolve()
  private failure: Error | null = null
  private onError?: (message: string) => void

  constructor(sessionId: string, date: string, uploadToken: string) {
    this.sessionId = sessionId
    this.date = date
    this.uploadToken = uploadToken
  }

  start(stream: MediaStream, onError?: (msg: string) => void) {
      this.onError = onError
      if (typeof MediaRecorder === 'undefined') throw new Error('这个浏览器不能录像，请使用 Chrome 或 Edge')
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
      this.recorder.onerror = () => {
        this.failure = new Error('录像出错了，请结束录像后重试')
        onError?.(this.failure.message)
      }
      this.recorder.start(3000)
  }

  private flush(final: boolean) {
    if (!this.chunks.length && !final) return
    const blob = new Blob(this.chunks, { type: 'video/webm' })
    this.chunks = []
    const index = this.index++
    this.uploads = this.uploads.then(async () => {
      if (this.failure) return
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(
        `/api/watch/recordings/${encodeURIComponent(this.sessionId)}/chunk?date=${encodeURIComponent(
          this.date
        )}&index=${index}${final ? '&final=1' : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${this.uploadToken}` },
          body: blob,
          signal: AbortSignal.timeout(15000),
        }
      )
          if (response.ok) return
          const detail = await response.json().catch(() => ({}))
          if (response.status === 409 && detail.expectedIndex === index + 1) return
          throw new Error(detail.error || '录像保存失败')
        } catch (error) {
          if (attempt === 2) throw error
        }
      }
    }).catch((error: unknown) => {
      this.failure = error instanceof Error ? error : new Error('录像保存失败')
      this.onError?.('录像未完整保存，请结束录像并检查本机服务。')
    })
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
    this.flush(true)
    await this.uploads
    this.recorder = null
    if (this.failure) throw this.failure
  }
}
