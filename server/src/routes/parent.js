import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { db, now, getSetting, setSetting, allSettings } from '../db.js'
import { config } from '../config.js'
import { getDays } from '../content.js'

export const router = express.Router()

const PIN_KEY = 'parent.pin'
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

/** 首次使用时把 .env 里的 PIN 写进数据库，之后以数据库为准 */
function ensurePin() {
  if (!getSetting(PIN_KEY)) setSetting(PIN_KEY, hash(config.parentPin))
}

/** 校验家长 PIN */
router.post('/login', (req, res) => {
  ensurePin()
  const pin = String(req.body?.pin ?? '')
  const ok = hash(pin) === getSetting(PIN_KEY)
  if (ok) setSetting('parent.session', { at: now() })
  res.json({ ok })
})

/** 家长设置 */
router.get('/settings', (req, res) => {
  ensurePin()
  const settings = allSettings()
  delete settings['parent.pin']
  delete settings['parent.session']
  res.json({
    ...settings,
    effective: {
      deadline: config.dailyDeadline,
      speechScoring: config.speechScoring,
      aiEnabled: Boolean(config.ai.apiKey),
    },
  })
})

router.put('/settings', (req, res) => {
  ensurePin()
  const { deadline, monitoring, pin, speechScoring, referenceUnlocked } = req.body || {}
  if (deadline !== undefined) setSetting('deadline', deadline)
  if (monitoring !== undefined) setSetting('monitoring', monitoring)
  if (speechScoring !== undefined) setSetting('speechScoring', speechScoring)
  if (referenceUnlocked !== undefined) setSetting('referenceUnlocked', referenceUnlocked)
  if (pin) setSetting(PIN_KEY, hash(pin))
  res.json({ ok: true })
})

/**
 * 参考答案总览（数学 + 语文）。只在家长区提供。
 */
router.get('/answers', (req, res) => {
  const days = getDays()
  const out = days.map((d) => ({
    day: d.day,
    math: d.math.groups.map((g) => ({
      key: g.key,
      title: g.title,
      questions: g.questions.map((q) => ({
        no: q.no,
        prompt: q.prompt,
        reference: q.reference,
        parts: q.answer?.parts || [],
        solution: q.solution || null,
      })),
    })),
    chinese: d.chinese
      ? {
          title: d.chinese.title,
          passage: d.chinese.passage,
          questions: d.chinese.questions.map((q) => ({
            no: q.no,
            prompt: q.prompt,
            reference: q.reference,
          })),
        }
      : null,
    english: {
      theme: d.english.theme,
      scene: d.english.scene,
      dialogues: d.english.dialogues,
      sentences: d.english.sentences,
    },
  }))
  res.json(out)
})

/** 每天的完成情况总览 */
router.get('/overview', (req, res) => {
  const rows = db
    .prepare(
      `SELECT date, subject, status, score, total, submitted_at FROM daily_progress
       ORDER BY date DESC LIMIT 60`
    )
    .all()
  res.json(rows)
})

// --------------------------------------------------------------------------
// 录像
// --------------------------------------------------------------------------

const RECORDING_DIR = path.join(config.dataDir, 'recordings')

router.get('/recordings', (req, res) => {
  if (!fs.existsSync(RECORDING_DIR)) return res.json({ items: [] })
  const items = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.webm')) {
        const stat = fs.statSync(full)
        items.push({
          file: path.relative(RECORDING_DIR, full),
          date: path.basename(dir),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      }
    }
  }
  walk(RECORDING_DIR)
  items.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  res.json({ items })
})

router.get('/recordings/:file', (req, res) => {
  const rel = req.params.file
  const full = path.join(RECORDING_DIR, rel)
  // 防目录穿越
  if (!full.startsWith(RECORDING_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ error: '找不到这个录像' })
  }
  res.setHeader('Content-Type', 'video/webm')
  res.sendFile(full)
})
