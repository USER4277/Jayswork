import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import multer from 'multer'
import { db, now, getSetting } from '../db.js'
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
import { aiEnabled, config } from '../config.js'
import { gradeReading, readingState, readingTarget, sentencesPassed } from '../english-reading.js'
import { workedSolution } from '../math-solutions.js'

export const router = express.Router()

export function mathComplete(date) {
  const questions = collectQuestions(date, 'math')
  if (!questions.length) return true
  const rows = db.prepare("SELECT question_key, result_json FROM attempts WHERE date = ? AND subject = 'math'").all(date)
  return questions.every((question) => {
    const row = rows.find((row) => row.question_key === question.key)
    const result = row?.result_json ? JSON.parse(row.result_json) : null
    return result?.status === 'correct' && !result.pendingAi && result.questionVersion === question.question.version
  })
}

/** 今日概览：有哪些科目、各自完成到哪了 */
router.get('/today', (req, res) => {
  const date = req.query.date || todayStr()
  const s = scheduleFor(date)
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
    hasMath: Boolean(content?.math),
    hasChinese: Boolean(content?.chinese),
    chineseUnlocked: mathComplete(date),
    hasEnglish: Boolean(content?.english),
    hasCoding: Boolean(content?.coding),
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
    return res.status(403).json({ error: '只能填写当天的作业，不能切换到其他日期', locked: true, schedule: s })
  }
  const content = contentFor(date)
  const chineseUnlocked = mathComplete(date)
  if (req.query.subject === 'chinese' && !chineseUnlocked) return res.status(403).json({ error: '请先完成当天数学作业并订正到全部正确，再开始语文作业', locked: true })
  const progress = db
    .prepare('SELECT subject, status, score, total, submitted_at FROM daily_progress WHERE date = ?')
    .all(date)
  res.json({ date, schedule: s, locked: false, ...content, chinese: chineseUnlocked ? content.chinese : null, chineseUnlocked, progress })
})

/** 可选日期列表（首页日历） */
router.get('/calendar', (req, res) => {
  const start = req.query.start || ANCHOR
  if (!scheduleFor(start) && start !== ANCHOR) return res.status(400).json({ error: '无效的起始日期' })
  const count = Math.max(1, Math.min(Math.floor(Number(req.query.count)) || 28, 60))
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

router.get('/settings', (req, res) => {
  res.json({ monitoring: getSetting('monitoring', true), deadline: getSetting('deadline', config.dailyDeadline), speechScoring: getSetting('speechScoring', config.speechScoring) })
})

const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 32 * 1024 } }).single('audio')
const voiceTypes = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }
const voiceView = (row) => ({ id: row.id, date: row.date, questionKey: row.question_key, transcript: row.transcript, mimeType: row.mime_type, createdAt: row.created_at, url: `/api/homework/voice-file/${row.id}` })

function voiceAccess(req, res, next) {
  const { date, questionKey } = req.params
  if (!isUnlocked(date) || !mathComplete(date)) return res.status(403).json({ error: '请先完成当天数学作业并订正到全部正确' })
  const questions = collectQuestions(date, 'chinese')
  if (!questions.length || (questionKey && !questions.some((question) => question.key === questionKey))) return res.status(400).json({ error: '找不到这道语文题' })
  next()
}

router.post('/voice/:date/:questionKey', voiceAccess, (req, res, next) => {
  voiceUpload(req, res, (error) => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: '录音上传失败，请使用不超过 8 MB 的音频文件' })
    const file = req.file
    const mime = file?.mimetype?.split(';')[0]
    if (!file?.size || !voiceTypes[mime] || typeof req.body.transcript !== 'string') return res.status(400).json({ error: '请同时提供录音文件和识别文字' })
    const id = crypto.randomUUID()
    const relative = path.join('voice', req.params.date, `${id}.${voiceTypes[mime]}`)
    const destination = path.join(config.dataDir, relative)
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, file.buffer)
      db.prepare('INSERT INTO voice_answers (id, date, question_key, transcript, audio_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.params.date, req.params.questionKey, req.body.transcript, relative, mime, now())
      res.json(voiceView(db.prepare('SELECT * FROM voice_answers WHERE id = ?').get(id)))
    } catch (failure) {
      fs.rmSync(destination, { force: true })
      next(failure)
    }
  })
})

router.get('/voice/:date', voiceAccess, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM voice_answers WHERE date = ? ORDER BY created_at, rowid').all(req.params.date).map(voiceView) })
})

