import express from 'express'
import { db, now } from '../db.js'
import { cycleRange, cycleOfIndex, dayIndex, todayStr } from '../schedule.js'

export const router = express.Router()

const SUBJECTS = [
  { key: 'math', label: '数学' },
  { key: 'chinese', label: '语文' },
  { key: 'english', label: '英语' },
  { key: 'coding', label: '编程' },
]

/**
 * 错题本：按科目分组，组内按 7 天一个周期分段。
 * GET /api/review/wrong
 */
router.get('/wrong', (req, res) => {
  const subject = req.query.subject
  const cycle = req.query.cycle ? Number(req.query.cycle) : null

  const where = []
  const args = []
  if (subject && subject !== 'all') {
    where.push('subject = ?')
    args.push(subject)
  }
  if (cycle) {
    where.push('cycle = ?')
    args.push(cycle)
  }
  const sql = `SELECT * FROM wrong_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY cycle ASC, date ASC, id ASC`

  const rows = db.prepare(sql).all(...args)
  const today = todayStr()

  // 按科目 → 周期 分组
  const bySubject = new Map()
  for (const s of SUBJECTS) bySubject.set(s.key, new Map())

  for (const row of rows) {
    if (!bySubject.has(row.subject)) bySubject.set(row.subject, new Map())
    const cycles = bySubject.get(row.subject)
    if (!cycles.has(row.cycle)) cycles.set(row.cycle, [])
    cycles.get(row.cycle).push({
      id: row.id,
      date: row.date,
      cycle: row.cycle,
      subject: row.subject,
      questionKey: row.question_key,
      questionText: row.question_text,
      myAnswer: safeParse(row.my_answer),
      correctAnswer: row.correct_answer,
      reason: row.reason,
      explanation: row.explanation,
      knowledgePoint: row.knowledge_point ? row.knowledge_point.split(',').filter(Boolean) : [],
      mastery: row.mastery,
      kind: row.kind || 'wrong',
      wrongCount: row.wrong_count,
      nextReviewDate: row.next_review_date,
      due: row.mastery === 0 && row.next_review_date && row.next_review_date <= today,
    })
  }

  const result = SUBJECTS.map((s) => {
    const cycles = bySubject.get(s.key) || new Map()
    const cycleList = [...cycles.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([c, items]) => {
        const range = cycleRange(c)
        return {
          cycle: c,
          range,
          label: `第 ${c} 周（${range.start} ~ ${range.end}）`,
          count: items.length,
          mastered: items.filter((i) => i.mastery > 0).length,
          items,
        }
      })
    return {
      subject: s.key,
      label: s.label,
      total: cycleList.reduce((n, c) => n + c.count, 0),
      cycles: cycleList,
    }
  }).filter((s) => s.total > 0 || !subject || subject === 'all')

  res.json({ today, groups: result })
})

/** 今天该复习的错题 */
router.get('/due', (req, res) => {
  const today = todayStr()
  const rows = db
    .prepare(
      `SELECT * FROM wrong_items
       WHERE mastery = 0 AND next_review_date IS NOT NULL AND next_review_date <= ?
       ORDER BY next_review_date ASC, cycle ASC`
    )
    .all(today)
  res.json({
    today,
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      date: r.date,
      subject: r.subject,
      cycle: r.cycle,
      questionKey: r.question_key,
      questionText: r.question_text,
      myAnswer: safeParse(r.my_answer),
      correctAnswer: r.correct_answer,
      explanation: r.explanation,
      knowledgePoint: r.knowledge_point ? r.knowledge_point.split(',').filter(Boolean) : [],
      wrongCount: r.wrong_count,
    })),
  })
})

/** 标记已掌握 / 重置复习进度 */
router.post('/wrong/:id/master', (req, res) => {
  const id = Number(req.params.id)
  const mastered = req.body?.mastered !== false
  db.prepare('UPDATE wrong_items SET mastery = ?, updated_at = ? WHERE id = ?').run(
    mastered ? 1 : 0,
    now(),
    id
  )
  res.json({ ok: true, id, mastery: mastered ? 1 : 0 })
})

