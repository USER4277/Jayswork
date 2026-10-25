import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import { config } from '../config.js'
import { db, now } from '../db.js'

/**
 * 学习监控：画面实时同步 + 录像落盘。
 *
 * 孩子的浏览器把摄像头画面压成 JPEG 帧，经 WebSocket 推给服务器；
 * 服务器再转发给所有「爸爸手机」上的观看端。
 *
 * 全程只在本机局域网内转发，不经过任何外部服务。
 */

export const router = express.Router()

const RECORDING_DIR = path.join(config.dataDir, 'recordings')
fs.mkdirSync(RECORDING_DIR, { recursive: true })

// --------------------------------------------------------------------------
// 录像上传：分片 POST，最后一段带 final=1 收尾
// --------------------------------------------------------------------------

router.post(
  '/recordings/:sessionId/chunk',
  express.raw({ type: 'application/octet-stream', limit: '16mb' }),
  (req, res) => {
    const sessionId = String(req.params.sessionId).replace(/[^\w.-]/g, '')
    if (!sessionId) return res.status(400).json({ error: '缺少 sessionId' })

    const date = String(req.query.date || new Date().toISOString().slice(0, 10))
    const dir = path.join(RECORDING_DIR, date)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${sessionId}.webm`)

    const buf = req.body
    if (!buf || !buf.length) return res.status(400).json({ error: '空的片段' })

    // 片段 1 写文件，之后追加
    const idx = Number(req.query.index || 0)
    fs.appendFileSync(file, buf)

    if (req.query.final === '1') {
      db.prepare(
        `INSERT INTO sessions (id, date, started_at, recording) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ended_at = ?, recording = ?`
      ).run(sessionId, date, now(), path.join(date, `${sessionId}.webm`), now(), path.join(date, `${sessionId}.webm`))
      res.json({ ok: true, file: path.join(date, `${sessionId}.webm`), size: fs.statSync(file).size })
    } else {
      res.json({ ok: true, index: idx, size: fs.statSync(file).size })
    }
  }
)

/** 开始一次会话（点「开始今日作业」时调用） */
router.post('/sessions', (req, res) => {
  const id = crypto.randomUUID()
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10))
  db.prepare('INSERT INTO sessions (id, date, started_at) VALUES (?, ?, ?)').run(id, date, now())
  res.json({ sessionId: id, date })
})

router.get('/sessions', (req, res) => {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 50').all()
  res.json(rows)
})

// --------------------------------------------------------------------------
// WebSocket：画面中转
// --------------------------------------------------------------------------

export function attachWatchServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/watch' })

  /** sessionId → { child: ws|null, parents: Set<ws> } */
  const rooms = new Map()

  const room = (id) => {
    if (!rooms.has(id)) rooms.set(id, { child: null, parents: new Set() })
    return rooms.get(id)
  }

  wss.on('connection', (ws, req) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      ws.close(1008, 'bad url')
      return
    }
    const role = url.searchParams.get('role') || 'parent'
    const sessionId = url.searchParams.get('session') || 'default'

    if (role === 'child') {
      const r = room(sessionId)
      if (r.child) {
        try {
          r.child.close(1000, 'replaced')
        } catch {
          /* 忽略 */
        }
      }
      r.child = ws
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return
        // 广播给所有观看端
        for (const p of r.parents) {
          if (p.readyState === 1) p.send(data, { binary: true })
        }
      })
      ws.on('close', () => {
        if (r.child === ws) r.child = null
      })
      ws.on('error', () => {})
      return
    }

    // 观看端
    const r = room(sessionId)
    r.parents.add(ws)
    ws.send(JSON.stringify({ type: 'status', childOnline: Boolean(r.child) }))
    ws.on('close', () => r.parents.delete(ws))
    ws.on('error', () => r.parents.delete(ws))
  })

  // 有观看端在线时才提示孩子端开始推流
  const poll = setInterval(() => {
    for (const [id, r] of rooms) {
      const want = r.parents.size > 0
      if (want !== r.streaming) {
        r.streaming = want
        if (r.child && r.child.readyState === 1) {
          r.child.send(JSON.stringify({ type: 'streaming', on: want }))
        }
      }
    }
  }, 1000)
  wss.on('close', () => clearInterval(poll))

  return wss
}
