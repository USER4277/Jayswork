import { after, before, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { DatabaseSync } from 'node:sqlite'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jayswork-test-'))
process.env.DATA_DIR = directory
process.env.PREVIEW = '1'
process.env.MINIMAX_API_KEY = ''
const { router: homework, gradeOne, collectQuestions } = await import('../src/routes/homework.js')
const { router: parent } = await import('../src/routes/parent.js')
const { router: review } = await import('../src/routes/review.js')
const { router: watch } = await import('../src/routes/watch.js')
const { router: graph } = await import('../src/routes/graph.js')
const { router: ai } = await import('../src/routes/ai.js')
const { loadGraph, loadHomework } = await import('../src/content.js')
const { db, backupDatabase } = await import('../src/db.js')
const { todayStr } = await import('../src/schedule.js')
const { config, defaultDataDir } = await import('../src/config.js')
let server
let base

before(async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 26, 12).getTime() })
  const app = express()
  app.use(express.json())
  app.use('/api/homework', homework)
  app.use('/api/parent', parent)
  app.use('/api/review', review)
  app.use('/api/watch', watch)
  app.use('/api/graph', graph)
  app.use('/api/ai', ai)
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api`
})

beforeEach(() => mock.timers.setTime(new Date(2026, 9, 26, 12).getTime()))

after(async () => {
  mock.timers.reset()
  await new Promise((resolve) => server.close(resolve))
  db.close()
  fs.rmSync(directory, { recursive: true, force: true })
})

async function request(endpoint, body, options = {}) {
  const response = await fetch(base + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...options,
  })
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

function completeMath(date) {
  const stamp = new Date().toISOString()
  for (const question of collectQuestions(date, 'math')) {
    const result = { key: question.key, status: 'correct', correct: true, score: 10, parts: [], questionVersion: question.question.version }
    db.prepare("INSERT OR REPLACE INTO attempts (date, subject, question_key, answer_json, correct, score, created_at, updated_at, result_json) VALUES (?, 'math', ?, '{}', 1, 10, ?, ?, ?)").run(date, question.key, stamp, stamp, JSON.stringify(result))
  }
}

test('default data stays outside application code and existing data is never silently replaced', () => {
  const base = path.join(directory, 'profile')
  const legacy = path.join(directory, 'legacy')
  assert.equal(defaultDataDir(base, legacy), path.join(base, 'data'))
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'app.db'), 'legacy')
  assert.throws(() => defaultDataDir(base, legacy), /DATA_DIR/)
  fs.mkdirSync(path.join(base, 'preview'), { recursive: true })
  fs.writeFileSync(path.join(base, 'preview', 'app.db'), 'existing')
  assert.equal(defaultDataDir(base, legacy), path.join(base, 'preview'))
  fs.mkdirSync(path.join(base, 'data'), { recursive: true })
  fs.writeFileSync(path.join(base, 'data', 'app.db'), 'existing')
  assert.equal(defaultDataDir(base, legacy), path.join(base, 'data'))
})

test('database snapshots include WAL writes and remain independent of live changes', () => {
  db.prepare("INSERT INTO settings (k, v) VALUES ('snapshot-test', 'original')").run()
  const destination = backupDatabase()
  db.prepare("UPDATE settings SET v = 'changed' WHERE k = 'snapshot-test'").run()
  const snapshot = new DatabaseSync(destination, { readOnly: true })
  try {
    assert.equal(snapshot.prepare("SELECT v FROM settings WHERE k = 'snapshot-test'").get().v, 'original')
    assert.equal(Object.values(snapshot.prepare('PRAGMA integrity_check').get())[0], 'ok')
    assert.ok(destination.startsWith(path.join(directory, 'backups')))
    assert.ok(!fs.readdirSync(path.dirname(destination)).some((name) => name.endsWith('.partial')))
  } finally { snapshot.close(); db.prepare("DELETE FROM settings WHERE k = 'snapshot-test'").run() }
})

test('parent APIs require login and logout revokes the cookie', async () => {
  assert.equal((await request('/parent/answers')).status, 401)
  assert.equal((await request('/parent/settings')).status, 401)
  const login = await request('/parent/login', { pin: '0000' })
  assert.equal(login.data.ok, true)
  const headers = { Cookie: login.cookie }
  assert.equal((await request('/parent/answers', undefined, { headers })).data.length, 14)
  await request('/parent/logout', {}, { headers })
  assert.equal((await request('/parent/settings', undefined, { headers })).status, 401)
})

test('repeated wrong submissions update the same wrong item without failing', async () => {
  const submission = { date: '2026-10-26', subject: 'math', answers: { 'arith-1': { parts: [{ value: '999' }] } } }
  const first = await request('/homework/submit', submission)
  const second = await request('/homework/submit', submission)
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.ok(first.data.results.every((result) => typeof result.referenceAnswer === 'string' && result.referenceAnswer.trim()))
  const row = db.prepare("SELECT * FROM wrong_items WHERE question_key = 'arith-1'").get()
  assert.equal(row.wrong_count, 2)
  assert.equal(row.kind, 'wrong')
  assert.ok(row.next_review_date > todayStr())
})

test('homework dates and malformed submissions are validated', async () => {
  assert.equal((await request('/homework/date/2026-02-30')).status, 404)
  assert.equal((await request('/homework/submit', { date: 'nonsense', subject: 'math', answers: {} })).status, 400)
  assert.equal((await request('/homework/submit', { date: '2026-10-26', subject: 'math', answers: { q: { parts: 'bad' } } })).status, 400)
  const calendar = await request('/homework/calendar')
  assert.equal(calendar.data.items.length, 28)
  assert.equal(calendar.data.items[0].date, '2026-10-26')
  const before = await request('/homework/today?date=2026-10-25')
  assert.equal(before.status, 200)
  assert.equal(before.data.schedule, null)
})

test('saved homework answers and grading results can be restored', async () => {
  const response = await request('/homework/attempts/2026-10-26/math')
  assert.equal(response.data.answers['arith-1'].parts[0].value, '999')
  assert.equal(response.data.result.results.length, 10)
})

test('review grades real answers and schedules from today rather than homework date', async () => {
  const row = db.prepare("SELECT id FROM wrong_items WHERE question_key = 'arith-1'").get()
  assert.equal((await request(`/review/wrong/${row.id}/retry`, { correct: true })).status, 400)
  assert.equal((await request(`/review/wrong/${row.id}/retry`, { answer: '4,999' })).status, 400)
  const right = await request(`/review/wrong/${row.id}/retry`, { answer: '4' })
  assert.equal(right.data.correct, true)
  assert.ok(right.data.nextReviewDate > todayStr())
  const wrong = await request(`/review/wrong/${row.id}/retry`, { answer: '5' })
  assert.equal(wrong.data.correct, false)
  assert.equal(db.prepare('SELECT reviewed_count FROM wrong_items WHERE id = ?').get(row.id).reviewed_count, 0)
})

test('all 14 coding days have playable feature milestones without implementation guides', () => {
  const days = loadHomework().days
  assert.equal(days.length, 14)
  for (const day of days) {
    assert.ok(day.coding.goal)
    assert.equal(day.coding.features.length, 3)
    assert.ok(day.coding.features.every((feature) => feature.trim().length > 8))
    assert.ok(day.coding.playtest.length > 15)
    assert.deepEqual(day.coding.steps, [])
    assert.deepEqual(day.coding.prompts, [])
    assert.equal(day.coding.readFirst, '')
    assert.equal(day.coding.projectTitle, day.day <= 7 ? '星星捕手' : '太空采矿记')
  }
})

test('coding completion requires playtesting rather than writing notes and preserves existing notes', async () => {
  assert.equal((await request('/homework/coding-complete', { date: '2026-10-26' })).status, 400)
  await request('/homework/coding-note', { date: '2026-10-26', gain: '完成了设计', learned: '先设计再实现', checklist: { '1': true } })
  assert.equal((await request('/homework/coding-complete', { date: '2026-10-26', playtested: true })).status, 200)
  assert.equal((await request('/homework/coding-note/2026-10-26')).data.gain, '完成了设计')
  const overview = await request('/homework/today?date=2026-10-26')
  assert.ok(overview.data.progress.some((progress) => progress.subject === 'coding' && progress.status === 'submitted'))
  assert.equal((await request('/homework/references')).data.items[0].unlocked, false)
  mock.timers.setTime(new Date(2026, 9, 27, 12).getTime())
  assert.equal((await request('/homework/coding-complete', { date: '2026-10-27', playtested: true })).status, 200)
  assert.equal(db.prepare("SELECT * FROM coding_notes WHERE date = '2026-10-27'").get(), undefined)
})

test('report applies the selected range to progress and cycle statistics', async () => {
  const report = await request('/review/report?from=2026-11-01&to=2026-11-30')
  assert.equal(report.data.subjects.length, 0)
  assert.equal(report.data.progress.length, 0)
  assert.equal(report.data.wrongByCycle.length, 0)
})

test('recording upload validates token, order, finalization and parent playback', async () => {
  const session = (await request('/watch/sessions', { date: '2026-10-26' })).data
  const endpoint = `${base}/watch/recordings/${session.sessionId}/chunk`
  assert.equal((await fetch(`${endpoint}?index=0`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'video' })).status, 401)
  const headers = { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${session.uploadToken}` }
  assert.equal((await fetch(`${endpoint}?index=1`, { method: 'POST', headers, body: 'wrong order' })).status, 409)
  assert.equal((await fetch(`${endpoint}?index=0`, { method: 'POST', headers, body: 'first' })).status, 200)
  assert.equal((await fetch(`${endpoint}?index=1&final=1`, { method: 'POST', headers, body: 'last' })).status, 200)
  assert.equal((await fetch(`${endpoint}?index=2`, { method: 'POST', headers, body: 'extra' })).status, 409)
  assert.equal(fs.readFileSync(path.join(directory, 'recordings', '2026-10-26', `${session.sessionId}.webm`), 'utf8'), 'firstlast')
  const login = await request('/parent/login', { pin: '0000' })
  const playback = await fetch(`${base}/parent/recordings/2026-10-26/${session.sessionId}.webm`, { headers: { Cookie: login.cookie } })
  assert.equal(playback.status, 200)
  assert.equal(await playback.text(), 'firstlast')
})

