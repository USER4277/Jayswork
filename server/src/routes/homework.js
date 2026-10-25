import express from 'express'
import { db, now } from '../db.js'
import {
  scheduleFor,
  contentFor,
  dateOfIndex,
  dayIndex,
  cycleOfIndex,
  todayStr,
  scheduleRange,
  isUnlocked,
  TOTAL_DAYS,
  DOCX_DAYS,
  ANCHOR,
} from '../schedule.js'
import { gradeQuestion, gradeChoice } from '../grading.js'
import { pointsForMath, pointsForChinese } from '../knowledge.js'
import { getProjects, getDays } from '../content.js'
import { chatJson } from '../ai.js'
import {
  mathProcessPrompt,
  mathOpenPrompt,
  chinesePrompt,
} from '../prompts.js'
import { aiEnabled } from '../config.js'

export const router = express.Router()

/** 今日概览：有哪些科目、各自完成到哪了 */
router.get('/today', (req, res) => {
  const date = req.query.date || todayStr()
  const s = scheduleFor(date)
  if (!s) return res.status(404).json({ error: '这个日期没有安排作业' })
  const content = contentFor(date)
  const progress = db
    .prepare('SELECT subject, status, score, total, submitted_at FROM daily_progress WHERE date = ?')
    .all(date)
  const attempts = db
    .prepare('SELECT subject, COUNT(*) AS n, SUM(correct) AS ok FROM attempts WHERE date = ? GROUP BY subject')
    .all(date)
  res.json({
    date,
    schedule: s,
    locked: !isUnlocked(date),
    hasMath: Boolean(content.math),
    hasChinese: Boolean(content.chinese),
    hasEnglish: Boolean(content.english),
    hasCoding: Boolean(content.coding),
    progress,
    attempts,
    aiEnabled: aiEnabled(),
  })
})

/** 某一天的完整作业内容 */
router.get('/date/:date', (req, res) => {
  const { date } = req.params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式不对' })
  const s = scheduleFor(date)
  if (!s) return res.status(404).json({ error: '这个日期没有安排作业' })
  if (!isUnlocked(date)) {
    return res.status(403).json({ error: '这天的作业还没到时间，明天再来吧', locked: true, schedule: s })
  }
  const content = contentFor(date)
  const progress = db
    .prepare('SELECT subject, status, score, total, submitted_at FROM daily_progress WHERE date = ?')
    .all(date)
  res.json({ date, schedule: s, locked: false, ...content, progress })
})

/** 可选日期列表（首页日历） */
router.get('/calendar', (req, res) => {
  const start = req.query.start || todayStr()
  const count = Math.min(Number(req.query.count) || 28, 60)
  const today = todayStr()
  res.json({
    anchor: ANCHOR,
    totalDays: TOTAL_DAYS,
    docxDays: DOCX_DAYS,
    today,
    items: scheduleRange(start, count).map((s) => ({
      ...s,
      locked: !isUnlocked(s.date),
      isToday: s.date === today,
    })),
  })
})

/** 两个编程项目的规则与自查清单 */
router.get('/projects', (req, res) => {
  res.json(getProjects())
})

// --------------------------------------------------------------------------
// 提交与批改
// --------------------------------------------------------------------------

const SUBJECT_LABEL = { math: '数学', chinese: '语文', english: '英语', coding: '编程' }

/** 找出某天某科目的全部题目 */
function collectQuestions(date, subject) {
  const content = contentFor(date)
  if (!content) return []
  if (subject === 'math' && content.math) {
    const list = []
    for (const g of content.math.groups) {
      for (const q of g.questions) {
        list.push({
          key: `${g.key}-${q.no}`,
          kind: 'math',
          group: g.key,
          groupTitle: g.title,
          no: q.no,
          question: q,
        })
      }
    }
    return list
  }
  if (subject === 'chinese' && content.chinese) {
    return content.chinese.questions.map((q) => ({
      key: `q${q.no}`,
      kind: 'chinese',
      group: 'chinese',
      groupTitle: '阅读理解',
      no: q.no,
      question: q,
    }))
  }
  if (subject === 'english' && content.englishExercises) {
    const list = []
    content.englishExercises.listening.forEach((q, i) =>
      list.push({ key: `listen-${i}`, kind: 'english-choice', group: 'listening', groupTitle: '听一听，选一选', no: i + 1, question: q })
    )
    content.englishExercises.dialogue.forEach((q, i) =>
      list.push({ key: `dialog-${i}`, kind: 'english-choice', group: 'dialogue', groupTitle: '对话补全', no: i + 1, question: q })
    )
    return list
  }
  return []
}

/**
 * 提交某一科的作答并批改。
 * body: { date, subject, answers: { [questionKey]: { parts: [...], text: '...' } } }
 */
