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
  if (init?.method === 'POST' && (['/homework/submit', '/homework/correct', '/homework/english-complete', '/homework/coding-complete'].includes(path) || /^\/homework\/raz\/\d{4}-\d{2}-\d{2}\/complete$/.test(path)) && typeof init.body === 'string') {
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

export interface EnglishListening {
  questions: { id: string; audio: string; options: string[] }[]
  answers: Record<string, string>
  result: { score: number; passed: boolean; correct: number; total: number; results: { id: string; selected: string; answer: string; correct: boolean }[] } | null
}

export interface RazBook { id: string; title: string; level: string; ready: boolean; hasVideo: boolean; hasTeacherAudio?: boolean; hasOriginalQuiz: boolean }
export interface RazQuestion { id: string; prompt: string; audio?: string; options: { id: string; text: string }[]; source: string; bookTitle?: string }
export interface RazResult { score: number; correct: number; total: number; results: { id: string; selected: string; answer: string; correct: boolean }[] }
export interface RazProfile {
  level: string | null; targetMinutes: number; masteredBooks: number; firstAccuracy: number | null; reviewAccuracy: number | null; recommendedLevel: string | null;
  placement: { index: number; lastPassed: string | null; results: { level: string; score: number }[] }
}
export interface RazLibrary { available: boolean; total: number; ready: number; levels: { level: string; total: number; ready: number }[] }
export interface RazLesson {
  date: string; book: RazBook; kind: 'reading' | 'review'; part: number; parts: number; pages: number; wordCount: number | null; duration: number | null;
  startPage: number; endPage: number; audioStart: number; audioEnd: number | null; questions: RazQuestion[]; reflectionPrompt: string;
  values: { page: number; listened: boolean; reflection: string }; answers?: Record<string, string>; result: RazResult | null;
  outputId: string | null; completed: boolean; resumedFrom?: string; source: string;
}
export type RazState = { date: string; profile: RazProfile; library: RazLibrary } & (
  { mode: 'placement'; placement: { level: string; book: RazBook; pages: number; questions: RazQuestion[]; index: number } } |
  { mode: 'lesson'; lesson: RazLesson }
)

export function getRazApi(testMode = false) {
  const base = testMode ? '/parent/english-test/raz' : '/homework/raz'
  return {
    state: (date: string) => req<RazState>(`${base}/${date}`),
    place: (date: string, index: number, answers: Record<string, string>) => req<{ result: RazResult; finished: boolean; profile: RazProfile }>(`${base}/${date}/placement`, { method: 'POST', body: JSON.stringify({ index, answers }) }),
    progress: (date: string, patch: Partial<RazLesson['values']> & { answers?: Record<string, string> }) => req<RazLesson>(`${base}/${date}/progress`, { method: 'PATCH', body: JSON.stringify(patch) }),
    quiz: (date: string, answers: Record<string, string>) => req<RazLesson>(`${base}/${date}/quiz`, { method: 'POST', body: JSON.stringify({ answers }) }),
    complete: (date: string) => req<RazLesson>(`${base}/${date}/complete`, { method: 'POST', body: JSON.stringify({ date }) }),
    output: (date: string, audio: Blob) => { const body = new FormData(); body.append('audio', audio, 'response.webm'); return req<{ id: string }>(`${base}/${date}/output`, { method: 'POST', body }) },
    asset: (date: string, bookId: string, kind: string) => `${BASE}${base}/${date}/assets/${bookId}/${kind}`,
    recording: (date: string, id: string) => `${BASE}${base}/${date}/output/${id}`,
  }
}

export const parentRaz = {
  info: () => req<RazLibrary & { profile: RazProfile; resourceRoot: string; issues: { level: string; title: string; reason: string }[] }>('/parent/raz'),
  profile: (level: string, targetMinutes: number) => req<RazProfile>('/parent/raz/profile', { method: 'PUT', body: JSON.stringify({ level, targetMinutes }) }),
  dates: (start?: string) => req<{ items: { date: string; dayIndex: number; title: string }[] }>(`/parent/raz/test-dates${start ? `?start=${start}` : ''}`),
  reset: () => req<{ ok: boolean }>('/parent/raz/test-reset', { method: 'POST', body: '{}' }),
  testProfile: (level: string, targetMinutes: number) => req<RazProfile>('/parent/raz/test-profile', { method: 'PUT', body: JSON.stringify({ level, targetMinutes }) }),
  rescan: () => req<{ ok: boolean }>('/parent/raz/rescan', { method: 'POST', body: '{}' }),
}

const englishReadingPath = (date: string, line?: number, prefix = '/homework') => `${prefix}/english-reading/${date}${line === undefined ? '' : `/line/${line}`}`
const englishTestBase = '/parent/english-test'

function uploadEnglishReading(date: string, audio: Blob, line?: number, prefix = '/homework') {
  const body = new FormData()
  body.append('audio', audio, 'reading.webm')
  return req<EnglishReading>(englishReadingPath(date, line, prefix), { method: 'POST', body })
}

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

  englishListening: (date: string) => req<EnglishListening>(`/homework/english-listening/${date}`),

  submitEnglishListening: (date: string, answers: Record<string, string>) => req<EnglishListening>(`/homework/english-listening/${date}`, { method: 'POST', body: JSON.stringify({ answers }) }),

  englishReading: (date: string, line?: number) => req<EnglishReading>(englishReadingPath(date, line)),

  gradeEnglishReading: (date: string, audio: Blob, line?: number) => uploadEnglishReading(date, audio, line),

  retryEnglishReading: (date: string, voiceId: string, line?: number) => req<EnglishReading>(`${englishReadingPath(date, line)}/retry`, { method: 'POST', body: JSON.stringify({ voiceId }) }),

  englishTest: {
    dates: () => req<{ items: { date: string; dayIndex: number; title: string }[] }>(`${englishTestBase}/dates`),
    day: (date: string) => req<DayContent>(`${englishTestBase}/date/${date}`),
    englishReading: (date: string, line?: number) => req<EnglishReading>(englishReadingPath(date, line, englishTestBase)),
    gradeEnglishReading: (date: string, audio: Blob, line?: number) => uploadEnglishReading(date, audio, line, englishTestBase),
    retryEnglishReading: (date: string, voiceId: string, line?: number) => req<EnglishReading>(`${englishReadingPath(date, line, englishTestBase)}/retry`, { method: 'POST', body: JSON.stringify({ voiceId }) }),
    englishComplete: (date: string) => req<{ ok: boolean }>(`${englishTestBase}/english-complete`, { method: 'POST', body: JSON.stringify({ date, completed: true }) }),
    englishListening: (date: string) => req<EnglishListening>(`${englishTestBase}/english-listening/${date}`),
    submitEnglishListening: (date: string, answers: Record<string, string>) => req<EnglishListening>(`${englishTestBase}/english-listening/${date}`, { method: 'POST', body: JSON.stringify({ answers }) }),
    reset: (date: string) => req<{ ok: boolean }>(`${englishTestBase}/reset`, { method: 'POST', body: JSON.stringify({ date }) }),
  },

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
