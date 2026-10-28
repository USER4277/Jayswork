import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'
import { now } from '../db.js'
import { contentFor, scheduleFor } from '../schedule.js'
import { defaultEnglishStorage, gradeReading, readingState, readingTarget, sentencesPassed, gradeListeningAnswers, listeningState } from '../english-reading.js'

export const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 32 * 1024 } }).single('audio')
export const voiceTypes = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }

export function createEnglishRouter(storage = defaultEnglishStorage) {
  const router = express.Router()
  const { db, dataDir, allowedDate } = storage

  router.get(['/english-reading/:date', '/english-reading/:date/line/:index'], (req, res) => {
    if (!allowedDate(req.params.date)) return res.status(403).json({ error: '当前不能查看这天的跟读' })
    const line = req.params.index === undefined ? null : /^\d+$/.test(req.params.index) ? Number(req.params.index) : NaN
    if (line === null) return res.status(410).json({ error: '整段跟读评分已替换为听音选义测验' })
    if (!readingTarget(req.params.date, line)) return res.status(400).json({ error: '找不到这句英语作业' })
    res.json(readingState(req.params.date, line, storage))
  })

  router.post(['/english-reading/:date', '/english-reading/:date/line/:index'], (req, res) => {
    const { date } = req.params
    if (!allowedDate(date)) return res.status(403).json({ error: '当前不能提交这天的跟读' })
    const line = req.params.index === undefined ? null : /^\d+$/.test(req.params.index) ? Number(req.params.index) : NaN
    if (line === null) return res.status(410).json({ error: '整段跟读评分已替换为听音选义测验' })
    const target = readingTarget(date, line)
    if (!target) return res.status(400).json({ error: '找不到这句英语作业' })
    voiceUpload(req, res, async (error) => {
      if (error) return res.status(400).json({ error: '请上传不超过 8 MB 的录音' })
      const mime = req.file?.mimetype?.split(';')[0]
      if (!req.file?.size || !voiceTypes[mime]) return res.status(400).json({ error: '请提供有效的跟读录音' })
      const id = crypto.randomUUID()
      const relative = path.join('voice', date, `${id}.${voiceTypes[mime]}`)
      const destination = path.join(dataDir, relative)
      let saved = false
      try {
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.writeFileSync(destination, req.file.buffer)
        db.prepare("INSERT INTO voice_answers (id, date, question_key, transcript, audio_path, mime_type, created_at) VALUES (?, ?, ?, '', ?, ?, ?)").run(id, date, target.questionKey, relative, mime, now())
        saved = true
        db.prepare("UPDATE daily_progress SET status = 'in_progress', score = NULL WHERE date = ? AND subject = 'english'").run(date)
        const result = await gradeReading(date, id, line, storage)
        res.json({ ...readingState(date, line, storage), result })
      } catch (failure) {
        if (!saved) fs.rmSync(destination, { force: true })
        res.status(failure.status || 502).json({ error: failure.message, recording: saved ? readingState(date, line, storage).recording : null })
      }
    })
  })

  router.post(['/english-reading/:date/retry', '/english-reading/:date/line/:index/retry'], async (req, res) => {
    if (!allowedDate(req.params.date)) return res.status(403).json({ error: '当前不能评估这天的英语作业' })
    const line = req.params.index === undefined ? null : /^\d+$/.test(req.params.index) ? Number(req.params.index) : NaN
    if (line === null) return res.status(410).json({ error: '整段跟读评分已替换为听音选义测验' })
    if (!readingTarget(req.params.date, line)) return res.status(400).json({ error: '找不到这句英语作业' })
    if (readingState(req.params.date, line, storage).result) return res.status(409).json({ error: '这段录音已有得分；低于 7 分请重新跟读，不能反复重评旧录音' })
    try {
      const result = await gradeReading(req.params.date, req.body?.voiceId, line, storage)
      res.json({ ...readingState(req.params.date, line, storage), result })
    } catch (failure) { res.status(failure.status || 502).json({ error: failure.message }) }
  })

  router.get('/english-listening/:date', (req, res) => {
    const { date } = req.params
    if (!allowedDate(date)) return res.status(403).json({ error: '当前不能查看这天的听音选义测验' })
    if (!readingTarget(date)) return res.status(400).json({ error: '找不到这天的英语作业' })
    res.json(listeningState(date, storage))
  })

  router.post('/english-listening/:date', (req, res) => {
    const { date } = req.params
    if (!allowedDate(date)) return res.status(403).json({ error: '当前不能提交这天的听音选义测验' })
    const answers = req.body?.answers
    const result = gradeListeningAnswers(date, answers)
    if (!result) return res.status(400).json({ error: '请为每道题选择一个有效的中文含义' })
    const stamp = now()
    db.prepare("INSERT INTO attempts (date, subject, question_key, answer_json, correct, score, created_at, updated_at, result_json) VALUES (?, 'english', 'listening-meaning', ?, ?, ?, ?, ?, ?) ON CONFLICT(date, subject, question_key) DO UPDATE SET answer_json = excluded.answer_json, correct = excluded.correct, score = excluded.score, updated_at = excluded.updated_at, result_json = excluded.result_json").run(date, JSON.stringify(answers), result.passed ? 1 : 0, result.score, stamp, stamp, JSON.stringify(result))
    db.prepare("UPDATE daily_progress SET status = 'in_progress', score = NULL WHERE date = ? AND subject = 'english'").run(date)
    res.json(listeningState(date, storage))
  })

  router.post('/english-complete', (req, res) => {
    const { date, completed } = req.body || {}
    if (!scheduleFor(date)) return res.status(400).json({ error: '日期无效' })
    if (!allowedDate(date)) return res.status(403).json({ error: '当前不能提交这天的作业' })
    if (!contentFor(date)?.english?.dialogues?.length) return res.status(400).json({ error: '当天没有英语对话作业' })
    if (completed !== true) return res.status(400).json({ error: '请确认已完成今天的对话' })
    if (!sentencesPassed(date, storage)) return res.status(409).json({ error: '请先完成所有分句跟读，每句达到 7 分' })
    const result = listeningState(date, storage).result
    if (!result?.passed || result.score < 7) return res.status(409).json({ error: '请先完成听音选义测验并取得 7 分及以上' })
    db.prepare("INSERT INTO daily_progress (date, subject, status, submitted_at, score, total) VALUES (?, 'english', 'submitted', ?, ?, 1) ON CONFLICT(date, subject) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at, score = excluded.score, total = 1").run(date, now(), result.score)
    res.json({ ok: true })
  })
  return router
}