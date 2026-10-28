import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const execute = promisify(execFile)
const lessons = new Map()
const vocabulary = {
  lion: '狮子', tiger: '老虎', bear: '熊', wolf: '狼', zebra: '斑马', snake: '蛇',
  mother: '妈妈', father: '爸爸', brother: '兄弟', sister: '姐妹', grandfather: '爷爷或外公', grandmother: '奶奶或外婆',
  chair: '椅子', desk: '课桌', book: '书', paper: '纸', pencil: '铅笔', eraser: '橡皮', backpack: '书包',
  cat: '猫', dog: '狗', bunny: '兔子', bird: '鸟', goldfish: '金鱼', mouse: '老鼠', turtle: '乌龟', hamster: '仓鼠',
  blocks: '积木', paint: '颜料', drum: '鼓', plane: '飞机', wagon: '小推车', kite: '风筝', robot: '机器人',
  green: '绿色的', red: '红色的', yellow: '黄色的', blue: '蓝色的', white: '白色的', black: '黑色的',
  big: '大的', small: '小的', wet: '湿的', dry: '干的', hot: '热的', cold: '冷的', flat: '平的', round: '圆的',
  leaf: '叶子', frog: '青蛙', insect: '昆虫', forest: '森林', tomato: '西红柿', apple: '苹果', potato: '土豆',
  water: '水', school: '学校', bus: '公共汽车', garden: '花园', train: '火车', boat: '小船', house: '房子',
}

export const CORE_AA = ['thezoo', 'myfamily', 'theclassroom', 'pets', 'toys', 'green', 'red', 'theseareopposites']

function lines(items) {
  const rows = []
  for (const item of items.filter(item => item.str?.trim()).sort((left, right) => right.transform[5] - left.transform[5])) {
    let row = rows.find(row => Math.abs(row.height - item.transform[5]) < 4)
    if (!row) { row = { height: item.transform[5], items: [] }; rows.push(row) }
    row.items.push(item)
  }
  return rows.sort((left, right) => right.height - left.height).map(row => row.items.sort((left, right) => left.transform[4] - right.transform[4]).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim())
}

export async function readPdf(filename) {
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(filename)), isEvalSupported: false, useSystemFonts: true })
  try {
    const document = await task.promise
    const pages = []
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index)
      const { items } = await page.getTextContent()
      pages.push({ width: page.view[2], items, text: lines(items).join('\n') })
    }
    return pages
  } finally { await task.destroy() }
}

export function parseOriginalQuiz(pages) {
  const answers = new Map()
  for (const page of pages.filter(page => /Quick Check Answer Sheet/i.test(page.text))) {
    for (const line of lines(page.items)) {
      const match = line.match(/^(\d{1,2})[.)]?\s+([A-D])\b/i)
      if (match) answers.set(Number(match[1]), match[2].toUpperCase())
    }
    const starts = page.items.filter(item => /^\d{1,2}[.)]?$/.test(item.str?.trim() || '') && item.transform[5] > 95 && item.transform[5] < 680)
    for (const start of starts) {
      const next = starts.filter(item => Math.abs(item.transform[4] - start.transform[4]) < 40 && item.transform[5] < start.transform[5] - 5).sort((left, right) => right.transform[5] - left.transform[5])[0]
      const answer = page.items.filter(item => /^[A-D]$/.test(item.str?.trim() || '') && item.transform[5] <= start.transform[5] + 4 && item.transform[5] > (next?.transform[5] ?? 95) + 4 && item.transform[4] >= start.transform[4]).sort((left, right) => right.transform[5] - left.transform[5])[0]
      if (answer) answers.set(Number(start.str.replace(/\D/g, '')), answer.str.trim())
    }
  }
  const questions = []
  for (const page of pages.filter(page => !/Quick Check Answer Sheet/i.test(page.text))) {
    const items = page.items.filter(item => item.str?.trim() && item.transform[5] > 95 && item.transform[5] < 680)
    const starts = items.filter(item => /^\d{1,2}[.)]?$/.test(item.str.trim()) && answers.has(Number(item.str.replace(/\D/g, ''))))
    const columns = starts.some(item => item.transform[4] > page.width / 2)
    for (const start of starts) {
      const number = Number(start.str.replace(/\D/g, ''))
      const column = columns && start.transform[4] > page.width / 2 ? 1 : 0
      const inColumn = item => !columns || (item.transform[4] > page.width / 2 ? 1 : 0) === column
      const next = starts.filter(item => inColumn(item) && item.transform[5] < start.transform[5] - 5).sort((left, right) => right.transform[5] - left.transform[5])[0]
      const bottom = next?.transform[5] ?? 95
      const region = items.filter(item => inColumn(item) && item !== start && item.transform[5] <= start.transform[5] + 4 && item.transform[5] > bottom + 4)
      const markers = region.filter(item => /^[A-D]$/.test(item.str.trim()) && item.transform[5] < start.transform[5] - 8)
      if (markers.length < 2 || markers.length > 4) continue
      const topChoice = Math.max(...markers.map(item => item.transform[5]))
      const prompt = lines(region.filter(item => item.transform[5] > topChoice + 6)).join(' ')
      const options = markers.map(marker => {
        const right = Math.min(...markers.filter(item => item.transform[4] > marker.transform[4] + 35).map(item => item.transform[4]), columns ? (column + 1) * page.width / 2 : page.width)
        const lower = Math.max(bottom + 4, ...markers.filter(item => Math.abs(item.transform[4] - marker.transform[4]) < 30 && item.transform[5] < marker.transform[5] - 6).map(item => item.transform[5] + 4))
        const text = lines(region.filter(item => item !== marker && item.transform[4] > marker.transform[4] + 8 && item.transform[4] < right - 3 && item.transform[5] <= marker.transform[5] + 5 && item.transform[5] > lower)).join(' ')
        return { id: marker.str.trim(), text }
      }).sort((left, right) => left.id.localeCompare(right.id))
      if (prompt && options.every(option => option.text) && options.some(option => option.id === answers.get(number))) questions.push({ id: `original-${number}`, prompt, options, answer: answers.get(number), source: 'original' })
    }
  }
  return questions.sort((left, right) => Number(left.id.split('-')[1]) - Number(right.id.split('-')[1]))
}

