import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

/**
 * 作业内容加载器。
 *
 * 作业内容（作业/homework.json）由 开发/content/build_content.py 从 docx 生成；
 * 知识点数据（教学/*.json）由 开发/content/build_graph.py 从隔壁 cn-math-taxonomy 抽取。
 * 这里只负责读进内存并提供查询，不做任何解析工作。
 */

let homework = null
let graph = { math: null, english: null, chinese: null, standards: null }

export function loadHomework() {
  if (homework) return homework
  const file = path.join(config.contentDir, 'homework.json')
  if (!fs.existsSync(file)) {
    throw new Error(
      `找不到作业内容 ${file}。请先运行：python3 开发/content/build_content.py`
    )
  }
  homework = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const answerFile = path.join(config.contentDir, 'chinese_answers.json')
  if (fs.existsSync(answerFile)) {
    const references = JSON.parse(fs.readFileSync(answerFile, 'utf-8'))
    for (const day of homework.days) {
      if (!day.chinese) continue
      const reference = references.find((item) => item.title === day.chinese.title)
      for (const question of day.chinese.questions) {
        const answer = reference?.answers.find((item) => item.no === question.no)
        if (answer) Object.assign(question, { reference: answer.answer, explanation: answer.explanation })
      }
    }
  }
  const extensionFile = path.join(config.contentDir, 'math_extensions_easy.json')
  if (fs.existsSync(extensionFile)) {
    const extensions = JSON.parse(fs.readFileSync(extensionFile, 'utf-8'))
    for (const day of homework.days) {
      const replacement = extensions.find((item) => item.day === day.day)
      const group = day.math?.groups.find((item) => item.key === 'extend')
      if (replacement && group) group.questions = replacement.questions.map((question) => ({ ...question, version: 'easy-v1' }))
    }
  }
  const milestoneFile = path.join(config.contentDir, 'coding_milestones.json')
  const solutionFile = path.join(config.contentDir, 'math_word_solutions.json')
  if (fs.existsSync(solutionFile)) {
    const solutions = JSON.parse(fs.readFileSync(solutionFile, 'utf-8'))
    for (const solution of solutions) {
      const question = homework.days.find((day) => day.day === solution.day)?.math?.groups.find((group) => group.key === 'word')?.questions.find((item) => item.no === solution.no)
      if (!question) continue
      question.explanation = solution.steps
      if (solution.answer !== undefined) {
        question.answer.parts[0].value = solution.answer
        question.reference = solution.steps.join('\n')
        question.version = 'corrected-v1'
      }
    }
  }
  if (fs.existsSync(milestoneFile)) {
    const milestones = JSON.parse(fs.readFileSync(milestoneFile, 'utf-8'))
    for (const day of homework.days) {
      const milestone = milestones.find((item) => item.day === day.day)
      if (!day.coding || !milestone) continue
      Object.assign(day.coding, {
        dayTitle: milestone.title,
        goal: milestone.goal,
        features: milestone.features,
        playtest: milestone.playtest,
        readFirst: '', steps: [], prompts: [], saveTip: '', selfCheck: milestone.playtest,
      })
    }
  }
  return homework
}

export function loadGraph(subject = 'math') {
  if (graph[subject]) return graph[subject]
  const file = path.join(config.graphDir, `topics.${subject}.json`)
  if (!fs.existsSync(file)) return { topics: [], dependencies: [], questions: [] }
  const topics = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const depFile = path.join(config.graphDir, `dependencies.${subject}.json`)
  const qFile = path.join(config.graphDir, `questions.${subject}.json`)
  const dependencies = fs.existsSync(depFile)
    ? JSON.parse(fs.readFileSync(depFile, 'utf-8'))
    : []
  const questions = fs.existsSync(qFile) ? JSON.parse(fs.readFileSync(qFile, 'utf-8')) : []
  graph[subject] = { topics, dependencies, questions }
  return graph[subject]
}

export function loadStandards() {
  if (graph.standards) return graph.standards
  const file = path.join(config.graphDir, 'standards.json')
  graph.standards = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : []
  return graph.standards
}

export const getDays = () => loadHomework().days
export const getMeta = () => loadHomework().meta
export const getProjects = () => loadHomework().projects
export const getDay = (n) => getDays().find((d) => d.day === n) || null

/** docx 里的语文篇目（按顺序） */
export const chineseItems = () => getDays().map((d) => d.chinese).filter(Boolean)
/** docx 里的英语主题（按顺序） */
export const englishItems = () => getDays().map((d) => d.english)