router.post('/submit', async (req, res) => {
  const { date, subject, answers } = req.body || {}
  if (!date || !subject || !answers) return res.status(400).json({ error: '缺少参数' })
  if (!isUnlocked(date)) return res.status(403).json({ error: '这天的作业还没到时间，不能提交' })

  const questions = collectQuestions(date, subject)
  if (!questions.length) return res.status(400).json({ error: '这一天没有这一科的作业' })

  const schedule = scheduleFor(date)
  const results = []
  const wrong = []
  let aiNeeded = 0

  for (const q of questions) {
    const submitted = answers[q.key] || {}
    const r = await gradeOne(q, submitted)
    results.push({ key: q.key, no: q.no, group: q.group, groupTitle: q.groupTitle, ...r })
    // 只有「确定错了 / 还没答全」才进错题本；「等 AI 批改」不算错
    if (r.status === 'wrong' || r.status === 'partial') {
      wrong.push({ q, submitted, r })
    }
    if (r.status === 'pending') aiNeeded++
  }

  const total = results.length
  const correct = results.filter((r) => r.status === 'correct').length
  const partial = results.filter((r) => r.status === 'partial').length
  const pending = results.filter((r) => r.status === 'pending').length
  const score = total ? Math.round((correct / total) * 100) : 0

  // 记录每次作答
  const upsert = db.prepare(`
    INSERT INTO attempts (date, subject, question_key, answer_json, correct, score, ai_feedback, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, subject, question_key) DO UPDATE SET
      answer_json = excluded.answer_json,
      correct = excluded.correct,
      score = excluded.score,
      ai_feedback = excluded.ai_feedback,
      updated_at = excluded.updated_at
  `)
  for (const r of results) {
    upsert.run(
      date,
      subject,
      r.key,
      JSON.stringify(answers[r.key] || {}),
      r.correct ? 1 : 0,
      r.score ?? 0,
      r.ai ? JSON.stringify(r.ai) : null,
      now(),
      now()
    )
  }

  // 错题入库
  for (const { q, submitted, r } of wrong) {
    upsertWrongItem({ date, subject, cycle: schedule.cycle, q, submitted, r })
  }

  db.prepare(`
    INSERT INTO daily_progress (date, subject, status, submitted_at, score, total)
    VALUES (?, ?, 'submitted', ?, ?, ?)
    ON CONFLICT(date, subject) DO UPDATE SET
      status = 'submitted', submitted_at = excluded.submitted_at,
      score = excluded.score, total = excluded.total
  `).run(date, subject, now(), score, total)

  res.json({
    date,
    subject,
    subjectLabel: SUBJECT_LABEL[subject] || subject,
    total,
    correct,
    pending: aiNeeded,
    score,
    results,
    wrongCount: wrong.length,
  })
})

/**
 * 判一道题。
 * status: 'correct' 确定对了 | 'wrong' 确定错了 | 'pending' 需要 AI 批改但 AI 没连上
 */
async function gradeOne(q, submitted) {
  if (q.kind === 'english-choice') {
    const chosen = submitted?.value ?? submitted?.selected ?? ''
    const g = gradeChoice(chosen, q.question.answer)
    return {
      status: g.correct ? 'correct' : 'wrong',
      correct: g.correct,
      score: g.score,
      message: g.message,
      parts: [],
      expected: q.question.answer,
      actual: chosen,
    }
  }

  if (q.kind === 'chinese') {
    const text = submitted?.text ?? ''
    if (!aiEnabled()) {
      return {
        status: 'pending',
        correct: false,
        score: 0,
        message: '这道题要 AI 老师批改，现在还没连上 AI。',
        parts: [],
        pendingAi: true,
      }
    }
    const ai = await askAi(chinesePrompt({
      passage: q.question.passage,
      source: q.question.source,
      question: q.question.prompt,
      reference: q.question.reference,
      answer: text,
    }))
    if (!ai) {
      return {
        status: 'pending',
        correct: false,
        score: 0,
        message: 'AI 老师这次没回答上，等一会儿再试一次。',
        parts: [],
        pendingAi: true,
      }
    }
    const verdict = String(ai.判定 ?? '')
    const status = verdict === '对' ? 'correct' : verdict === '部分对' ? 'partial' : 'wrong'
    return {
      status,
      correct: status === 'correct',
      score: Number(ai.得分 ?? 0),
      message: ai.讲解 || '',
      errorReason: ai.错误原因 || '',
      hint: ai.订正提示 || '',
      ai,
      parts: [],
    }
  }

  // 数学
  const graded = gradeQuestion(q.question, submitted)
  const text = submitted?.text ?? ''
  if (graded.needAi && (text || graded.parts.length === 0)) {
    const isWord = q.group === 'word'
    const ai = await askAi(
      isWord
        ? mathProcessPrompt({
            question: q.question.prompt,
            reference: q.question.reference,
            answer: text,
            groupTitle: q.groupTitle,
          })
        : mathOpenPrompt({
            question: q.question.prompt,
            reference: q.question.reference,
            answer: text,
            groupTitle: q.groupTitle,
          })
    )
    if (ai) {
      const numericOk = graded.parts.length === 0 ? true : graded.parts.every((p) => p.correct)
      const verdict = String(ai.判定 ?? '')
      const aiStatus = verdict === '对' ? 'correct' : verdict === '部分对' ? 'partial' : 'wrong'
      const status = numericOk ? aiStatus : 'wrong'
      return {
        status,
        correct: status === 'correct',
        score: numericOk ? Number(ai.得分 ?? 0) : Math.min(Number(ai.得分 ?? 0), 5),
        message: ai.讲解 || graded.message,
        errorReason: ai.错误原因 || graded.message,
        hint: ai.订正提示 || '',
        parts: graded.parts,
        ai,
      }
    }
    // AI 没连上：数值部分照样能判
    if (graded.parts.length > 0) {
      return {
        status: graded.correct ? 'correct' : 'wrong',
        correct: graded.correct,
        score: graded.score,
        message: graded.message,
        parts: graded.parts,
        pendingAi: true,
      }
    }
    return {
      status: 'pending',
      correct: false,
      score: 0,
      message: '这道题要 AI 老师批改，现在还没连上 AI。',
      parts: [],
      pendingAi: true,
    }
  }

  return {
    status: graded.correct ? 'correct' : 'wrong',
    correct: graded.correct,
    score: graded.score,
    message: graded.message,
    parts: graded.parts,
    pendingAi: false,
  }
}

