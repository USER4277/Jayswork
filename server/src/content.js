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
