import test from 'node:test'
import assert from 'node:assert/strict'
import { scheduleFor, dateOfIndex } from '../src/schedule.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadRazLibrary, publicBook, razAsset, razAudioType } from '../src/raz-library.js'
import { gradeRazQuestions, publicQuestions, parseOriginalQuiz } from '../src/raz-content.js'
import { DatabaseSync } from 'node:sqlite'
import { createRazCourse } from '../src/raz-course.js'
import express from 'express'
import { createRazRouter } from '../src/routes/raz.js'

test('English continues on alternating dates independently of finite homework', () => {
  for (const index of [30, 60, 366, 1000]) {
    const schedule = scheduleFor(dateOfIndex(index))
    assert.equal(schedule.languageSubject, 'english')
    assert.equal(schedule.languageIndex, index / 2)
    assert.equal(schedule.status, 'ready')
    assert.equal(schedule.mathDay, null)
    assert.equal(schedule.codingDay, null)
  }
  assert.equal(scheduleFor(dateOfIndex(31)).status, 'pending')
})

test('RAZ grading validates canonical options and does not expose answer keys', () => {
  const questions = [{ id: 'one', prompt: 'test', options: [{ id: 'A', text: 'first' }, { id: 'B', text: 'second' }], answer: 'B' }]
  assert.equal(gradeRazQuestions(questions, { one: 'B' }).score, 100)
  assert.equal(gradeRazQuestions(questions, { one: 'A' }).score, 0)
  assert.equal(gradeRazQuestions(questions, { one: 'injected', score: 100 }), null)
  assert.equal(gradeRazQuestions(questions, {}), null)
  assert.equal('answer' in publicQuestions(questions)[0], false)
})

test('original side-by-side choices are paired with the teacher answer sheet', () => {
  const item = (str, left, height) => ({ str, transform: [1, 0, 0, 1, left, height] })
  const pages = [
    { width: 612, text: 'Quick Check', items: [item('1', 48, 630), item('What is yellow?', 78, 630), item('A', 78, 590), item('broccoli', 102, 593), item('B', 324, 590), item('corn', 348, 593)] },
    { width: 612, text: 'Quick Check Answer Sheet', items: [item('1', 48, 630), item('B', 78, 630), item('corn', 100, 630)] },
  ]
  const questions = parseOriginalQuiz(pages)
  assert.equal(questions.length, 1)
  assert.equal(questions[0].answer, 'B')
  assert.deepEqual(questions[0].options, [{ id: 'A', text: 'broccoli' }, { id: 'B', text: 'corn' }])
  pages[1].items = [item('1', 48, 630), item('What is yellow?', 78, 630), item('B', 78, 600), item('corn', 102, 600)]
  assert.equal(parseOriginalQuiz(pages)[0].answer, 'B')
})

