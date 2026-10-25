import express from 'express'
import { loadGraph, loadStandards } from '../content.js'
import { extractNumber } from '../grading.js'

export const router = express.Router()

/**
 * 知识点图谱。
 * GET /api/graph/topics?subject=math&maxGrade=2
 */
router.get('/topics', (req, res) => {
  const subject = req.query.subject || 'math'
  const maxGrade = Number(req.query.maxGrade || 6)
  const g = loadGraph(subject)

  const topics = g.topics.filter((t) => (t.grade || 99) <= maxGrade)
  const ids = new Set(topics.map((t) => t.id))
  const dependencies = g.dependencies.filter(
    (e) => ids.has(e.topicId) && ids.has(e.prerequisiteId)
  )

  res.json({
    subject,
    maxGrade,
    topics: topics.map((t) => ({
      id: t.id,
      name: t.name,
      domain: t.domain,
      grade: t.grade,
      semester: t.semester,
      chapter: t.chapter,
      type: t.type,
      description: t.description,
    })),
    dependencies: dependencies.map((e) => ({
      source: e.prerequisiteId,
      target: e.topicId,
      strength: e.strength,
      reason: e.reason,
    })),
  })
})

/** 单个知识点详情 + 它的题 */
router.get('/topic/:id', (req, res) => {
  const { id } = req.params
  const subject = req.query.subject || 'math'
  const g = loadGraph(subject)
  const topic = g.topics.find((t) => t.id === id)
  if (!topic) return res.status(404).json({ error: '找不到这个知识点' })

  const prereqs = g.dependencies
    .filter((e) => e.topicId === id)
    .map((e) => ({
      id: e.prerequisiteId,
      strength: e.strength,
      reason: e.reason,
      name: g.topics.find((t) => t.id === e.prerequisiteId)?.name || e.prerequisiteId,
    }))
  const unlocks = g.dependencies
    .filter((e) => e.prerequisiteId === id)
    .map((e) => ({
      id: e.topicId,
      strength: e.strength,
      reason: e.reason,
      name: g.topics.find((t) => t.id === e.topicId)?.name || e.topicId,
    }))
  const questions = g.questions.filter((q) => q.topicId === id)

  res.json({
    topic: {
      id: topic.id,
      name: topic.name,
      domain: topic.domain,
      grade: topic.grade,
      semester: topic.semester,
      chapter: topic.chapter,
      type: topic.type,
      description: topic.description,
      masteryCriteria: topic.mastery_criteria || [],
      diagnostic: topic.diagnostic_question || null,
      standards: topic.standards || [],
    },
    prerequisites: prereqs,
    unlocks,
    questions: questions.map((q) => ({
      id: q.id,
      type: q.type,
      difficulty: q.difficulty,
      prompt: q.prompt,
      choices: (q.choices || []).map((c) => ({ key: c.key, text: c.text })),
      explanation: q.explanation,
    })),
  })
})

/**
 * 判一道「练一练」的题。
 * body: { questionId, answer }
 */
router.post('/practice', (req, res) => {
  const { questionId, answer } = req.body || {}
  const subject = req.body?.subject || 'math'
  const g = loadGraph(subject)
  const q = g.questions.find((x) => x.id === questionId)
  if (!q) return res.status(404).json({ error: '找不到这道题' })

  let correct = false
  if (q.type === 'choice') {
    correct = String(answer || '').trim() === String(q.answer || '').trim()
  } else {
    const num = extractNumber(answer)
    const want = extractNumber(q.answer)
    correct = num !== null && want !== null && num === want
  }

  res.json({
    id: q.id,
    correct,
    expected: q.answer,
    explanation: q.explanation || '',
  })
})

/** 课标条目 */
router.get('/standards', (req, res) => {
  const all = loadStandards()
  const id = req.query.id
  if (id) {
    const found = all.filter((s) => s.id === id)
    return res.json(found)
  }
  res.json(all.slice(0, 200))
})