test('all three graph subjects have valid references, details and working practice grading', async () => {
  for (const subject of ['math', 'chinese', 'english']) {
    const data = loadGraph(subject)
    const ids = new Set(data.topics.map((topic) => topic.id))
    assert.ok(data.dependencies.every((edge) => ids.has(edge.topicId) && ids.has(edge.prerequisiteId)))
    const list = await request(`/graph/topics?subject=${subject}&maxGrade=6`)
    assert.equal(list.data.topics.length, data.topics.length)
    const topic = data.topics[0]
    const detail = await request(`/graph/topic/${topic.id}?subject=${subject}`)
    assert.equal(detail.data.questions.length, 4)
    const question = data.questions.find((question) => question.topicId === topic.id)
    const graded = await request('/graph/practice', { subject, questionId: question.id, answer: question.answer })
    assert.equal(graded.data.correct, true)
  }
  assert.equal((await request('/graph/topics?subject=toString')).status, 400)
})

test('all 42 Chinese questions provide offline answers and explanations and restore saved feedback', async () => {
  const calendar = (await request('/homework/calendar')).data.items
  const content = loadHomework()
  let count = 0
  for (const [index, day] of content.days.entries()) {
    const date = calendar[index * 2].date
    mock.timers.setTime(new Date(`${date}T12:00:00`).getTime())
    completeMath(date)
    const answers = Object.fromEntries(day.chinese.questions.map((question) => [`q${question.no}`, { text: '这是我的阅读理解。' }]))
    const response = await request('/homework/submit', { date, subject: 'chinese', answers })
    assert.equal(response.status, 200)
    assert.equal(response.data.pending, 3)
    for (const question of day.chinese.questions) {
      const result = response.data.results.find((result) => result.key === `q${question.no}`)
      assert.equal(result.referenceAnswer, question.reference)
      assert.ok(result.referenceAnswer.length > 10)
      assert.ok(result.explanation.length > 10)
      assert.equal(result.source, 'local-reference')
      assert.equal(result.status, 'pending')
      count++
    }
    const restored = await request(`/homework/attempts/${date}/chinese`)
    assert.deepEqual(restored.data.result.results, response.data.results)
  }
  assert.equal(count, 42)
})

