import { getDays, getMeta } from './content.js'

/**
 * 日期驱动的排期。
 *
 * 锚点：2026-10-26（docx 作业本的第 1 天）。
 *   day_index = (日期 - 锚点) 天数 + 1
 *   奇数 day_index → 语文，偶数 → 英语（需求：语文和英语隔天出现）
 *   day_index 1..14 → 数学 + 编程（取 docx 同一「天」，保证数学与编程配套）
 *   day_index 15..28 → 只有语言（顺延池：语文第 8~14 篇 / 英语第 8~14 段）
 *
 * 语言题目的取法：语文第 (day_index+1)/2 篇，英语第 day_index/2 段 —— 正好在
 * 28 天里把 docx 的 14 篇语文 + 14 段英语全部用完。
 *
 * 错题本的「7 天一个周期」用的是同一个锚点：cycle = floor((day_index-1)/7)+1。
 */

export const ANCHOR = getMeta().anchorStart || '2026-10-26'
export const DOCX_DAYS = getDays().length // 14
export const TOTAL_DAYS = DOCX_DAYS * 2 // 28：语言题循环两轮

const MS_DAY = 24 * 60 * 60 * 1000

export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr() {
  return toDateStr(new Date())
}

/** YYYY-MM-DD → 当天 00:00 的 UTC 时间戳（按本地日历天计算天数差） */
export function parseDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(NaN)
  const [y, m, d] = str.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return toDateStr(date) === str ? date : new Date(NaN)
}

export function daysBetween(fromStr, toStr) {
  const a = parseDate(fromStr)
  const b = parseDate(toStr)
  return Math.round((b - a) / MS_DAY)
}

/** 日期 → 序号（1 起）。早于锚点返回 <= 0 */
export function dayIndex(dateStr) {
  return daysBetween(ANCHOR, dateStr) + 1
}

/** 序号 → 日期 */
export function dateOfIndex(idx) {
  const d = parseDate(ANCHOR)
  d.setDate(d.getDate() + (idx - 1))
  return toDateStr(d)
}

/** 7 天一个周期的周期号 */
export function cycleOfIndex(idx) {
  return Math.floor((idx - 1) / 7) + 1
}

/** 周期号 → 该周期的起止日期 */
export function cycleRange(cycle) {
  const start = dateOfIndex((cycle - 1) * 7 + 1)
  const end = dateOfIndex(cycle * 7)
  return { start, end }
}

/**
 * 算出某一天的作业安排。
 * @returns {null | {
 *   date, dayIndex, cycle, week,
 *   languageSubject: 'chinese' | 'english',
 *   languageIndex: number|null,
 *   mathDay: number|null, codingDay: number|null,
 *   status: 'ready' | 'pending' | 'before'
 * }}
 */
export function scheduleFor(dateStr) {
  const idx = dayIndex(dateStr)
  if (!Number.isFinite(idx) || idx < 1) return null

  const odd = idx % 2 === 1
  const languageSubject = odd ? 'chinese' : 'english'
  const languageIndex = odd ? (idx + 1) / 2 : idx / 2

  const hasMath = idx <= DOCX_DAYS
  const hasLanguage = languageIndex <= DOCX_DAYS

  return {
    date: dateStr,
    dayIndex: idx,
    cycle: cycleOfIndex(idx),
    week: Math.ceil(idx / 7),
    languageSubject,
    languageIndex: hasLanguage ? languageIndex : null,
    mathDay: hasMath ? idx : null,
    codingDay: hasMath ? idx : null,
    status: hasMath || hasLanguage ? 'ready' : 'pending',
  }
}

/** 今天（或指定日期）是否允许打开 */
export function isUnlocked(dateStr) {
  if (!Number.isFinite(parseDate(dateStr).getTime())) return false
  return dateStr === todayStr()
}

/** 列出锚点起的一段日期安排（首页日历用） */
export function scheduleRange(fromStr, count) {
  const out = []
  const start = Math.max(1, dayIndex(fromStr))
  for (let i = 0; i < count; i++) {
    const idx = start + i
    const s = scheduleFor(dateOfIndex(idx))
    if (s) out.push(s)
  }
  return out
}

/** 把某一天安排里的具体内容取出来 */
export function contentFor(dateStr) {
  const s = scheduleFor(dateStr)
  if (!s) return null
  const days = getDays()
  const pick = (n) => (n ? days.find((d) => d.day === n) || null : null)
  const mathDay = pick(s.mathDay)
  const codingDay = pick(s.codingDay)

  // 语文第 i 篇 = docx 第 i 天的语文；英语第 i 段 = docx 第 i 天的英语
  const chineseList = days.map((d) => d.chinese)
  const englishList = days.map((d) => d.english)
  const english = s.languageSubject === 'english' ? englishList[s.languageIndex - 1] || null : null

  return {
    schedule: s,
    math: mathDay ? mathDay.math : null,
    chinese: s.languageSubject === 'chinese' ? chineseList[s.languageIndex - 1] || null : null,
    english: english ? { ...english, dialogues: english.dialogues.slice(0, 1), sentences: [], task: '', tip: '', parentTip: '' } : null,
    englishExercises: null,
    coding: codingDay ? codingDay.coding : null,
  }
}