function meaningQuestions(text) {
  const found = [...new Set(text.toLowerCase().match(/[a-z]+/g) || [])].filter(word => vocabulary[word]).slice(0, 5)
  return found.map((word, index) => {
    const groups = [
      ['lion', 'tiger', 'bear', 'wolf', 'zebra', 'snake'],
      ['mother', 'father', 'brother', 'sister', 'grandfather', 'grandmother'],
      ['chair', 'desk', 'book', 'paper', 'pencil', 'eraser', 'backpack'],
      ['cat', 'dog', 'bunny', 'bird', 'goldfish', 'mouse', 'turtle', 'hamster'],
      ['blocks', 'paint', 'drum', 'plane', 'wagon', 'kite', 'robot'],
      ['green', 'red', 'yellow', 'blue', 'white', 'black'],
      ['big', 'small', 'wet', 'dry', 'hot', 'cold', 'flat', 'round'],
    ]
    const pool = groups.find(group => group.includes(word)) || Object.keys(vocabulary)
    const distractors = pool.filter(candidate => candidate !== word).slice(0, 3).map(candidate => [candidate, vocabulary[candidate]])
    const options = [{ id: word, text: vocabulary[word] }, ...distractors.map(([id, value]) => ({ id, text: value }))]
    const offset = (index + 1) % options.length
    return { id: `meaning-${word}`, prompt: '听读音，选择中文含义', audio: word, options: [...options.slice(offset), ...options.slice(0, offset)], answer: word, source: 'vocabulary' }
  })
}

export async function bookLesson(book) {
  if (lessons.has(book.assets.book)) return lessons.get(book.assets.book)
  const promise = (async () => {
    const pages = await readPdf(book.assets.book)
    let text = pages.map(page => page.text).join('\n')
    if (text.trim().length < 100 && book.assets.text !== book.assets.book) text = (await readPdf(book.assets.text)).map(page => page.text).join('\n')
    const wordCount = Number(text.match(/Word Count:\s*([\d,]+)/i)?.[1]?.replaceAll(',', '')) || null
    let duration = null
    try { const result = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', book.assets.audio], { timeout: 10000 }); duration = Number(result.stdout.trim()) || null } catch {}
    let questions = []
    if (book.assets.quiz) {
      try { questions = parseOriginalQuiz(await readPdf(book.assets.quiz)) } catch {}
    }
    if (questions.length < 3 && ['AA', 'A', 'B', 'C'].includes(book.level)) questions = meaningQuestions(pages.slice(2, -2).map(page => page.text).join('\n'))
    const parts = Math.max(1, Math.min(12, Math.ceil(Math.max((wordCount || 0) / 500, (duration || 0) / 360))))
    return { pages: pages.length, wordCount, duration, parts, questions, source: questions[0]?.source || 'reflection', reflectionPrompt: '说说这本书讲了什么，或者你最想记住的一点。', textAvailable: text.trim().length > 100 }
  })()
  lessons.set(book.assets.book, promise)
  try { return await promise } catch (error) { lessons.delete(book.assets.book); throw error }
}

export function gradeRazQuestions(questions, answers) {
  if (!questions.length || !answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== questions.length || !questions.every(question => question.options.some(option => option.id === answers[question.id]))) return null
  const results = questions.map(question => ({ id: question.id, selected: answers[question.id], answer: question.answer, correct: answers[question.id] === question.answer }))
  const correct = results.filter(result => result.correct).length
  return { score: Math.round(correct / questions.length * 100), correct, total: questions.length, results }
}

export const publicQuestions = questions => questions.map(({ answer, ...question }) => question)