router.get('/voice-file/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM voice_answers WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: '找不到录音文件' })
  if (!isUnlocked(row.date) || (!/^english-(dialogue|line-\d+)$/.test(row.question_key) && !mathComplete(row.date))) return res.status(403).json({ error: '当前还不能访问这天的录音' })
  res.set('Content-Type', row.mime_type)
  res.set('X-Content-Type-Options', 'nosniff')
  res.sendFile(path.resolve(config.dataDir, row.audio_path))
})

// --------------------------------------------------------------------------
// 提交与批改
// --------------------------------------------------------------------------

const SUBJECT_LABEL = { math: '数学', chinese: '语文', english: '英语', coding: '编程' }

/** 找出某天某科目的全部题目 */
export function collectQuestions(date, subject) {
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
      question: { ...q, passage: content.chinese.passage, source: content.chinese.source },
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
router.post(['/submit', '/correct'], async (req, res) => {
  const { date, subject, answers, questionKey } = req.body || {}
  if (!scheduleFor(date) || !['math', 'chinese', 'english'].includes(subject) || !answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ error: '作答参数不正确' })
  if (Object.values(answers).some((answer) => !answer || typeof answer !== 'object' || Array.isArray(answer) || (answer.parts !== undefined && !Array.isArray(answer.parts)) || (answer.text !== undefined && typeof answer.text !== 'string'))) return res.status(400).json({ error: '答案格式不正确' })
  if (!isUnlocked(date)) return res.status(403).json({ error: '只能提交当天的作业' })
  if (subject === 'chinese' && !mathComplete(date)) return res.status(403).json({ error: '当天数学作业全部答对后才能提交语文作业', locked: true })

  const allQuestions = collectQuestions(date, subject)
  if (!allQuestions.length) return res.status(400).json({ error: '这一天没有这一科的作业' })
  const isCorrection = req.path === '/correct'
  const questions = isCorrection ? allQuestions.filter((question) => question.key === questionKey) : allQuestions
  if (!questions.length || (isCorrection && (!answers[questionKey] || Object.keys(answers).length !== 1))) return res.status(400).json({ error: '请只提交要订正的这一题' })
  if (isCorrection) {
    const previous = db.prepare('SELECT result_json FROM attempts WHERE date = ? AND subject = ? AND question_key = ?').get(date, subject, questionKey)
    if (!previous) return res.status(409).json({ error: '请先提交整份作业，再订正错题' })
    if (JSON.parse(previous.result_json || 'null')?.status === 'correct') return res.status(409).json({ error: '这道题已经答对，无需订正' })
  }

  const schedule = scheduleFor(date)
  const results = []
  const wrong = []

  for (const q of questions) {
    const submitted = answers[q.key] || {}
    const r = await gradeOne(q, submitted)
    results.push({ key: q.key, no: q.no, group: q.group, groupTitle: q.groupTitle, ...r, ...(q.kind === 'math' ? { referenceAnswer: q.question.reference, questionVersion: q.question.version, workedSolution: workedSolution(q.question, q.group) } : {}) })
    if (r.status === 'wrong' || r.status === 'partial' || ['wrong', 'partial'].includes(r.processStatus)) {
      wrong.push({ q, submitted, r })
    }
  }

  // 记录每次作答
  const upsert = db.prepare(`
    INSERT INTO attempts (date, subject, question_key, answer_json, correct, score, ai_feedback, created_at, updated_at, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, subject, question_key) DO UPDATE SET
      answer_json = excluded.answer_json,
      correct = excluded.correct,
      score = excluded.score,
      ai_feedback = excluded.ai_feedback,
      updated_at = excluded.updated_at,
      result_json = excluded.result_json
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
      now(),
      JSON.stringify(r)
    )
  }

  // 错题入库
  for (const { q, submitted, r } of wrong) {
    upsertWrongItem({ date, subject, cycle: schedule.cycle, q, submitted, r })
  }

  if (isCorrection) {
    const saved = db.prepare('SELECT question_key, result_json FROM attempts WHERE date = ? AND subject = ?').all(date, subject)
    results.splice(0, results.length, ...allQuestions.map((question) => {
      const row = saved.find((row) => row.question_key === question.key)
      return row?.result_json ? JSON.parse(row.result_json) : null
    }).filter(Boolean))
  }
  const total = results.length
  const correct = results.filter((result) => result.status === 'correct').length
  const pending = results.filter((result) => result.status === 'pending').length
  const wrongCount = results.filter((result) => result.status === 'wrong' || result.status === 'partial').length
  const score = total ? Math.round(results.reduce((sum, result) => sum + Math.max(0, Math.min(10, result.score ?? 0)), 0) / total * 10) : 0

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
    pending,
    score,
    results,
    wrongCount,
  })
})

/**
 * 判一道题。
 * status: 'correct' 确定对了 | 'wrong' 确定错了 | 'pending' 需要 AI 批改但 AI 没连上
 */
export async function gradeOne(q, submitted) {
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
    const reference = { referenceAnswer: q.question.reference || '', explanation: q.question.explanation || '', source: 'local-reference' }
    if (!text.trim()) return { status: 'wrong', correct: false, score: 0, message: '还没有作答，请写下你的想法。', parts: [], ...reference }
    if (!aiEnabled()) {
      return {
        status: 'pending',
        correct: false,
        score: 0,
        message: 'AI 未连接，已提供本地参考答案与讲解，请先对照学习。开放题不只有一种正确表达，暂不自动判分。',
        parts: [],
        pendingAi: true,
        ...reference,
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
        message: 'AI 暂时无法回答，已改用本地参考答案与讲解。可以先对照学习，稍后再提交批改。',
        parts: [],
        pendingAi: true,
        ...reference,
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
  if (q.group === 'word' && graded.parts.length > 0) {
    const ai = text.trim() ? await askAi(mathProcessPrompt({
      question: q.question.prompt,
      reference: q.question.reference,
      answer: text,
      groupTitle: q.groupTitle,
    })) : null
    return {
      status: graded.correct ? 'correct' : 'wrong',
      correct: graded.correct,
      score: graded.score,
      message: ai?.讲解 || graded.message,
      errorReason: ai?.错误原因 || graded.message,
      hint: ai?.订正提示 || '',
      parts: graded.parts,
      ai,
      processStatus: ai ? (ai.判定 === '对' ? 'correct' : ai.判定 === '部分对' ? 'partial' : 'wrong') : null,
      pendingAi: false,
    }
  }
  if (graded.needAi && !graded.parts.length && !text.trim()) return { status: 'wrong', correct: false, score: 0, message: '还没有作答，请写下你的想法。', parts: [] }
  if (graded.needAi && graded.parts.length && !text.trim()) return { status: graded.correct ? 'partial' : 'wrong', correct: false, score: graded.correct ? 5 : graded.score, message: [graded.message, '请补充计算过程或你的想法。'].filter(Boolean).join('；'), parts: graded.parts }
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
    if (!['对', '部分对', '错'].includes(json.判定) || !Number.isFinite(Number(json.得分)) || Number(json.得分) < 0 || Number(json.得分) > 10) return null
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
  const myAnswer = JSON.stringify(submitted)
  const correctAnswer =
    q.kind === 'math'
      ? q.question.reference || (q.question.answer?.parts || []).map((p) => `${p.label}=${p.value ?? ''}`).join('，')
      : q.question.answer || q.question.reference || ''

  const kind = (r.status === 'correct' ? r.processStatus : r.status) === 'partial' ? 'partial' : 'wrong'
  const existing = db
    .prepare('SELECT id FROM wrong_items WHERE date = ? AND subject = ? AND question_key = ?')
    .get(date, subject, q.key)

  if (existing) {
    db.prepare(
      `UPDATE wrong_items SET wrong_count = wrong_count + 1, my_answer = ?, correct_answer = ?,
        reason = ?, explanation = ?, knowledge_point = ?, kind = ?, updated_at = ?, next_review_date = ?, mastery = 0, reviewed_count = 0
       WHERE id = ?`
    ).run(
      myAnswer,
      correctAnswer,
      r.errorReason || r.message || '',
      r.message || '',
      points.join(','),
      kind,
      now(),
      nextReviewDate(todayStr(), 0),
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
      nextReviewDate(todayStr(), 0),
      now(),
      now()
    )
  }
}

/** 简化 SM-2 的间隔：1 / 2 / 4 / 7 / 15 天 */
export function nextReviewDate(fromDate, stage) {
  const steps = [1, 2, 4, 7, 15]
  const days = steps[Math.min(stage, steps.length - 1)]
  const d = new Date(`${fromDate}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function scheduleDay(date) {
  const idx = dayIndex(date)
  return idx >= 1 && idx <= DOCX_DAYS ? idx : null
}

/** 编程作业的记录（收获 / 学到的一件事 / 自查清单） */
router.post('/coding-note', (req, res) => {
  const { date, gain, learned, checklist } = req.body || {}
  if (!scheduleFor(date)) return res.status(400).json({ error: '日期无效' })
  if (!isUnlocked(date)) return res.status(403).json({ error: '只能填写当天的作业' })
  if (!contentFor(date)?.coding) return res.status(400).json({ error: '当天没有编程作业' })
  if ((gain !== undefined && typeof gain !== 'string') || (learned !== undefined && typeof learned !== 'string') || (checklist !== undefined && (!checklist || typeof checklist !== 'object' || Array.isArray(checklist) || Object.values(checklist).some((value) => typeof value !== 'boolean')))) return res.status(400).json({ error: '记录格式不正确' })
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
  if (!isUnlocked(req.params.date)) return res.status(403).json({ error: '只能填写当天的作业' })
  const row = db.prepare('SELECT * FROM coding_notes WHERE date = ?').get(req.params.date)
  res.json(
    row
      ? { date: row.date, gain: row.gain, learned: row.learned, checklist: JSON.parse(row.checklist_json || '{}') }
      : { date: req.params.date, gain: '', learned: '', checklist: {} }
  )
})

router.get('/attempts/:date/:subject', (req, res) => {
  const { date, subject } = req.params
  if (!isUnlocked(date)) return res.status(403).json({ error: '只能填写当天的作业' })
  if (subject === 'chinese' && !mathComplete(date)) return res.status(403).json({ error: '请先完成当天数学作业并订正到全部正确，再开始语文作业', locked: true })
  const rows = db.prepare('SELECT question_key, answer_json, result_json FROM attempts WHERE date = ? AND subject = ?').all(date, subject)
  const progress = db.prepare('SELECT score, total FROM daily_progress WHERE date = ? AND subject = ?').get(date, subject)
  const results = rows.filter((row) => row.result_json).map((row) => JSON.parse(row.result_json))
  res.json({
    answers: Object.fromEntries(rows.map((row) => [row.question_key, JSON.parse(row.answer_json || '{}')])),
    result: results.length ? { date, subject, subjectLabel: SUBJECT_LABEL[subject], total: progress?.total ?? results.length, score: progress?.score ?? 0, correct: results.filter((result) => result.correct).length, pending: results.filter((result) => result.status === 'pending').length, wrongCount: results.filter((result) => ['wrong', 'partial'].includes(result.status)).length, results } : null,
  })
})

router.get(['/english-reading/:date', '/english-reading/:date/line/:index'], (req, res) => {
  if (!isUnlocked(req.params.date)) return res.status(403).json({ error: '只能查看当天的跟读' })
  const line = req.params.index === undefined ? null : /^\d+$/.test(req.params.index) ? Number(req.params.index) : NaN
  if (!readingTarget(req.params.date, line)) return res.status(400).json({ error: '找不到这句英语作业' })
  res.json(readingState(req.params.date, line))
})

router.post(['/english-reading/:date', '/english-reading/:date/line/:index'], (req, res) => {
  const { date } = req.params
  if (!isUnlocked(date)) return res.status(403).json({ error: '只能提交当天的跟读' })
  const line = req.params.index === undefined ? null : /^\d+$/.test(req.params.index) ? Number(req.params.index) : NaN
  const target = readingTarget(date, line)
  if (!target) return res.status(400).json({ error: '找不到这句英语作业' })
  if (line === null && !sentencesPassed(date)) return res.status(409).json({ error: '请先逐句跟读，每句达到 7 分，再录制整段对话' })
  voiceUpload(req, res, async (error) => {
    if (error) return res.status(400).json({ error: '请上传不超过 8 MB 的录音' })
    const mime = req.file?.mimetype?.split(';')[0]
    if (!req.file?.size || !voiceTypes[mime]) return res.status(400).json({ error: '请提供有效的跟读录音' })
    const id = crypto.randomUUID()
    const relative = path.join('voice', date, `${id}.${voiceTypes[mime]}`)
    const destination = path.join(config.dataDir, relative)
    let saved = false
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, req.file.buffer)
      db.prepare("INSERT INTO voice_answers (id, date, question_key, transcript, audio_path, mime_type, created_at) VALUES (?, ?, ?, '', ?, ?, ?)").run(id, date, target.questionKey, relative, mime, now())
      saved = true
      db.prepare("UPDATE daily_progress SET status = 'in_progress', score = NULL WHERE date = ? AND subject = 'english'").run(date)
      const result = await gradeReading(date, id, line)
      res.json({ ...readingState(date, line), result })
    } catch (failure) {
      if (!saved) fs.rmSync(destination, { force: true })
      res.status(failure.status || 502).json({ error: failure.message, recording: saved ? readingState(date, line).recording : null })
    }
  })
})

router.post(['/english-reading/:date/retry', '/english-reading/:date/line/:index/retry'], async (req, res) => {
  if (!isUnlocked(req.params.date)) return res.status(403).json({ error: '只能评估当天的英语作业' })
  const line = req.params.index === undefined ? null : /^\d+$/.test(req.params.index) ? Number(req.params.index) : NaN
  if (!readingTarget(req.params.date, line)) return res.status(400).json({ error: '找不到这句英语作业' })
  if (readingState(req.params.date, line).result) return res.status(409).json({ error: '这段录音已有得分；低于 7 分请重新跟读，不能反复重评旧录音' })
  try {
    const result = await gradeReading(req.params.date, req.body?.voiceId, line)
    res.json({ ...readingState(req.params.date, line), result })
  } catch (failure) { res.status(failure.status || 502).json({ error: failure.message }) }
})

router.post('/english-complete', (req, res) => {
  const { date, completed } = req.body || {}
  if (!scheduleFor(date)) return res.status(400).json({ error: '日期无效' })
  if (!isUnlocked(date)) return res.status(403).json({ error: '只能提交当天的作业' })
  if (!contentFor(date)?.english?.dialogues?.length) return res.status(400).json({ error: '当天没有英语对话作业' })
  if (completed !== true) return res.status(400).json({ error: '请确认已完成今天的对话' })
  if (!sentencesPassed(date)) return res.status(409).json({ error: '请先完成所有分句跟读，每句达到 7 分' })
  const result = readingState(date).result
  if (!result?.passed || result.score < 7) return res.status(409).json({ error: '请先跟读录音并取得 7 分及以上；低于 7 分需要重新跟读' })
  db.prepare("INSERT INTO daily_progress (date, subject, status, submitted_at, score, total) VALUES (?, 'english', 'submitted', ?, ?, 1) ON CONFLICT(date, subject) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at, score = excluded.score, total = 1").run(date, now(), result.score)
  res.json({ ok: true })
})

router.post('/coding-complete', (req, res) => {
  const { date, playtested } = req.body || {}
  if (!scheduleFor(date)) return res.status(400).json({ error: '日期无效' })
  if (!isUnlocked(date)) return res.status(403).json({ error: '只能填写当天的作业' })
  if (!contentFor(date)?.coding) return res.status(400).json({ error: '当天没有编程作业' })
  if (playtested !== true) return res.status(400).json({ error: '请先试玩今天的版本，确认当天功能可以玩。' })
  db.prepare("INSERT INTO daily_progress (date, subject, status, submitted_at, score, total) VALUES (?, 'coding', 'submitted', ?, NULL, 1) ON CONFLICT(date, subject) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at").run(date, now())
  res.json({ ok: true })
})

function referenceUnlocked(project) {
  if (getSetting('referenceUnlocked', false)) return true
  const start = project === 'star' ? 1 : 8
  const end = project === 'star' ? 7 : 14
  return dateOfIndex(end) <= todayStr() && db.prepare("SELECT COUNT(*) AS count FROM daily_progress WHERE subject = 'coding' AND status = 'submitted' AND date BETWEEN ? AND ?").get(dateOfIndex(start), dateOfIndex(end)).count === 7
}

router.get('/references', (req, res) => {
  res.json({ items: ['star', 'space'].map((project) => ({ project, title: project === 'star' ? '星星捕手' : '太空采矿记', unlocked: referenceUnlocked(project), url: `/api/homework/reference/${project}` })) })
})

router.get('/reference/:project', (req, res) => {
  const names = { star: 'homework-star', space: 'homework-space' }
  const name = names[req.params.project]
  if (!name) return res.status(404).json({ error: '找不到这个项目' })
  if (!referenceUnlocked(req.params.project)) return res.status(403).json({ error: '完成这个项目的 7 天编程作业后解锁' })
  const file = path.join(config.root, '参考项目', '小学14天作业_参考项目', name, 'index.html')
  if (!fs.existsSync(file)) return res.status(404).json({ error: '参考项目文件缺失' })
  res.sendFile(file)
})