test('Chinese fallback also handles provider failures and empty answers without claiming AI grading', async () => {
  const chinese = loadHomework().days[0].chinese
  const question = { kind: 'chinese', question: { ...chinese.questions[0], passage: chinese.passage, source: chinese.source } }
  const original = { ...config.ai }
  try {
    Object.assign(config.ai, { apiKey: 'offline-test', baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 })
    const result = await gradeOne(question, { text: '疑就是以为、好像。' })
    assert.equal(result.status, 'pending')
    assert.equal(result.source, 'local-reference')
    assert.equal(result.referenceAnswer, question.question.reference)
    assert.ok(result.explanation)
    assert.equal(result.ai, undefined)
    const empty = await gradeOne(question, { text: '' })
    assert.equal(empty.status, 'wrong')
    assert.equal(empty.referenceAnswer, question.question.reference)
  } finally { Object.assign(config.ai, original) }
})

test('Chinese requires every math answer to be correct, including after individual correction', async () => {
  const date = '2026-10-26'
  db.prepare("DELETE FROM attempts WHERE date = ? AND subject = 'math'").run(date)
  assert.equal((await request(`/homework/date/${date}?subject=chinese`)).status, 403)
  assert.equal((await request(`/homework/date/${date}`)).data.chinese, null)
  assert.equal((await request(`/homework/attempts/${date}/chinese`)).status, 403)
  assert.equal((await request('/homework/submit', { date, subject: 'chinese', answers: {} })).status, 403)
  completeMath(date)
  db.prepare("UPDATE attempts SET result_json = ? WHERE date = ? AND subject = 'math' AND question_key = 'arith-1'").run(JSON.stringify({ key: 'arith-1', status: 'correct', correct: true, score: 10, pendingAi: true }), date)
  assert.equal((await request(`/homework/date/${date}?subject=chinese`)).status, 403)
  db.prepare("UPDATE attempts SET correct = 0, result_json = ? WHERE date = ? AND subject = 'math' AND question_key = 'arith-1'").run(JSON.stringify({ key: 'arith-1', status: 'wrong', correct: false, score: 0 }), date)
  const others = db.prepare("SELECT question_key, result_json FROM attempts WHERE date = ? AND subject = 'math' AND question_key != 'arith-1' ORDER BY question_key").all(date)
  assert.equal((await request(`/homework/today?date=${date}`)).data.chineseUnlocked, false)
  const correction = await request('/homework/correct', { date, subject: 'math', questionKey: 'arith-1', answers: { 'arith-1': { parts: [{ label: collectQuestions(date, 'math')[0].question.answer.parts[0].label, value: '4' }] } } })
  assert.equal(correction.status, 200)
  assert.equal(correction.data.total, 10)
  assert.equal(correction.data.correct, 10)
  assert.equal(correction.data.wrongCount, 0)
  assert.deepEqual(db.prepare("SELECT question_key, result_json FROM attempts WHERE date = ? AND subject = 'math' AND question_key != 'arith-1' ORDER BY question_key").all(date), others)
  assert.equal((await request(`/homework/today?date=${date}`)).data.chineseUnlocked, true)
  assert.equal((await request(`/homework/date/${date}?subject=chinese`)).status, 200)
  assert.equal((await request('/homework/correct', { date, subject: 'math', questionKey: 'arith-1', answers: { 'arith-1': { parts: [{ value: '5' }] } } })).status, 409)
  assert.equal((await request('/homework/correct', { date: '2026-10-27', subject: 'math', questionKey: 'arith-1', answers: { 'arith-1': { parts: [{ value: '5' }] } } })).status, 403)
})