/** 调 AI 批改；没配 key 或调用失败时返回 null（界面会退回本地参考答案） */
async function askAi(messages) {
  if (!aiEnabled()) return null
  try {
    const json = await chatJson(messages, { temperature: 0.2, maxTokens: 1200 })
    if (!json || typeof json !== 'object') return null
    if (!('判定' in json) && !('讲解' in json)) return null
    return json
  } catch (err) {
    console.error('[ai] 批改失败：', err.message)
    return null
  }
}

/** 错题入库（同一题重复做错就累加次数） */
function upsertWrongItem({ date, subject, cycle, q, submitted, r }) {
  const points =
    subject === 'math'
      ? pointsForMath(q.group, scheduleDay(date), q.no)
      : subject === 'chinese'
        ? pointsForChinese(q.question.prompt || '')
        : []
  const myAnswer = JSON.stringify(submitted?.parts ?? submitted?.text ?? '')
  const correctAnswer =
    q.kind === 'math'
      ? (q.question.answer?.parts || []).map((p) => `${p.label}=${p.value ?? ''}`).join('，')
      : q.question.answer || q.question.reference || ''

  const kind = r.status === 'partial' ? 'partial' : 'wrong'
  const existing = db
    .prepare('SELECT id FROM wrong_items WHERE date = ? AND subject = ? AND question_key = ?')
    .get(date, subject, q.key)

  if (existing) {
    db.prepare(
      `UPDATE wrong_items SET wrong_count = wrong_count + 1, my_answer = ?, correct_answer = ?,
        reason = ?, explanation = ?, knowledge_point = ?, kind = ?, updated_at = ?, next_review_date = ?
       WHERE id = ?`
    ).run(
      myAnswer,
      correctAnswer,
      r.errorReason || r.message || '',
      r.message || '',
      points.join(','),
      now(),
      nextReviewDate(date, 0),
      existing.id
    )
  } else {
    db.prepare(
      `INSERT INTO wrong_items (date, subject, cycle, question_key, question_text, my_answer,
        correct_answer, reason, explanation, knowledge_point, kind, next_review_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      date,
      subject,
      cycle,
      q.key,
      q.question.prompt || q.question.text || q.key,
      myAnswer,
      correctAnswer,
      r.errorReason || r.message || '',
      r.message || '',
      points.join(','),
      kind,
      nextReviewDate(date, 0),
      now(),
      now()
    )
  }
}

/** 简化 SM-2 的间隔：1 / 2 / 4 / 7 / 15 天 */
export function nextReviewDate(fromDate, stage) {
  const steps = [1, 2, 4, 7, 15]
  const days = steps[Math.min(stage, steps.length - 1)]
  const d = new Date(fromDate)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function scheduleDay(date) {
  const idx = dayIndex(date)
  return idx >= 1 && idx <= DOCX_DAYS ? idx : null
}

/** 编程作业的记录（收获 / 学到的一件事 / 自查清单） */
router.post('/coding-note', (req, res) => {
  const { date, gain, learned, checklist } = req.body || {}
  if (!date) return res.status(400).json({ error: '缺少日期' })
  db.prepare(
    `INSERT INTO coding_notes (date, gain, learned, checklist_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       gain = excluded.gain, learned = excluded.learned,
       checklist_json = excluded.checklist_json, updated_at = excluded.updated_at`
  ).run(date, gain ?? '', learned ?? '', JSON.stringify(checklist ?? {}), now())
  res.json({ ok: true })
})

router.get('/coding-note/:date', (req, res) => {
  const row = db.prepare('SELECT * FROM coding_notes WHERE date = ?').get(req.params.date)
  res.json(
    row
      ? { date: row.date, gain: row.gain, learned: row.learned, checklist: JSON.parse(row.checklist_json || '{}') }
      : { date: req.params.date, gain: '', learned: '', checklist: {} }
  )
})
