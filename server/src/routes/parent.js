import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { db, now, getSetting, setSetting, allSettings } from '../db.js'
import { config } from '../config.js'
import { getDays } from '../content.js'
import { loginParent, logoutParent, requireParent, invalidateParentSessions } from '../auth.js'

export const router = express.Router()

const PIN_KEY = 'parent.pin'
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const loginAttempts = new Map()

/** 首次使用时把 .env 里的 PIN 写进数据库，之后以数据库为准 */
function ensurePin() {
  if (!getSetting(PIN_KEY)) setSetting(PIN_KEY, hash(config.parentPin))
}

/** 校验家长 PIN */
router.post('/login', (req, res) => {
  ensurePin()
  const address = req.socket.remoteAddress
  for (const [key, attempt] of loginAttempts) if (attempt.until < Date.now()) loginAttempts.delete(key)
  const attempts = loginAttempts.get(address)
  if (attempts?.count >= 10) return res.status(429).json({ error: '尝试次数过多，请 5 分钟后再试' })
  const pin = String(req.body?.pin ?? '')
  const ok = hash(pin) === getSetting(PIN_KEY)
  if (ok) {
    loginAttempts.delete(address)
    loginParent(req, res)
  } else loginAttempts.set(address, { count: (attempts?.count || 0) + 1, until: attempts?.until || Date.now() + 300000 })
  res.json({ ok })
})

router.post('/logout', (req, res) => {
  logoutParent(req, res)
  res.json({ ok: true })
})

router.use(requireParent)

/** 家长设置 */
router.get('/settings', (req, res) => {
  ensurePin()
  const settings = allSettings()
  delete settings['parent.pin']
  delete settings['parent.session']
  res.json({
    ...settings,
    effective: {
      deadline: getSetting('deadline', config.dailyDeadline),
      speechScoring: getSetting('speechScoring', config.speechScoring),
      aiEnabled: Boolean(config.ai.apiKey),
    },
  })
})

router.put('/settings', (req, res) => {
  ensurePin()
  const { deadline, monitoring, pin, speechScoring, referenceUnlocked } = req.body || {}
  if (deadline !== undefined && (typeof deadline !== 'string' || (deadline !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deadline)))) return res.status(400).json({ error: '截止时间格式应为 HH:MM' })
  if (pin !== undefined && pin !== '' && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN 需要 4 到 6 位数字' })
  if ([monitoring, speechScoring, referenceUnlocked].some((value) => value !== undefined && typeof value !== 'boolean')) return res.status(400).json({ error: '开关设置必须为布尔值' })
  if (deadline !== undefined) setSetting('deadline', deadline)
  if (monitoring !== undefined) setSetting('monitoring', monitoring)
  if (speechScoring !== undefined) setSetting('speechScoring', speechScoring)
  if (referenceUnlocked !== undefined) setSetting('referenceUnlocked', referenceUnlocked)
  if (pin) {
    setSetting(PIN_KEY, hash(pin))
    invalidateParentSessions()
    loginParent(req, res)
  }
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

router.get('/recordings/:date/:file', (req, res) => {
  const { date, file } = req.params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f0-9-]+\.webm$/.test(file)) return res.status(404).json({ error: '找不到这个录像' })
  const full = path.resolve(RECORDING_DIR, date, file)
  // 防目录穿越
  if (!full.startsWith(RECORDING_DIR + path.sep) || !fs.existsSync(full)) {
    return res.status(404).json({ error: '找不到这个录像' })
  }
  res.setHeader('Content-Type', 'video/webm')
  res.sendFile(full)
})