test('word answers pass independently of AI process warnings, which still enter the wrong book', async () => {
  const date = '2026-10-26'
  const question = collectQuestions(date, 'math').find(question => question.group === 'word')
  const answer = { parts: question.question.answer.parts.map(part => ({ label: part.label, value: String(part.value) })), text: '我的计算过程。' }
  const originalFetch = globalThis.fetch
  const previous = { ...config.ai }
  let verdict = '部分对'
  Object.assign(config.ai, { apiKey: 'test-only', baseUrl: 'https://word-test.invalid/v1' })
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(config.ai.baseUrl)) return Response.json({ choices: [{ message: { content: JSON.stringify({ 判定: verdict, 得分: verdict === '对' ? 10 : 3, 讲解: '过程需要检查。', 错误原因: '计算过程有误。', 订正提示: '对照参考步骤。' }) } }] })
    return originalFetch(url, options)
  }
  try {
    for (const warning of ['部分对', '错']) {
      verdict = warning
      completeMath(date)
      db.prepare("DELETE FROM wrong_items WHERE date = ? AND subject = 'math' AND question_key = ?").run(date, question.key)
      db.prepare("UPDATE attempts SET result_json = ? WHERE date = ? AND subject = 'math' AND question_key = ?").run(JSON.stringify({ status: 'wrong' }), date, question.key)
      const correction = await request('/homework/correct', { date, subject: 'math', questionKey: question.key, answers: { [question.key]: answer } })
      assert.equal(correction.status, 200)
      const result = correction.data.results.find(result => result.key === question.key)
      assert.equal(result.status, 'correct')
      assert.equal(result.correct, true)
      assert.equal(result.score, 10)
      assert.equal(result.pendingAi, false)
      assert.equal(result.processStatus, warning === '部分对' ? 'partial' : 'wrong')
      assert.equal(result.message, '过程需要检查。')
      assert.equal(correction.data.wrongCount, 0)
      const wrong = db.prepare("SELECT kind, explanation FROM wrong_items WHERE date = ? AND subject = 'math' AND question_key = ?").get(date, question.key)
      assert.equal(wrong.kind, result.processStatus)
      assert.equal(wrong.explanation, result.message)
      assert.equal((await request(`/homework/date/${date}?subject=chinese`)).status, 200)
    }
    verdict = '对'
    const wrong = await gradeOne(question, { ...answer, parts: answer.parts.map(part => ({ ...part, value: '-999999' })) })
    assert.equal(wrong.status, 'wrong')
    assert.equal(wrong.correct, false)
    const emptyProcess = await gradeOne(question, { ...answer, text: '' })
    assert.equal(emptyProcess.status, 'correct')
    assert.equal(emptyProcess.pendingAi, false)
    config.ai.apiKey = ''
    const offline = await gradeOne(question, answer)
    assert.equal(offline.status, 'correct')
    assert.equal(offline.pendingAi, false)
    assert.equal(offline.processStatus, null)
  } finally { globalThis.fetch = originalFetch; Object.assign(config.ai, previous) }
})

