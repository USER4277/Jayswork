import express from 'express'
import { db, now } from '../db.js'
import { cycleRange, cycleOfIndex, dayIndex, todayStr } from '../schedule.js'
import { collectQuestions, gradeOne, nextReviewDate, mathComplete } from './homework.js'
import { normalize } from '../grading.js'
import { requireParent } from '../auth.js'

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
  if (!db.prepare('SELECT id FROM wrong_items WHERE id = ?').get(id)) return res.status(404).json({ error: '找不到这条错题' })
  const mastered = req.body?.mastered !== false
  db.prepare('UPDATE wrong_items SET mastery = ?, updated_at = ? WHERE id = ?').run(
    mastered ? 1 : 0,
    now(),
    id
  )
  res.json({ ok: true, id, mastery: mastered ? 1 : 0 })
})

/** 重做之后调用：答对了就安排下次复习，答错了就加一次错误次数 */
router.post('/wrong/:id/retry', async (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM wrong_items WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: '找不到这条错题' })
  if (row.subject === 'chinese' && !mathComplete(row.date)) return res.status(403).json({ error: '请先将当天数学作业订正到全部正确' })
  const question = collectQuestions(row.date, row.subject).find((question) => question.key === row.question_key)
  if (!question) return res.status(404).json({ error: '原题内容不存在，请让家长检查作业内容' })
  let answer = req.body?.answer
  if (typeof answer === 'string') {
    const text = normalize(answer)
    if (!text) return res.status(400).json({ error: '请先写下答案' })
    if (question.kind === 'english-choice') answer = { value: answer }
    else if (question.kind === 'chinese') answer = { text: answer }
    else {
      const specs = question.question.answer?.parts || []
      const numbers = text.match(/-?\d+(?:\.\d+)?/g) || []
      const tokens = text.split(/[;；\n]+/).map((value) => value.trim())
      let numberIndex = 0
      answer = { text: answer, parts: specs.map((part, index) => {
        let value = tokens[index] || ''
        if (part.kind === 'number') value = numbers[numberIndex++] || ''
        if (part.kind === 'ranking') value = text.split(/[\s,，、→]+/).filter(Boolean)
        if (part.kind === 'lines') value = tokens
        if (part.kind === 'grid') {
          try { value = JSON.parse(text) } catch { value = [] }
        }
        return { label: part.label, value }
      }) }
      if (specs.every((part) => part.kind === 'number') && numbers.length !== specs.length) return res.status(400).json({ error: `请按顺序填写 ${specs.length} 个数值答案` })
    }
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || (answer.parts !== undefined && !Array.isArray(answer.parts))) return res.status(400).json({ error: '请提交答案，不能直接指定对错' })
  const result = await gradeOne(question, answer)
  if (result.status === 'pending') return res.json({ ok: true, id, correct: false, pending: true, message: result.message, nextReviewDate: row.next_review_date })
  const correct = result.correct
  const stage = correct ? Math.min((row.reviewed_count || 0) + 1, 4) : 0
  const next = nextReviewDate(todayStr(), stage)
  db.prepare(
    `UPDATE wrong_items SET reviewed_count = ?, wrong_count = wrong_count + ?,
      next_review_date = ?, mastery = ?, updated_at = ? WHERE id = ?`
  ).run(stage, correct ? 0 : 1, next, correct && stage >= 4 ? 1 : 0, now(), id)
  res.json({ ok: true, id, correct, message: result.message, mastery: correct && stage >= 4 ? 1 : 0, nextReviewDate: next })
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
    if (v && typeof v === 'object') return [
      ...(v.parts || []).map((part) => `${part.label || ''} ${Array.isArray(part.value) ? JSON.stringify(part.value) : part.value ?? ''}`),
      v.text || v.value || '',
    ].filter(Boolean).join('，')
    return String(v)
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
       ${where.replace(/\bdate\b/g, 'w.date')} GROUP BY w.cycle ORDER BY w.cycle ASC`
    )
     .all(...args)

  const progress = db
    .prepare(
      `SELECT date, subject, status, score, total FROM daily_progress
       ${where} ORDER BY date DESC`
    )
     .all(...args)

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
router.get('/summary/:cycle', requireParent, (req, res) => {
  const cycle = Number(req.params.cycle)
  const row = db
    .prepare(
      `SELECT content FROM chat_messages WHERE json_extract(context_json, '$.kind') = 'weekly-summary' AND json_extract(context_json, '$.cycle') = ? ORDER BY id DESC LIMIT 1`
    )
    .get(cycle)
  if (!row) return res.json({ cycle, summary: null })
  try {
    res.json({ cycle, summary: JSON.parse(row.content) })
  } catch {
    res.json({ cycle, summary: null })
  }
})
