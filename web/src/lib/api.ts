import type {
  DayContent,
  EnglishExercises,
  GradeResult,
  Schedule,
  SubmitResult,
  Topic,
  GraphEdge,
  WrongGroup,
  Subject,
} from '../types'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败（${res.status}）`) as Error & {
      status?: number
      locked?: boolean
    }
    err.status = res.status
    err.locked = data?.locked
    throw err
  }
  return data as T
}

export interface TodayOverview {
  date: string
  schedule: Schedule
  locked: boolean
  hasMath: boolean
  hasChinese: boolean
  hasEnglish: boolean
  hasCoding: boolean
  progress: { subject: Subject; status: string; score: number; total: number }[]
  aiEnabled: boolean
}

export interface CalendarItem extends Schedule {
  locked: boolean
  isToday: boolean
}

export const api = {
  today: (date?: string) =>
    req<TodayOverview>(`/homework/today${date ? `?date=${date}` : ''}`),

  calendar: (start?: string, count = 28) =>
    req<{ anchor: string; totalDays: number; docxDays: number; today: string; items: CalendarItem[] }>(
      `/homework/calendar?start=${start || ''}&count=${count}`
    ),

  day: (date: string) => req<DayContent>(`/homework/date/${date}`),

  submit: (date: string, subject: Subject, answers: Record<string, unknown>) =>
    req<SubmitResult>('/homework/submit', {
      method: 'POST',
      body: JSON.stringify({ date, subject, answers }),
    }),

  codingNote: (date: string, gain: string, learned: string, checklist: Record<string, boolean>) =>
    req<{ ok: boolean }>('/homework/coding-note', {
      method: 'POST',
      body: JSON.stringify({ date, gain, learned, checklist }),
    }),

  codingNoteGet: (date: string) =>
    req<{ date: string; gain: string; learned: string; checklist: Record<string, boolean> }>(
      `/homework/coding-note/${date}`
    ),

  projects: () => req<Record<string, { title: string; subtitle: string; rules: string[]; checklist: { no: string; item: string; how: string }[] }>>('/homework/projects'),

  aiStatus: () => req<{ enabled: boolean }>('/ai/status'),

  wrongBook: (subject?: string, cycle?: number) =>
    req<{ today: string; groups: WrongGroup[] }>(
      `/review/wrong?${subject ? `subject=${subject}` : 'subject=all'}${
        cycle ? `&cycle=${cycle}` : ''
      }`
    ),

  due: () =>
    req<{ today: string; count: number; items: unknown[] }>('/review/due'),

  markMastered: (id: number, mastered: boolean) =>
    req<{ ok: boolean }>(`/review/wrong/${id}/master`, {
      method: 'POST',
      body: JSON.stringify({ mastered }),
    }),

  retryWrong: (id: number, correct: boolean) =>
    req<{ ok: boolean; nextReviewDate: string }>(`/review/wrong/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ correct }),
    }),

  report: (from?: string) => req<ReportData>(`/review/report${from ? `?from=${from}` : ''}`),

  topics: (subject = 'math', maxGrade = 6) =>
    req<{ topics: Topic[]; dependencies: GraphEdge[] }>(
      `/graph/topics?subject=${subject}&maxGrade=${maxGrade}`
    ),

  topic: (id: string, subject = 'math') =>
    req<TopicDetail>(`/graph/topic/${id}?subject=${subject}`),

  practice: (questionId: string, answer: string, subject = 'math') =>
    req<{ id: string; correct: boolean; expected: string; explanation: string }>(
      '/graph/practice',
      { method: 'POST', body: JSON.stringify({ questionId, answer, subject }) }
    ),

  parentLogin: (pin: string) => req<{ ok: boolean }>('/parent/login', { method: 'POST', body: JSON.stringify({ pin }) }),

  parentSettings: () => req<Record<string, unknown>>('/parent/settings'),

  parentSettingsSave: (patch: Record<string, unknown>) =>
    req<{ ok: boolean }>('/parent/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  parentAnswers: () => req<ParentAnswerDay[]>('/parent/answers'),

  recordings: () => req<{ items: { file: string; date: string; size: number; mtime: string }[] }>('/parent/recordings'),

  startSession: (date: string) =>
    req<{ sessionId: string; date: string }>('/watch/sessions', { method: 'POST', body: JSON.stringify({ date }) }),
}

export interface ParentAnswerDay {
  day: number
  math: {
    key: string
    title: string
    questions: { no: number; prompt: string; reference: string }[]
  }[]
  chinese: {
    title: string
    passage: string
    questions: { no: number; prompt: string; reference: string }[]
  } | null
  english: {
    theme: string
    scene: string
    dialogues: { title: string; lines: { speaker: string; en: string; zh: string }[] }[]
    sentences: string[]
  }
}

export interface TopicDetail {
  topic: Topic & {
    masteryCriteria: string[]
    diagnostic: { question: string; answer: string } | null
    standards: { id: string; confidence: string; note?: string }[]
  }
  prerequisites: { id: string; strength: string; reason: string; name: string }[]
  unlocks: { id: string; strength: string; reason: string; name: string }[]
  questions: {
    id: string
    type: string
    difficulty: string
    prompt: string
    choices: { key: string; text: string }[]
    explanation: string
  }[]
}

export interface ReportData {
  subjects: { subject: string; label: string; total: number; correct: number; rate: number }[]
  byDate: { date: string; total: number; correct: number; rate: number }[]
  wrongByCycle: { cycle: number; wrong: number }[]
  progress: { date: string; subject: string; status: string; score: number; total: number }[]
  cycles: { cycle: number; start: string; end: string }[]
}

export type { GradeResult, EnglishExercises }