test('only today can be opened or submitted, even in preview mode', async () => {
  const original = config.preview
  try {
    for (const preview of [false, true]) {
    config.preview = preview
    mock.timers.setTime(new Date(2026, 9, 27, 12).getTime())
    const calendar = (await request('/homework/calendar')).data
    for (const item of calendar.items) assert.equal(item.locked, item.date !== todayStr())
    assert.equal((await request(`/homework/date/${todayStr()}`)).status, 200)
    for (const date of ['2026-10-26', '2026-10-28', '2099-01-01']) {
      assert.equal((await request(`/homework/date/${date}`)).status, 403)
      assert.equal((await request('/homework/submit', { date, subject: 'math', answers: {} })).status, 403)
      assert.equal((await request('/homework/correct', { date, subject: 'math', questionKey: 'arith-1', answers: {} })).status, 403)
      assert.equal((await request('/homework/coding-note', { date, gain: 'test' })).status, 403)
      assert.equal((await request('/homework/coding-complete', { date })).status, 403)
      assert.equal((await request('/watch/sessions', { date })).status, 400)
    }
    mock.timers.setTime(new Date(2026, 9, 27, 12).getTime())
    assert.equal((await request('/homework/date/2026-10-26')).status, 403)
    assert.equal((await request('/homework/date/2026-10-27')).status, 200)
    mock.timers.setTime(new Date(2026, 9, 26, 12).getTime())
    }
  } finally { config.preview = original }
})

test('Chinese voice answers persist audio and transcripts by date and question', async () => {
  const date = '2026-10-26'
  completeMath(date)
  const body = new FormData()
  body.append('audio', new Blob(['saved-voice-bytes'], { type: 'audio/webm' }), 'answer.webm')
  body.append('transcript', '我会想起奶奶，想对她说我很想她。')
  const uploaded = await fetch(`${base}/homework/voice/${date}/q3`, { method: 'POST', body })
  assert.equal(uploaded.status, 200)
  const recording = await uploaded.json()
  assert.equal(recording.questionKey, 'q3')
  assert.equal(recording.transcript, '我会想起奶奶，想对她说我很想她。')
  assert.ok((await request(`/homework/voice/${date}`)).data.items.some((item) => item.id === recording.id && item.transcript === recording.transcript))
  const audio = await fetch(new URL(recording.url, base))
  assert.equal(audio.status, 200)
  assert.equal(audio.headers.get('content-type'), 'audio/webm')
  assert.equal(await audio.text(), 'saved-voice-bytes')
  db.prepare("DELETE FROM attempts WHERE date = ? AND subject = 'math' AND question_key = 'arith-1'").run(date)
  assert.equal((await fetch(new URL(recording.url, base))).status, 403)
  assert.equal((await request(`/homework/voice/${date}`)).status, 403)
  completeMath(date)
})

