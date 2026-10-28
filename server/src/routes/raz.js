import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'
import { createRazCourse } from '../raz-course.js'
import { razAsset, razAudioType } from '../raz-library.js'
import { config } from '../config.js'
import { scheduleFor } from '../schedule.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } }).single('audio')
const audioTypes = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }
const handle = action => (req, res, next) => Promise.resolve().then(() => action(req, res)).catch(error => error.status ? res.status(error.status).json({ error: error.message }) : next(error))

export function createRazRouter(storage) {
  const router = express.Router()
  const resourceRoot = storage.resourceRoot || config.razDir
  const course = storage.course || createRazCourse({ database: storage.db, resourceRoot, loadLesson: storage.loadLesson })
  router.use('/:date', (req, res, next) => {
    const schedule = scheduleFor(req.params.date)
    if (!schedule || schedule.languageSubject !== 'english' || !schedule.languageIndex) return res.status(400).json({ error: '请选择安排英语学习的日期' })
    if (!storage.allowedDate(req.params.date)) return res.status(403).json({ error: '只能学习当天的英语课程；其他日期请使用家长测试' })
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.get('/:date', handle(async (req, res) => res.json(await course.state(req.params.date))))
  router.post('/:date/placement', handle(async (req, res) => res.json(await course.place(req.params.date, req.body?.index, req.body?.answers))))
  router.patch('/:date/progress', handle((req, res) => res.json(course.update(req.params.date, req.body || {}))))
  router.post('/:date/quiz', handle((req, res) => res.json(course.quiz(req.params.date, req.body?.answers))))
  router.post('/:date/complete', handle((req, res) => res.json(course.complete(req.params.date))))
  router.get('/:date/assets/:id/:kind', handle(async (req, res) => {
    const state = await course.state(req.params.date)
    const bookId = state.mode === 'placement' ? state.placement.book.id : state.lesson.book.id
    if (bookId !== req.params.id) return res.status(404).json({ error: '该资源不属于当前课程' })
    const filename = razAsset(course.library(), resourceRoot, req.params.id, req.params.kind)
    if (!filename) return res.status(404).json({ error: '课程资源缺失，请在家长区重新检查资源' })
    res.set('X-Content-Type-Options', 'nosniff')
    res.type(req.params.kind === 'book' ? 'application/pdf' : req.params.kind === 'video' ? 'video/mp4' : razAudioType(filename))
    res.sendFile(filename)
  }))
  router.post('/:date/output', (req, res, next) => {
    upload(req, res, error => {
      if (error) return res.status(400).json({ error: '请上传不超过 8 MB 的录音' })
      const mime = req.file?.mimetype?.split(';')[0]
      if (!req.file?.size || !audioTypes[mime]) return res.status(400).json({ error: '录音格式不支持' })
      const lesson = course.internal(req.params.date)
      if (!lesson || lesson.completed) return res.status(409).json({ error: '请先加载尚未完成的课程' })
      const id = crypto.randomUUID()
      const relative = path.join('voice', req.params.date, `${id}.${audioTypes[mime]}`)
      const filename = path.join(storage.dataDir, relative)
      try {
        fs.mkdirSync(path.dirname(filename), { recursive: true })
        fs.writeFileSync(filename, req.file.buffer, { mode: 0o600 })
        storage.db.prepare('INSERT INTO voice_answers(id,date,question_key,transcript,audio_path,mime_type,created_at) VALUES (?,?,?,?,?,?,?)').run(id, req.params.date, `raz-${lesson.book.id}-${lesson.part}`, '', relative, mime, new Date().toISOString())
        course.output(req.params.date, id)
        res.json({ id })
      } catch (failure) { fs.rmSync(filename, { force: true }); next(failure) }
    })
  })
  router.get('/:date/output/:id', handle((req, res) => {
    const lesson = course.internal(req.params.date)
    const voice = lesson?.outputId === req.params.id ? storage.db.prepare('SELECT * FROM voice_answers WHERE id = ?').get(req.params.id) : null
    if (!voice) return res.status(404).json({ error: '找不到这次课程的表达录音' })
    res.type(voice.mime_type)
    res.set('X-Content-Type-Options', 'nosniff')
    res.sendFile(path.resolve(storage.dataDir, voice.audio_path))
  }))
  return { router, course }
}