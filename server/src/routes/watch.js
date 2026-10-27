import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../config.js'
import { db, now, getSetting } from '../db.js'
import { requireParent } from '../auth.js'
import { isUnlocked, scheduleFor, todayStr } from '../schedule.js'

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
    const sessionId = req.params.sessionId
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId)
    if (!session || req.headers.authorization !== `Bearer ${session.upload_token}`) return res.status(401).json({ error: '无效的录像上传凭证' })
    if (session.ended_at) return res.status(409).json({ error: '录像已经结束' })
    const date = session.date
    const dir = path.join(RECORDING_DIR, date)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${sessionId}.webm`)

    const buf = req.body
    if (!Buffer.isBuffer(buf) || (!buf.length && req.query.final !== '1')) return res.status(400).json({ error: '空的片段' })

    // 片段 1 写文件，之后追加
    const idx = Number(req.query.index)
    if (!Number.isSafeInteger(idx) || idx !== session.next_chunk) return res.status(409).json({ error: '录像片段顺序不正确', expectedIndex: session.next_chunk })
    if (buf.length) fs.appendFileSync(file, buf)
    db.prepare('UPDATE sessions SET next_chunk = next_chunk + 1, recording = ? WHERE id = ?').run(path.join(date, `${sessionId}.webm`), sessionId)

    if (req.query.final === '1') {
      db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(now(), sessionId)
      res.json({ ok: true, file: path.join(date, `${sessionId}.webm`), size: fs.existsSync(file) ? fs.statSync(file).size : 0 })
    } else {
      res.json({ ok: true, index: idx, size: fs.statSync(file).size })
    }
  }
)

/** 开始一次会话（点「开始今日作业」时调用） */
router.post('/sessions', (req, res) => {
  if (!getSetting('monitoring', true)) return res.status(403).json({ error: '家长已关闭学习监控' })
  const id = crypto.randomUUID()
  const date = req.body?.date || todayStr()
  if (!scheduleFor(date) || !isUnlocked(date)) return res.status(400).json({ error: '无法在该日期开始作业' })
  const uploadToken = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (id, date, started_at, upload_token) VALUES (?, ?, ?, ?)').run(id, date, now(), uploadToken)
  res.json({ sessionId: id, date, uploadToken })
})

router.get('/sessions', requireParent, (req, res) => {
  const rows = db.prepare('SELECT id, date, started_at, ended_at, recording FROM sessions ORDER BY started_at DESC LIMIT 50').all()
  res.json(rows)
})