/** 重做之后调用：答对了就安排下次复习，答错了就加一次错误次数 */
router.post('/wrong/:id/retry', (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM wrong_items WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '找不到这条错题' })
  const correct = Boolean(req.body?.correct)
  const stage = Math.min((row.reviewed_count || 0) + 1, 4)
  const next = correct ? addDays(row.date, [1, 2, 4, 7, 15][stage]) : addDays(todayStr(), 1)
  db.prepare(
    `UPDATE wrong_items SET reviewed_count = reviewed_count + 1, wrong_count = wrong_count + ?,
      next_review_date = ?, mastery = ?, updated_at = ? WHERE id = ?`
  ).run(correct ? 0 : 1, next, correct ? 0 : row.mastery, now(), id)
  res.json({ ok: true, id, correct, nextReviewDate: next })
})

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function safeParse(text) {
  if (!text) return ''
  try {
    const v = JSON.parse(text)
    if (typeof v === 'string') return v
    if (Array.isArray(v)) {
      return v
        .map((p) => (p && typeof p === 'object' ? `${p.label ?? ''}${p.value ?? p.text ?? ''}` : String(p)))
        .filter(Boolean)
        .join('，')
    }
    return JSON.stringify(v)
  } catch {
    return text
  }
}

/**
 * 学习报告：完成率、正确率、各科目与各周期的分布。
 */
router.get('/report', (req, res) => {
  const from = req.query.from || null
  // 试看模式下可能已经有未来日期的作答，报告要把它们也算进去
  const latest = db.prepare('SELECT MAX(date) AS d FROM attempts').get()
  const to = req.query.to || [todayStr(), latest?.d].filter(Boolean).sort().pop()
  const args = []
  let where = 'WHERE date <= ?'
  args.push(to)
  if (from) {
    where += ' AND date >= ?'
    args.push(from)
  }

  const totals = db
    .prepare(`SELECT subject, COUNT(*) AS total, SUM(correct) AS correct FROM attempts ${where} GROUP BY subject`)
    .all(...args)

  const byDate = db
    .prepare(
      `SELECT date, COUNT(*) AS total, SUM(correct) AS correct FROM attempts ${where}
       GROUP BY date ORDER BY date ASC`
    )
    .all(...args)

  const byCycle = db
    .prepare(
      `SELECT w.cycle AS cycle, COUNT(*) AS wrong FROM wrong_items w
       JOIN attempts a ON a.date = w.date AND a.subject = w.subject AND a.question_key = w.question_key
       WHERE w.date <= ? GROUP BY w.cycle ORDER BY w.cycle ASC`
    )
    .all(to)

  const progress = db
    .prepare(
      `SELECT date, subject, status, score, total FROM daily_progress
       WHERE date <= ? ORDER BY date DESC LIMIT 60`
    )
    .all(to)

  const labels = Object.fromEntries(SUBJECTS.map((s) => [s.key, s.label]))

  res.json({
    subjects: totals.map((t) => ({
      subject: t.subject,
      label: labels[t.subject] || t.subject,
      total: t.total || 0,
      correct: t.correct || 0,
      rate: t.total ? Math.round(((t.correct || 0) / t.total) * 100) : 0,
    })),
    byDate: byDate.map((r) => ({
      date: r.date,
      total: r.total || 0,
      correct: r.correct || 0,
      rate: r.total ? Math.round(((r.correct || 0) / r.total) * 100) : 0,
    })),
    wrongByCycle: byCycle.map((r) => ({ cycle: r.cycle, wrong: r.wrong })),
    progress,
    cycles: [...new Set([...byCycle.map((c) => c.cycle)])].map((c) => ({ cycle: c, ...cycleRange(c) })),
  })
})

/** 某个周期的小结（AI 生成后缓存） */
router.get('/summary/:cycle', (req, res) => {
  const cycle = Number(req.params.cycle)
  const row = db
    .prepare(
      `SELECT content FROM chat_messages WHERE context_json LIKE ? ORDER BY id DESC LIMIT 1`
    )
    .get(`%"kind":"weekly-summary","cycle":${cycle}%`)
  if (!row) return res.json({ cycle, summary: null })
  try {
    res.json({ cycle, summary: JSON.parse(row.content) })
  } catch {
    res.json({ cycle, summary: null })
  }
})