test('English has one daily dialogue and requires the latest recording to score at least seven', async () => {
  for (let index = 2; index <= 28; index += 2) {
    const date = `2026-${index <= 6 ? '10' : '11'}-${String(index <= 6 ? 25 + index : index - 6).padStart(2, '0')}`
    mock.timers.setTime(new Date(`${date}T12:00:00`).getTime())
    const response = await request(`/homework/date/${date}?subject=english`)
    assert.equal(response.status, 200)
    assert.equal(response.data.english.dialogues.length, 1)
    assert.ok(response.data.english.dialogues[0].lines.every((line) => line.en && line.zh))
    assert.equal(response.data.englishExercises, null)
    assert.deepEqual(response.data.english.sentences, [])
    assert.equal((await request('/homework/english-complete', { date, completed: false })).status, 400)
    assert.equal((await request('/homework/english-complete', { date, completed: true, score: 10 })).status, 409)
    const voiceId = `reading-${date}`
    db.prepare("INSERT INTO voice_answers (id, date, question_key, transcript, audio_path, mime_type, created_at) VALUES (?, ?, 'english-dialogue', 'Hello', 'test.wav', 'audio/wav', ?)").run(voiceId, date, new Date().toISOString())
    const saveResult = (score) => db.prepare("INSERT OR REPLACE INTO attempts (date, subject, question_key, result_json, created_at, updated_at) VALUES (?, 'english', 'dialogue-reading', ?, ?, ?)").run(date, JSON.stringify({ voiceId, passed: score >= 8, score }), new Date().toISOString(), new Date().toISOString())
    saveResult(6.9)
    assert.equal((await request('/homework/english-complete', { date, completed: true })).status, 409)
    saveResult(7)
    assert.equal((await request('/homework/english-complete', { date, completed: true })).status, 409)
    for (const [index] of response.data.english.dialogues[0].lines.entries()) {
      const lineId = `${voiceId}-line-${index}`
      db.prepare("INSERT INTO voice_answers (id, date, question_key, transcript, audio_path, mime_type, created_at) VALUES (?, ?, ?, 'Hello', 'test.wav', 'audio/wav', ?)").run(lineId, date, `english-line-${index}`, new Date().toISOString())
      db.prepare("INSERT INTO attempts (date, subject, question_key, result_json, created_at, updated_at) VALUES (?, 'english', ?, ?, ?, ?)").run(date, `line-reading-${index}`, JSON.stringify({ voiceId: lineId, passed: false, score: 7 }), new Date().toISOString(), new Date().toISOString())
    }
    assert.equal((await request('/homework/english-complete', { date, completed: true })).status, 200)
    const restored = await request(`/homework/date/${date}`)
    const progress = restored.data.progress.find((row) => row.subject === 'english')
    assert.equal(progress.status, 'submitted')
    assert.equal(progress.total, 1)
    assert.equal(progress.score, 7)
    db.prepare("INSERT INTO voice_answers (id, date, question_key, transcript, audio_path, mime_type, created_at) VALUES (?, ?, 'english-dialogue', '', 'test.wav', 'audio/wav', ?)").run(`${voiceId}-new`, date, new Date().toISOString())
    assert.equal((await request('/homework/english-complete', { date, completed: true })).status, 409)
  }
  assert.equal((await request('/homework/english-complete', { date: '2026-10-27', completed: true })).status, 403)
  mock.timers.setTime(new Date(2026, 9, 26, 12).getTime())
  assert.equal((await request('/homework/english-complete', { date: '2026-10-26', completed: true })).status, 400)
})

