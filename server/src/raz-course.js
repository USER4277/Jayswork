import { config } from './config.js'
import { loadRazLibrary, publicBook, RAZ_LEVELS } from './raz-library.js'
import { bookLesson, CORE_AA, gradeRazQuestions, publicQuestions } from './raz-content.js'
import { parseDate, toDateStr } from './schedule.js'

const failure = (message, status = 400) => Object.assign(new Error(message), { status })
const stamp = () => new Date().toISOString()
const placementBooks = [['AA', 'thezoo'], ['A', 'vegetables'], ['C', 'howthingsmove'], ['G', 'webuildarobot']]

export function createRazCourse({ database, resourceRoot = config.razDir, loadLesson = bookLesson }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS raz_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS raz_lessons (date TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS raz_books (book_id TEXT PRIMARY KEY, level TEXT NOT NULL, parts_completed INTEGER NOT NULL DEFAULT 0, first_score REAL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS raz_reviews (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, due_date TEXT NOT NULL, completed_at TEXT, score REAL);
    CREATE INDEX IF NOT EXISTS raz_reviews_due ON raz_reviews(due_date, completed_at);
  `)
  const library = () => loadRazLibrary(resourceRoot)
  const profile = () => {
    const row = database.prepare("SELECT value_json FROM raz_state WHERE key = 'profile'").get()
    const value = row ? JSON.parse(row.value_json) : { level: null, targetMinutes: 20, placement: { index: 0, lastPassed: null, results: [] } }
    const mastered = database.prepare('SELECT COUNT(*) AS count, AVG(first_score) AS average FROM raz_books WHERE level = ? AND completed_at IS NOT NULL AND first_score IS NOT NULL').get(value.level || '')
    const reviews = database.prepare('SELECT COUNT(DISTINCT completed_at) AS count, AVG(score) AS average FROM raz_reviews WHERE book_id IN (SELECT book_id FROM raz_books WHERE level = ?) AND completed_at IS NOT NULL AND score IS NOT NULL').get(value.level || '')
    const next = RAZ_LEVELS[RAZ_LEVELS.indexOf(value.level) + 1]
    return { ...value, masteredBooks: mastered.count, firstAccuracy: mastered.average, reviewAccuracy: reviews.average, recommendedLevel: mastered.count >= 8 && mastered.average >= 80 && reviews.count >= 2 && reviews.average >= 80 && library().books.some(book => book.level === next && book.ready) ? next : null }
  }
  const saveProfile = value => database.prepare("INSERT INTO raz_state(key, value_json) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(value))
  const read = date => {
    const row = database.prepare('SELECT payload_json FROM raz_lessons WHERE date = ?').get(date)
    return row ? JSON.parse(row.payload_json) : null
  }
  const save = lesson => database.prepare('INSERT INTO raz_lessons(date, payload_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at').run(lesson.date, JSON.stringify(lesson), stamp())
  const mutate = date => {
    const lesson = read(date)
    if (!lesson) throw failure('请先加载当天课程')
    if (lesson.completed) throw failure('当天课程已经完成', 409)
    return lesson
  }
  const transaction = action => {
    database.exec('BEGIN IMMEDIATE')
    try { const result = action(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }
  const summary = () => ({ available: library().available, levels: library().levels, total: library().books.length, ready: library().books.filter(book => book.ready).length })
  const publicLesson = lesson => ({ ...lesson, questions: publicQuestions(lesson.questions) })

  async function placement() {
    const current = profile()
    const [level, key] = placementBooks[current.placement.index] || placementBooks[0]
    const book = library().books.find(book => book.level === level && book.key === key && book.ready)
    if (!book) throw failure(`测级用书 ${level} 暂缺，请在家长区检查资源或指定起始级别`, 503)
    const content = await loadLesson(book)
    if (content.questions.length < 3) throw failure('测级题目暂不可用，请在家长区指定起始级别', 503)
    return { level, book: publicBook(book), pages: content.pages, questions: publicQuestions(content.questions.slice(0, 3)), index: current.placement.index }
  }

  async function state(date) {
    const current = profile()
    if (!library().available || !summary().ready) throw failure('未找到可用的 RAZ 绘本与原版音频，请在家长区检查资源目录', 503)
    const existing = read(date)
    if (existing) return { date, mode: 'lesson', profile: current, library: summary(), lesson: publicLesson(existing) }
    if (!current.level) return { date, mode: 'placement', profile: current, library: summary(), placement: await placement() }
    const previous = database.prepare('SELECT payload_json FROM raz_lessons WHERE date < ? ORDER BY date DESC LIMIT 1').get(date)
    const unfinished = previous ? JSON.parse(previous.payload_json) : null
    if (unfinished && !unfinished.completed && unfinished.book.level === current.level) {
      const resumed = { ...unfinished, date, resumedFrom: unfinished.resumedFrom || unfinished.date }
      save(resumed)
      return { date, mode: 'lesson', profile: current, library: summary(), lesson: publicLesson(resumed) }
    }
    const progress = database.prepare('SELECT * FROM raz_books WHERE level = ?').all(current.level)
    const order = book => book.level === 'AA' && CORE_AA.includes(book.key) ? CORE_AA.indexOf(book.key) : 100
    const books = library().books.filter(book => book.level === current.level && book.ready).sort((left, right) => order(left) - order(right) || left.title.localeCompare(right.title, 'en'))
    const unread = books.find(book => !progress.find(row => row.book_id === book.id)?.completed_at)
    const book = unread || books[0]
    if (!book) throw failure('当前级别没有可用书目，请在家长区调整级别', 503)
    const content = await loadLesson(book)
    const parts = Math.max(1, Math.min(12, Math.ceil(Math.max((content.wordCount || 0) / 500, (content.duration || 0) / 360) * 20 / current.targetMinutes)))
    const completedParts = progress.find(row => row.book_id === book.id)?.parts_completed || 0
    const part = Math.min(parts, completedParts + 1)
    const due = database.prepare('SELECT * FROM raz_reviews WHERE completed_at IS NULL AND due_date <= ? ORDER BY due_date, id').all(date)
    const reviews = []
    const reviewIds = []
    const reviewGroups = []
    for (const review of due) {
      if (reviewGroups.some(group => group.bookId === review.book_id)) continue
      const sourceBook = library().books.find(book => book.id === review.book_id && book.ready)
      if (!sourceBook) continue
      const source = await loadLesson(sourceBook)
      const selected = source.questions.slice(0, Math.min(2, 5 - reviews.length))
      if (!selected.length) continue
      reviews.push(...selected.map(question => ({ ...question, id: `review-${review.id}-${question.id}`, bookTitle: sourceBook.title })))
      const ids = due.filter(candidate => candidate.book_id === review.book_id).map(candidate => candidate.id)
      reviewIds.push(...ids)
      reviewGroups.push({ bookId: review.book_id, ids, prefix: review.id })
      if (reviews.length >= 5) break
    }
    const completedCount = database.prepare("SELECT COUNT(*) AS count FROM raz_lessons WHERE json_extract(payload_json, '$.completed') = 1 AND date < ?").get(date).count
    const reviewOnly = !unread || completedCount % 5 === 4 && reviews.length > 0
    if (reviewOnly && !reviews.length) reviews.push(...content.questions.map(question => ({ ...question, id: `review-library-${question.id}`, bookTitle: book.title })))
    const main = !reviewOnly && part === parts ? content.questions.map(question => ({ ...question, id: `main-${question.id}` })) : []
    const lesson = {
      date, book: publicBook(book), kind: reviewOnly ? 'review' : 'reading', part, parts,
      pages: content.pages, wordCount: content.wordCount, duration: content.duration,
      startPage: Math.floor((part - 1) * content.pages / parts) + 1,
      endPage: Math.ceil(part * content.pages / parts),
      audioStart: content.duration ? (part - 1) * content.duration / parts : 0,
      audioEnd: content.duration ? part * content.duration / parts : null,
      questions: [...reviews, ...main], reviewIds, reviewGroups, source: content.source,
      reflectionPrompt: content.reflectionPrompt, values: { page: 0, listened: false, reflection: '' },
      result: null, firstScore: null, outputId: null, completed: false,
    }
    database.prepare('INSERT OR IGNORE INTO raz_lessons(date, payload_json, updated_at) VALUES (?, ?, ?)').run(date, JSON.stringify(lesson), stamp())
    return { date, mode: 'lesson', profile: current, library: summary(), lesson: publicLesson(read(date)) }
  }

  return {
    state, profile, library, summary,
    setProfile(patch) {
      if (!patch || !RAZ_LEVELS.includes(patch.level) || !library().books.some(book => book.level === patch.level && book.ready)) throw failure('请选择有可用资源的级别')
      if (!Number.isInteger(patch.targetMinutes) || patch.targetMinutes < 10 || patch.targetMinutes > 40) throw failure('学习时长应为 10 至 40 分钟')
      saveProfile({ ...profile(), level: patch.level, targetMinutes: patch.targetMinutes })
      return profile()
    },
    async place(date, index, answers) {
      const current = profile()
      if (current.level || index !== current.placement.index) throw failure('测级状态已变化，请刷新后继续', 409)
      const target = await placement()
      const book = library().books.find(book => book.id === target.book.id)
      const questions = (await loadLesson(book)).questions.slice(0, 3)
      const result = gradeRazQuestions(questions, answers)
      if (!result) throw failure('请完成所有测级题目')
      const passed = result.score >= 80
      const finished = !passed || index === placementBooks.length - 1
      saveProfile({ ...current, level: finished ? (passed ? target.level : current.placement.lastPassed || 'AA') : null, placement: { index: index + 1, lastPassed: passed ? target.level : current.placement.lastPassed, results: [...current.placement.results, { level: target.level, score: result.score }] } })
      return { result, finished, profile: profile() }
    },
    update(date, patch) {
      const lesson = mutate(date)
      if (patch.page !== undefined && (!Number.isInteger(patch.page) || patch.page < 1 || patch.page > lesson.pages)) throw failure('阅读页码无效')
      if (patch.listened !== undefined && typeof patch.listened !== 'boolean') throw failure('听读状态无效')
      if (patch.reflection !== undefined && (typeof patch.reflection !== 'string' || patch.reflection.length > 2000)) throw failure('表达内容过长或格式不正确')
      if (patch.answers !== undefined) {
        if (!patch.answers || typeof patch.answers !== 'object' || Array.isArray(patch.answers) || !Object.entries(patch.answers).every(([id, value]) => lesson.questions.some(question => question.id === id && question.options.some(option => option.id === value)))) throw failure('答案草稿包含无效选项')
        if (Object.entries(patch.answers).some(([id, value]) => lesson.answers?.[id] !== value)) lesson.result = null
        lesson.answers = { ...lesson.answers, ...patch.answers }
      }
      for (const key of ['page', 'listened', 'reflection']) if (patch[key] !== undefined) lesson.values[key] = key === 'page' ? Math.max(lesson.values.page, patch.page) : patch[key]
      save(lesson)
      return publicLesson(lesson)
    },
    output(date, id) { const lesson = mutate(date); lesson.outputId = id; save(lesson) },
    quiz(date, answers) {
      const lesson = mutate(date)
      const result = gradeRazQuestions(lesson.questions, answers)
      if (!result) throw failure('请为每道题选择一个有效答案')
      if (lesson.firstScore === null) {
        const main = lesson.questions.filter(question => question.id.startsWith('main-'))
        lesson.firstScore = main.length ? gradeRazQuestions(main, Object.fromEntries(main.map(question => [question.id, answers[question.id]]))).score : null
      }
      lesson.answers = answers
      lesson.result = result
      lesson.firstResult ||= result
      save(lesson)
      return publicLesson(lesson)
    },
    complete(date) {
      const lesson = mutate(date)
      if (lesson.kind !== 'review' && (!lesson.values.listened || lesson.values.page < lesson.endPage)) throw failure('请先完成当天的原声听读和阅读', 409)
      if (lesson.questions.length && !lesson.result) throw failure('请先完成当天的理解练习', 409)
      if (lesson.values.reflection.trim().length < 2 && !lesson.outputId) throw failure('请留下一句简短表达，或录音作答', 409)
      transaction(() => {
        lesson.completed = true
        save(lesson)
        const timestamp = stamp()
        if (lesson.kind === 'reading') {
          const first = database.prepare('SELECT first_score FROM raz_books WHERE book_id = ?').get(lesson.book.id)
          database.prepare('INSERT INTO raz_books(book_id, level, parts_completed, first_score, completed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET parts_completed = MAX(parts_completed, excluded.parts_completed), first_score = COALESCE(first_score, excluded.first_score), completed_at = excluded.completed_at').run(lesson.book.id, lesson.book.level, lesson.part, first?.first_score ?? lesson.firstScore, lesson.part === lesson.parts ? date : null)
          if (lesson.part === lesson.parts) for (const offset of [1, 3, 7, 14]) {
            const due = parseDate(date)
            due.setDate(due.getDate() + offset)
            database.prepare('INSERT OR IGNORE INTO raz_reviews(id, book_id, due_date) VALUES (?, ?, ?)').run(`${lesson.book.id}-${offset}`, lesson.book.id, toDateStr(due))
          }
        }
        for (const id of lesson.reviewIds) {
          const prefix = lesson.reviewGroups?.find(group => group.ids.includes(id))?.prefix || id
          const results = (lesson.firstResult || lesson.result)?.results.filter(result => result.id.startsWith(`review-${prefix}-`)) || []
          const score = results.length ? results.filter(result => result.correct).length / results.length * 100 : null
          database.prepare('UPDATE raz_reviews SET completed_at = ?, score = ? WHERE id = ?').run(timestamp, score, id)
        }
        database.prepare("INSERT INTO daily_progress(date, subject, status, submitted_at, score, total) VALUES (?, 'english', 'submitted', ?, ?, 100) ON CONFLICT(date, subject) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at, score = excluded.score, total = excluded.total").run(date, timestamp, lesson.result?.score ?? null)
      })
      return publicLesson(lesson)
    },
    internal: read,
    reset() {
      transaction(() => {
        database.exec("DELETE FROM daily_progress WHERE subject = 'english' AND date IN (SELECT date FROM raz_lessons)")
        for (const table of ['raz_lessons', 'raz_reviews', 'raz_books', 'raz_state']) database.exec(`DELETE FROM ${table}`)
      })
    },
  }
}