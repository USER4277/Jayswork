/**
 * 「开始今日作业」这个动作的广播。
 *
 * 首页按钮点下去之后，页面各处（摄像头浮层）都要知道：
 * 用一个很小的发布订阅就够用了，不值得引状态管理库。
 */

import type { TodayOverview } from './api'
import type { Subject } from '../types'

type StartHandler = (date: string) => void

const handlers = new Set<StartHandler>()
const progressHandlers = new Set<StartHandler>()
let homeworkDate: string | null = null

export function nextHomeworkSubject(overview: TodayOverview): Subject | undefined {
  const subjects: Subject[] = []
  if (overview.hasMath) subjects.push('math')
  if (overview.hasChinese) subjects.push('chinese')
  if (overview.hasEnglish) subjects.push('english')
  if (overview.hasCoding) subjects.push('coding')
  return subjects.find((subject) => (subject === 'math' && !overview.chineseUnlocked) || !overview.progress.some((progress) => progress.subject === subject && progress.status === 'submitted'))
}

export function homeworkCompleted(overview: TodayOverview) {
  return Boolean((overview.hasMath || overview.hasChinese || overview.hasEnglish || overview.hasCoding) && !nextHomeworkSubject(overview))
}

export function onHomeworkProgress(fn: StartHandler) {
  progressHandlers.add(fn)
  return () => { progressHandlers.delete(fn) }
}

export function emitHomeworkProgress(date: string) {
  progressHandlers.forEach((fn) => fn(date))
}

export function startHomeworkSession(date: string) {
  homeworkDate = date
  try { sessionStorage.setItem('jayswork:homework-session', date) } catch {}
}

export function homeworkSessionStarted(date: string) {
  try { return (sessionStorage.getItem('jayswork:homework-session') || homeworkDate) === date } catch { return homeworkDate === date }
}

export function onStartSession(fn: StartHandler) {
  handlers.add(fn)
  return () => {
    handlers.delete(fn)
  }
}

export function emitStartSession(date: string) {
  handlers.forEach((fn) => fn(date))
}