test('English recording is transcribed on the server, persists, and low scores require a new recording', async () => {
  mock.timers.setTime(new Date(2026, 9, 27, 12).getTime())
  const date = '2026-10-27'
  const originalFetch = globalThis.fetch
  const previous = { ...config.ai }
  config.ai.apiKey = 'test-only'
  config.ai.baseUrl = 'https://english-test.invalid/v1'
  const wav = Buffer.alloc(44 + 64000)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(64000, 40)
  let sentenceMode = false
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(config.ai.baseUrl)) {
      if (String(url).endsWith('/speech_to_text')) return Response.json({ text: 'Hello', duration: 2 })
      assert.match(JSON.parse(options.body).messages.at(-1).content, /Hello/)
      assert.doesNotMatch(JSON.parse(options.body).messages.at(-1).content, /CLIENT_PERFECT_TRANSCRIPT/)
      assert.match(JSON.parse(options.body).messages[0].content, sentenceMode ? /单独一句，只评估这一句/ : /完整对话，必须核对整段/)
      return Response.json({ choices: [{ message: { content: JSON.stringify({ 得分: 3, 讲解: '只读了问好，请完整跟读对话。', 订正提示: '重新录音。' }) } }] })
    }
    return originalFetch(url, options)
  }
  try {
    const body = new FormData()
    body.append('audio', new Blob([wav], { type: 'audio/wav' }), 'reading.wav')
    body.append('transcript', 'CLIENT_PERFECT_TRANSCRIPT')
    const response = await originalFetch(`${base}/homework/english-reading/${date}`, { method: 'POST', body })
    const saved = await response.json()
    assert.equal(response.status, 200)
    assert.equal(saved.result.score, 3)
    assert.equal(saved.result.passed, false)
    assert.equal(saved.recording.transcript, 'Hello')
    assert.equal((await originalFetch(`http://127.0.0.1:${server.address().port}${saved.recording.url}`)).status, 200)
    assert.equal((await request('/homework/english-complete', { date, completed: true })).status, 409)
    assert.equal((await request(`/homework/english-reading/${date}/retry`, { voiceId: saved.recording.id })).status, 409)
    assert.equal((await request('/ai/english-grade', { sentence: 'Hello', answer: 'Hello' })).status, 410)
    sentenceMode = true
    const lineBody = new FormData()
    lineBody.append('audio', new Blob([wav], { type: 'audio/wav' }), 'line.wav')
    const lineResponse = await originalFetch(`${base}/homework/english-reading/${date}/line/0`, { method: 'POST', body: lineBody })
    const line = await lineResponse.json()
    assert.equal(lineResponse.status, 200)
    assert.equal(line.result.score, 3)
    assert.notEqual(line.recording.id, saved.recording.id)
    assert.equal((await request(`/homework/english-reading/${date}`)).data.recording.id, saved.recording.id)
    assert.equal((await request(`/homework/english-reading/${date}/line/1`)).data.result.score, 7)
    assert.equal((await originalFetch(`${base}/homework/english-reading/${date}`, { method: 'POST', body: lineBody })).status, 409)
    assert.equal((await request(`/homework/english-reading/${date}/line/999`)).status, 400)
    assert.equal((await request(`/homework/english-reading/${date}/line/-1`)).status, 400)
  } finally { globalThis.fetch = originalFetch; Object.assign(config.ai, previous) }
})

test('parent settings take effect and unlock self-contained reference games', async () => {
  const login = await request('/parent/login', { pin: '0000' })
  const headers = { 'Content-Type': 'application/json', Cookie: login.cookie }
  assert.equal((await request('/parent/settings', { pin: '12' }, { method: 'PUT', headers })).status, 400)
  assert.equal((await request('/parent/settings', { deadline: '99:99' }, { method: 'PUT', headers })).status, 400)
  assert.equal((await request('/parent/settings', { monitoring: false, referenceUnlocked: true, deadline: '20:30' }, { method: 'PUT', headers })).status, 200)
  assert.equal((await request('/homework/settings')).data.monitoring, false)
  assert.equal((await request('/watch/sessions', { date: '2026-10-26' })).status, 403)
  assert.equal((await request('/parent/settings', undefined, { headers })).data.effective.deadline, '20:30')
  for (const project of ['star', 'space']) {
    const response = await fetch(`${base}/homework/reference/${project}`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<canvas/i)
  }
  await request('/parent/settings', { monitoring: true, referenceUnlocked: false }, { method: 'PUT', headers })
})
