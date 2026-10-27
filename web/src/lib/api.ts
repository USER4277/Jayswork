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
import { emitHomeworkProgress } from './session'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers || {}) },
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
  if (init?.method === 'POST' && ['/homework/submit', '/homework/correct', '/homework/english-complete', '/homework/coding-complete'].includes(path) && typeof init.body === 'string') {
    const { date } = JSON.parse(init.body)
    if (typeof date === 'string') emitHomeworkProgress(date)
  }
  return data as T
}

export interface TodayOverview {
  date: string
  schedule: Schedule | null
  locked: boolean
  hasMath: boolean
  hasChinese: boolean
  chineseUnlocked: boolean
  hasEnglish: boolean
  hasCoding: boolean
  progress: { subject: Subject; status: string; score: number; total: number }[]
  aiEnabled: boolean
}

export interface CalendarItem extends Schedule {
  locked: boolean
  isToday: boolean
}

export interface VoiceAnswer {
  id: string
  date: string
  questionKey: string
  transcript: string
  mimeType: string
  createdAt: string
  url: string
}

export interface EnglishReading {
  recording: { id: string; transcript: string; url: string } | null
  result: { voiceId: string; score: number; passed: boolean; explanation: string; hint: string; transcript: string; assessmentType: 'transcript-content' } | null
}

const englishReadingPath = (date: string, line?: number) => `/homework/english-reading/${date}${line === undefined ? '' : `/line/${line}`}`

export const api = {
  today: (date?: string) =>
    req<TodayOverview>(`/homework/today${date ? `?date=${date}` : ''}`),

  calendar: (start?: string, count = 28) =>
    req<{ anchor: string; totalDays: number; docxDays: number; today: string; items: CalendarItem[] }>(
      `/homework/calendar?start=${start || ''}&count=${count}`
    ),

  day: (date: string, subject?: Subject) => req<DayContent>(`/homework/date/${date}${subject ? `?subject=${subject}` : ''}`),

  correct: (date: string, subject: Subject, questionKey: string, answer: unknown) =>
    req<SubmitResult>('/homework/correct', { method: 'POST', body: JSON.stringify({ date, subject, questionKey, answers: { [questionKey]: answer } }) }),

  voiceAnswers: (date: string) => req<{ items: VoiceAnswer[] }>(`/homework/voice/${date}`),

  saveVoice: (date: string, questionKey: string, audio: Blob, transcript: string) => {
    const body = new FormData()
    body.append('audio', audio, 'answer.webm')
    body.append('transcript', transcript)
    return req<VoiceAnswer>(`/homework/voice/${date}/${questionKey}`, { method: 'POST', body })
  },

  attempts: (date: string, subject: Subject) =>
    req<{ answers: Record<string, { parts?: { label: string; value: unknown }[]; text?: string; value?: string }>; result: SubmitResult | null }>(`/homework/attempts/${date}/${subject}`),

  settings: () => req<{ monitoring: boolean; deadline: string; speechScoring: boolean }>('/homework/settings'),

  codingComplete: (date: string) => req<{ ok: boolean }>('/homework/coding-complete', { method: 'POST', body: JSON.stringify({ date, playtested: true }) }),

  englishComplete: (date: string) => req<{ ok: boolean }>('/homework/english-complete', { method: 'POST', body: JSON.stringify({ date, completed: true }) }),

  englishReading: (date: string, line?: number) => req<EnglishReading>(englishReadingPath(date, line)),

  gradeEnglishReading: (date: string, audio: Blob, line?: number) => {
    const body = new FormData()
    body.append('audio', audio, 'reading.webm')
    return req<EnglishReading>(englishReadingPath(date, line), { method: 'POST', body })
  },

  retryEnglishReading: (date: string, voiceId: string, line?: number) => req<EnglishReading>(`${englishReadingPath(date, line)}/retry`, { method: 'POST', body: JSON.stringify({ voiceId }) }),

  references: () => req<{ items: { project: string; title: string; unlocked: boolean; url: string }[] }>('/homework/references'),

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

  retryWrong: (id: number, answer: string) =>
    req<{ ok: boolean; correct: boolean; pending?: boolean; message?: string; mastery?: number; nextReviewDate: string }>(`/review/wrong/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
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

  parentLogout: () => req<{ ok: boolean }>('/parent/logout', { method: 'POST', body: '{}' }),

  parentSettings: () => req<Record<string, unknown>>('/parent/settings'),

  parentSettingsSave: async (patch: Record<string, unknown>) => {
    const result = await req<{ ok: boolean }>('/parent/settings', { method: 'PUT', body: JSON.stringify(patch) })
    window.dispatchEvent(new Event('jayswork:settings'))
    return result
  },

  parentAnswers: () => req<ParentAnswerDay[]>('/parent/answers'),

  recordings: () => req<{ items: { file: string; date: string; size: number; mtime: string }[] }>('/parent/recordings'),

  startSession: (date: string) =>
    req<{ sessionId: string; date: string; uploadToken: string }>('/watch/sessions', { method: 'POST', body: JSON.stringify({ date }) }),
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