test('RAZ catalog pairs ordinary books with original audio and protects teacher files and paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raz-catalog-'))
  try {
    for (const [filename, value] of [
      ['Level AA/AA绘本pdf/01 - The Zoo_Password_Removed.pdf', 'book'],
      ['Level AA/AA绘本pdf/02 - No Audio.pdf', 'book'],
      ['Level AA/音频/原版音频/01_The Zoo.mp3', 'audio'],
      ['Level AA/Peggy老师/01_The Zoo.mp3', Buffer.from([255, 241, 80, 128, 1, 2, 3])],
      ['Level AA/音频/aa全集音频.mp3', 'compilation'],
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true })
      fs.writeFileSync(path.join(root, filename), value)
    }
    const library = loadRazLibrary(root)
    assert.equal(library.books.length, 2)
    const book = library.books.find(book => book.title === 'The Zoo')
    assert.equal(book.ready, true)
    assert.equal(library.issues.length, 1)
    assert.equal('assets' in publicBook(book), false)
    assert.equal(publicBook(book).hasTeacherAudio, true)
    assert.equal(razAudioType(razAsset(library, root, book.id, 'teacherAudio')), 'audio/aac')
    assert.equal(razAudioType(razAsset(library, root, book.id, 'audio')), 'audio/mpeg')
    assert.equal(razAsset(library, root, book.id, 'quiz'), null)
    assert.equal(razAsset(library, root, '../outside', 'book'), null)
    assert.ok(razAsset(library, root, book.id, 'audio').endsWith('01_The Zoo.mp3'))
    const previousId = book.id
    assert.equal(loadRazLibrary(root, true).books.find(book => book.title === 'The Zoo').id, previousId)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('RAZ lessons freeze, resume, preserve first scores, and schedule spaced reviews independently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raz-course-'))
  const database = new DatabaseSync(':memory:')
  database.exec('CREATE TABLE daily_progress(date TEXT, subject TEXT, status TEXT, submitted_at TEXT, score REAL, total REAL, PRIMARY KEY(date,subject))')
  try {
    for (const filename of ['Level AA/AA绘本pdf/01 - The Zoo.pdf', 'Level AA/音频/原版音频/01_The Zoo.mp3', 'Level AA/AA绘本pdf/02 - My Family.pdf', 'Level AA/音频/原版音频/02_My Family.mp3']) {
      fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true })
      fs.writeFileSync(path.join(root, filename), 'fixture')
    }
    const questions = [1, 2, 3].map(index => ({ id: `question-${index}`, prompt: 'fixture', options: [{ id: 'A', text: 'first' }, { id: 'B', text: 'second' }], answer: 'B' }))
    const course = createRazCourse({ database, resourceRoot: root, loadLesson: async () => ({ pages: 12, parts: 1, duration: 30, wordCount: 16, questions, source: 'original', reflectionPrompt: '说说内容' }) })
    assert.equal((await course.state('2026-10-29')).mode, 'placement')
    await assert.rejects(() => course.place('2026-10-29', 1, {}), /状态已变化/)
    const placement = await course.place('2026-10-29', 0, Object.fromEntries(questions.map(question => [question.id, 'A'])))
    assert.equal(placement.profile.level, 'AA')
    const initial = await course.state('2026-10-29')
    assert.ok(initial.lesson.questions.every(question => !('answer' in question)))
    assert.throws(() => course.complete('2026-10-29'), /原声听读/)
    course.update('2026-10-29', { page: 12, listened: true, reflection: '我认识了新的词语' })
    const resumed = await course.state('2026-10-31')
    assert.equal(resumed.lesson.resumedFrom, '2026-10-29')
    assert.equal(resumed.lesson.values.page, 12)
    const wrong = Object.fromEntries(resumed.lesson.questions.map(question => [question.id, 'A']))
    course.update('2026-10-31', { answers: { [resumed.lesson.questions[0].id]: 'A' } })
    assert.equal((await course.state('2026-10-31')).lesson.answers[resumed.lesson.questions[0].id], 'A')
    assert.throws(() => course.update('2026-10-31', { answers: { injected: 'A' } }), /无效选项/)
    course.quiz('2026-10-31', wrong)
    course.quiz('2026-10-31', Object.fromEntries(resumed.lesson.questions.map(question => [question.id, 'B'])))
    assert.equal(course.internal('2026-10-31').firstScore, 0)
    course.complete('2026-10-31')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM raz_reviews').get().count, 4)
    assert.equal(database.prepare("SELECT status FROM daily_progress WHERE date = '2026-10-31'").get().status, 'submitted')
    assert.equal((await course.state('2026-10-31')).lesson.completed, true)
    assert.throws(() => course.quiz('2026-10-31', wrong), /已经完成/)
    const next = await course.state('2026-11-02')
    assert.notEqual(next.lesson.book.id, resumed.lesson.book.id)
    assert.ok(next.lesson.questions.some(question => question.id.startsWith('review-')))
    assert.deepEqual((await course.state('2026-11-02')).lesson, next.lesson)
    course.update('2026-11-02', { page: 12, listened: true, reflection: '继续学习和复习' })
    course.quiz('2026-11-02', Object.fromEntries(next.lesson.questions.map(question => [question.id, 'A'])))
    course.quiz('2026-11-02', Object.fromEntries(next.lesson.questions.map(question => [question.id, 'B'])))
    course.complete('2026-11-02')
    assert.equal(database.prepare('SELECT score FROM raz_reviews WHERE completed_at IS NOT NULL LIMIT 1').get().score, 0)
    const later = await course.state('2026-11-08')
    assert.equal(later.lesson.kind, 'review')
    const titles = [...new Set(later.lesson.questions.map(question => question.bookTitle))]
    for (const title of titles) assert.ok(later.lesson.questions.filter(question => question.bookTitle === title).length <= 2)
  } finally { database.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('RAZ HTTP routes enforce dates, hide answers, and serve only assigned media with range support', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raz-http-'))
  const database = new DatabaseSync(':memory:')
  let server
  try {
    database.exec('CREATE TABLE daily_progress(date TEXT, subject TEXT, status TEXT, submitted_at TEXT, score REAL, total REAL, PRIMARY KEY(date,subject))')
    for (const filename of ['Level AA/AA绘本pdf/01 - The Zoo.pdf', 'Level AA/音频/原版音频/01_The Zoo.mp3']) {
      fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true })
      fs.writeFileSync(path.join(root, filename), '0123456789')
    }
    const questions = [1, 2, 3].map(index => ({ id: `question-${index}`, prompt: 'fixture', options: [{ id: 'A', text: 'first' }, { id: 'B', text: 'second' }], answer: 'B' }))
    const { router } = createRazRouter({ db: database, dataDir: root, resourceRoot: root, allowedDate: date => date === '2026-10-29', loadLesson: async () => ({ pages: 12, parts: 1, duration: 30, questions }) })
    const app = express()
    app.use(express.json())
    app.use('/raz', router)
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/raz`
    assert.equal((await fetch(`${base}/2026-10-31`)).status, 403)
    assert.equal((await fetch(`${base}/2026-10-28`)).status, 400)
    const initial = await (await fetch(`${base}/2026-10-29`)).json()
    assert.equal(initial.mode, 'placement')
    assert.ok(initial.placement.questions.every(question => !('answer' in question)))
    const id = initial.placement.book.id
    const media = await fetch(`${base}/2026-10-29/assets/${id}/audio`, { headers: { Range: 'bytes=0-3' } })
    assert.equal(media.status, 206)
    assert.equal(await media.text(), '0123')
    assert.equal((await fetch(`${base}/2026-10-29/assets/${id}/quiz`)).status, 404)
    assert.equal((await fetch(`${base}/2026-10-29/assets/not-assigned/book`)).status, 404)
    const post = (url, body, method = 'POST') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await post('/2026-10-29/placement', { index: 0, answers: {}, score: 100 })).status, 400)
    const placement = await (await post('/2026-10-29/placement', { index: 0, answers: Object.fromEntries(questions.map(question => [question.id, 'A'])), score: 100 })).json()
    assert.equal(placement.profile.level, 'AA')
    await fetch(`${base}/2026-10-29`)
    assert.equal((await post('/2026-10-29/complete', { listened: true, completed: true, score: 100 })).status, 409)
  } finally { if (server) await new Promise(resolve => server.close(resolve)); database.close(); fs.rmSync(root, { recursive: true, force: true }) }
})