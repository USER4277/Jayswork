import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { db, now, getSetting, setSetting, allSettings } from '../db.js'
import { config } from '../config.js'
import { getDays } from '../content.js'
import { loginParent, logoutParent, requireParent, invalidateParentSessions } from '../auth.js'
import { ANCHOR, TOTAL_DAYS, contentFor, scheduleRange, todayStr } from '../schedule.js'
import { readingTarget } from '../english-reading.js'
import { createEnglishRouter } from './english.js'
import { createRazRouter } from './raz.js'
import { raz } from './homework.js'
import { loadRazLibrary } from '../raz-library.js'

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

let testStorage
let testRouter
let testRaz

function englishTestRaz() {
  testRaz ||= createRazRouter({ ...getEnglishTestStorage(), allowedDate: date => { const content = contentFor(date); return Boolean(content?.schedule.languageSubject === 'english' && content.schedule.languageIndex) } })
  return testRaz
}

router.get('/raz', (req, res) => {
  res.json({ ...raz.course.summary(), profile: raz.course.profile(), issues: raz.course.library().issues, resourceRoot: config.razDir })
})

router.put('/raz/profile', (req, res) => {
  try { res.json(raz.course.setProfile(req.body)) }
  catch (error) { res.status(error.status || 500).json({ error: error.message }) }
})

router.get('/raz/test-dates', (req, res) => {
  const start = req.query.start || todayStr()
  res.json({ items: scheduleRange(start, 60).filter(day => day.languageSubject === 'english' && day.languageIndex).map(day => ({ date: day.date, dayIndex: day.dayIndex, title: 'RAZ 分级阅读' })) })
})

router.post('/raz/test-reset', (req, res) => { englishTestRaz().course.reset(); res.json({ ok: true }) })
router.put('/raz/test-profile', (req, res) => {
  try { res.json(englishTestRaz().course.setProfile(req.body)) }
  catch (error) { res.status(error.status || 500).json({ error: error.message }) }
})
router.post('/raz/rescan', (req, res) => { loadRazLibrary(config.razDir, true); res.json({ ok: true }) })
router.use('/english-test/raz', (req, res, next) => englishTestRaz().router(req, res, next))

export function getEnglishTestStorage() {
  if (testStorage) return testStorage
  const dataDir = path.join(config.dataDir, 'tests', 'english')
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const filename = path.join(dataDir, 'app.db')
  const database = new DatabaseSync(filename)
  try {
    fs.chmodSync(filename, 0o600)
    database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
    for (const table of ['attempts', 'voice_answers', 'daily_progress']) {
      if (!database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
        database.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql)
      }
    }
  } catch (error) { database.close(); throw error }
  testStorage = { db: database, dataDir, allowedDate: (date) => Boolean(readingTarget(date)), voiceBase: '/api/parent/english-test/voice-file', active: new Set() }
  return testStorage
}

router.use('/english-test', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

router.get('/english-test/dates', (req, res) => {
  res.json({ items: scheduleRange(ANCHOR, TOTAL_DAYS).filter((day) => readingTarget(day.date)).map((day) => ({ date: day.date, dayIndex: day.dayIndex, title: contentFor(day.date).english.dialogues[0].title })) })
})

router.get('/english-test/date/:date', (req, res) => {
  const { date } = req.params
  if (!readingTarget(date)) return res.status(400).json({ error: '请选择有英语作业的测试日期' })
  const content = contentFor(date)
  const progress = getEnglishTestStorage().db.prepare('SELECT subject, status, score, total, submitted_at FROM daily_progress WHERE date = ?').all(date)
  res.json({ ...content, schedule: { ...content.schedule, mathDay: null, codingDay: null }, math: null, chinese: null, coding: null, progress, locked: false, testMode: true })
})

router.get('/english-test/voice-file/:id', (req, res) => {
  const storage = getEnglishTestStorage()
  const row = storage.db.prepare('SELECT * FROM voice_answers WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: '找不到测试录音' })
  res.set('Content-Type', row.mime_type)
  res.set('X-Content-Type-Options', 'nosniff')
  res.sendFile(path.resolve(storage.dataDir, row.audio_path))
})

router.post('/english-test/reset', (req, res) => {
  const { date } = req.body || {}
  if (!readingTarget(date)) return res.status(400).json({ error: '请选择有英语作业的测试日期' })
  const storage = getEnglishTestStorage()
  if (storage.active.has(date)) return res.status(409).json({ error: '正在评分，请评分结束后再重置测试' })
  storage.db.exec('BEGIN IMMEDIATE')
  try {
    for (const table of ['attempts', 'voice_answers', 'daily_progress']) storage.db.prepare(`DELETE FROM ${table} WHERE date = ?`).run(date)
    storage.db.exec('COMMIT')
  } catch (error) { storage.db.exec('ROLLBACK'); throw error }
  fs.rmSync(path.join(storage.dataDir, 'voice', date), { recursive: true, force: true })
  res.json({ ok: true })
})

router.use('/english-test', (req, res, next) => {
  testRouter ||= createEnglishRouter(getEnglishTestStorage())
  testRouter(req, res, next)
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
