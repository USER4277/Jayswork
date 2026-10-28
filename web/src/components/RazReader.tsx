import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'

GlobalWorkerOptions.workerSrc = workerUrl

interface Props { src: string; title: string; start?: number; end?: number; initialPage?: number; onViewed?: (page: number) => void }

export default function RazReader({ src, title, start = 1, end, initialPage, onViewed }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(start)
  const [width, setWidth] = useState(640)
  const [zoom, setZoom] = useState(1)
  const [size, setSize] = useState({ width: 640, height: 500 })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewed = useRef(onViewed)
  useEffect(() => { viewed.current = onViewed }, [onViewed])
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, Math.floor(entries[0].contentRect.width))))
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    setDocument(null)
    setError('')
    setLoading(true)
    setPage(Math.max(start, initialPage || start))
    const task = getDocument({ url: src })
    task.promise.then(value => { if (active) setDocument(value) }).catch(failure => { if (active) { setError(failure instanceof Error ? `绘本加载失败：${failure.message}` : '绘本加载失败'); setLoading(false) } })
    return () => { active = false; void task.destroy() }
  }, [src, start, attempt])
  useEffect(() => {
    if (!document || !canvas.current) return
    let active = true
    let rendering: RenderTask | undefined
    setLoading(true)
    setError('')
    document.getPage(Math.min(page, document.numPages)).then(async current => {
      if (!active || !canvas.current) return
      const base = current.getViewport({ scale: 1 })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = current.getViewport({ scale: Math.min(width / base.width, window.innerHeight * 0.66 / base.height) * zoom * ratio })
      const target = canvas.current
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      setSize({ width: viewport.width / ratio, height: viewport.height / ratio })
      rendering = current.render({ canvas: target, viewport })
      await rendering.promise
      if (active) { setLoading(false); viewed.current?.(page) }
    }).catch(failure => { if (active && failure?.name !== 'RenderingCancelledException') { setError('这一页暂时未能显示，请重试'); setLoading(false) } })
    return () => { active = false; rendering?.cancel() }
  }, [document, page, width, zoom])
  const last = document ? Math.min(end || document.numPages, document.numPages) : end || start
  return <section aria-label={`${title} 绘本阅读器`} className="min-w-0 border border-[var(--color-line)]">
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
      <div className="flex items-center gap-2">
        <button type="button" title="上一页" aria-label="上一页" disabled={page <= start || !document} onClick={() => setPage(value => value - 1)} className="p-2 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
        <label className="flex items-center gap-2 text-sm"><span className="sr-only">绘本页码</span><input aria-label="绘本页码" type="number" min={start} max={last} value={page} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= start && value <= last) setPage(value) }} className="field w-16 py-1 text-center" /><span>/ {document?.numPages || '…'}</span></label>
        <button type="button" title="下一页" aria-label="下一页" disabled={page >= last || !document} onClick={() => setPage(value => value + 1)} className="p-2 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" title="缩小" aria-label="缩小" disabled={zoom <= 0.75} onClick={() => setZoom(value => Math.max(0.75, value - 0.25))} className="p-2 disabled:opacity-30"><ZoomOut className="h-5 w-5" /></button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" title="放大" aria-label="放大" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + 0.25))} className="p-2 disabled:opacity-30"><ZoomIn className="h-5 w-5" /></button>
      </div>
    </div>
    <div ref={container} className="relative min-h-72 overflow-auto bg-neutral-100" style={{ maxHeight: '72vh' }}>
      {loading && <p role="status" className="absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded bg-[var(--color-paper)] px-3 py-1 text-sm">绘本加载中…</p>}
      {error && <div role="alert" className="space-y-3 p-6"><p>{error}</p><button type="button" title="重新加载绘本" onClick={() => setAttempt(value => value + 1)} className="inline-flex items-center gap-2 text-sm"><RotateCcw className="h-4 w-4" />重试</button></div>}
      <canvas ref={canvas} aria-label={`${title} 第${page}页`} className="mx-auto block bg-white" style={{ width: size.width, height: size.height, visibility: error ? 'hidden' : 'visible' }} />
    </div>
  </section>
}