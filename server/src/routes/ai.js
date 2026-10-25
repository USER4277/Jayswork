import express from 'express'
import { db, now } from '../db.js'
import { chat, chatJson, streamChat, AiError } from '../ai.js'
import { tutorPrompt, englishPrompt, weeklySummaryPrompt } from '../prompts.js'
import { loadGraph } from '../content.js'
import { aiEnabled } from '../config.js'

export const router = express.Router()

/** AI 是否可用 */
router.get('/status', (req, res) => {
  res.json({ enabled: aiEnabled() })
})

/**
 * 问 AI（SSE 流式）。
 * body: { question, topicId }
 */
router.post('/chat', async (req, res) => {
  const { question, topicId } = req.body || {}
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: '问题不能为空' })
  }
  if (!aiEnabled()) {
    return res.status(503).json({ error: '还没有配置 AI（MINIMAX_API_KEY），先看看本地参考答案吧' })
  }

  let knowledge = null
  if (topicId) {
    const g = loadGraph('math')
    knowledge = g.topics.find((t) => t.id === topicId) || null
  }
  const wrong = db
    .prepare(
      `SELECT question_text, my_answer, correct_answer FROM wrong_items
       WHERE mastery = 0 ORDER BY updated_at DESC LIMIT 5`
    )
    .all()

  const messages = tutorPrompt({ question, knowledge, wrongItems: wrong })

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    let full = ''
    for await (const chunk of streamChat(messages, { temperature: 0.6, maxTokens: 900 })) {
      full += chunk
      send('delta', { text: chunk })
    }
    db.prepare('INSERT INTO chat_messages (role, content, context_json, created_at) VALUES (?, ?, ?, ?)').run(
      'user',
      String(question),
      JSON.stringify({ topicId: topicId || null }),
      now()
    )
    db.prepare('INSERT INTO chat_messages (role, content, context_json, created_at) VALUES (?, ?, ?, ?)').run(
      'assistant',
      full,
      JSON.stringify({ topicId: topicId || null }),
      now()
    )
    send('done', { ok: true })
  } catch (err) {
    const msg = err instanceof AiError ? err.message : 'AI 出错了，请再试一次'
    send('error', { error: msg })
  } finally {
    res.end()
  }
})

/** 最近的答疑记录 */
router.get('/chat/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100)
  const rows = db
    .prepare('SELECT role, content, created_at FROM chat_messages ORDER BY id DESC LIMIT ?')
    .all(limit)
  res.json(rows.reverse())
})

/**
 * 英语跟读评分（把录音转写结果交给 AI 判）。
 * body: { sentence, translation, answer }
 */
router.post('/english-grade', async (req, res) => {
  const { sentence, translation, answer } = req.body || {}
  if (!aiEnabled()) return res.status(503).json({ error: '还没有配置 AI' })
  try {
    const json = await chatJson(
      englishPrompt({ sentence, translation, answer }),
      { temperature: 0.2, maxTokens: 800 }
    )
    res.json(json)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

/**
 * 生成某个 7 天周期的小结（家长向）。
 */
router.post('/weekly-summary', async (req, res) => {
  const { cycle, start, end } = req.body || {}
  if (!cycle) return res.status(400).json({ error: '缺少周期号' })
  if (!aiEnabled()) return res.status(503).json({ error: '还没有配置 AI' })

  const rows = db
    .prepare(
      `SELECT a.subject, a.question_key, a.correct, w.question_text, w.my_answer,
              w.correct_answer, w.reason
       FROM wrong_items w
       LEFT JOIN attempts a ON a.date = w.date AND a.subject = w.subject AND a.question_key = w.question_key
       WHERE w.cycle = ?`
    )
    .all(cycle)

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(correct) AS ok FROM attempts
       WHERE date BETWEEN ? AND ?`
    )
    .get(start, end)

  const byGroup = {}
  for (const r of rows) {
    const g = r.question_key.split('-')[0]
    byGroup[g] = byGroup[g] || { total: 0, correct: 0 }
    byGroup[g].total++
  }

  try {
    const json = await chatJson(
      weeklySummaryPrompt({
        cycle,
        cycleRange: { start, end },
        stats: {
          total: totalRow.total || 0,
          correct: totalRow.ok || 0,
          rate: totalRow.total ? Math.round(((totalRow.ok || 0) / totalRow.total) * 100) : 0,
          byGroup,
        },
        wrongItems: rows,
      }),
      { temperature: 0.4, maxTokens: 1000 }
    )
    db.prepare('INSERT INTO chat_messages (role, content, context_json, created_at) VALUES (?, ?, ?, ?)').run(
      'assistant',
      JSON.stringify(json),
      JSON.stringify({ kind: 'weekly-summary', cycle }),
      now()
    )
    res.json(json)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})
