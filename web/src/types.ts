// 与后端 homework.json / API 对应的类型

export type Subject = 'math' | 'chinese' | 'english' | 'coding'

export interface Schedule {
  date: string
  dayIndex: number
  cycle: number
  week: number
  languageSubject: 'chinese' | 'english'
  languageIndex: number | null
  mathDay: number | null
  codingDay: number | null
  status: 'ready' | 'pending' | 'before'
}

export interface AnswerPart {
  kind: 'number' | 'choice' | 'ranking' | 'expression' | 'lines' | 'grid'
  label: string
  value?: number | string | string[][] | string[] | null
  options?: string[]
  numbers?: number[]
  target?: number
  rows?: number
  cols?: number
  values?: number
  boxRows?: number
  boxCols?: number
  given?: string[][]
  items?: { name: string; price: number }[]
  budget?: number
}

export interface MathQuestion {
  no: number
  prompt: string
  rawPrompt: string
  figure: SudokuFigure | Grid3Figure | AsciiFigure | null
  notes: string[]
  answer: { parts: AnswerPart[]; aiText?: boolean; aiPrompt?: string }
  reference: string
  solution?: string[][] | null
}

export interface SudokuFigure {
  type: 'sudoku'
  rows: number
  cols: number
  boxRows: number
  boxCols: number
  values: number
}

export interface Grid3Figure {
  type: 'grid3'
  rows: number
  cols: number
}

export interface AsciiFigure {
  type: 'ascii'
  lines: string[]
}

export interface MathGroup {
  key: string
  title: string
  hint: string
  questions: MathQuestion[]
}

export interface ChineseQuestion {
  no: number
  prompt: string
  reference: string
  explanation?: string
}

export interface ChineseContent {
  title: string
  source: string
  passage: string
  questions: ChineseQuestion[]
}

export interface DialogueLine {
  speaker: string
  en: string
  zh: string
}

export interface EnglishContent {
  theme: string
  scene: string
  dialogues: { title: string; lines: DialogueLine[] }[]
  sentences: string[]
  task: string
  tip: string
  parentTip: string
}

export interface EnglishChoice {
  type: 'listen_choose' | 'zh_choose_en'
  prompt: string
  audio: string
  options: string[]
  answer: string
}

export interface EnglishExercises {
  listening: EnglishChoice[]
  dialogue: EnglishChoice[]
  shadowing: { en: string; zh: string }[]
}

export interface CodingContent {
  project: string
  projectTitle: string
  dayNo: number | null
  dayTitle: string
  goal: string
  features?: string[]
  playtest?: string
  readFirst: string
  steps: string[]
  prompts: { label: string; text: string }[]
  saveTip: string
  selfCheck: string
  gain: string
  learned: string
}

export interface DayContent {
  schedule: Schedule
  math: { groups: MathGroup[] } | null
  chinese: ChineseContent | null
  english: EnglishContent | null
  englishExercises: EnglishExercises | null
  coding: CodingContent | null
  progress: ProgressRow[]
  locked: boolean
}

export interface ProgressRow {
  subject: Subject
  status: string
  score: number | null
  total: number | null
  submitted_at: string | null
}

export interface GradeResult {
  key: string
  no: number
  group: string
  groupTitle: string
  status: 'correct' | 'partial' | 'wrong' | 'pending'
  correct: boolean
  score: number
  message: string
  errorReason?: string
  hint?: string
  parts: { label: string; correct: boolean; expected: unknown; actual: unknown; message: string }[]
  expected?: string
  actual?: string
  pendingAi?: boolean
  source?: 'local-reference'
  referenceAnswer?: string
  explanation?: string
  workedSolution?: {
    title: string
    steps: string[]
    column?: {
      upper: string
      lower: string
      operator: '+' | '-'
      result: string
      carries: (number | null)[]
      adjusted: (number | null)[]
      borrowMarks: boolean[]
      steps: string[]
    }
  } | null
  ai?: AiFeedback
}

export interface AiFeedback {
  判定: string
  得分: number
  讲解: string
  错误原因: string
  订正提示: string
}

export interface SubmitResult {
  date: string
  subject: Subject
  subjectLabel: string
  total: number
  correct: number
  pending: number
  score: number
  results: GradeResult[]
  wrongCount: number
}

export interface WrongItem {
  id: number
  date: string
  subject: Subject
  cycle: number
  questionKey: string
  questionText: string
  myAnswer: string
  correctAnswer: string
  reason: string
  explanation: string
  knowledgePoint: string[]
  mastery: number
  kind: 'wrong' | 'partial'
  wrongCount: number
  nextReviewDate: string | null
  due: boolean
}

export interface WrongCycle {
  cycle: number
  range: { start: string; end: string }
  label: string
  count: number
  mastered: number
  items: WrongItem[]
}

export interface WrongGroup {
  subject: Subject
  label: string
  total: number
  cycles: WrongCycle[]
}

export interface Topic {
  id: string
  name: string
  domain: string
  grade: number
  semester: string
  chapter: string
  type: string
  description: string
}

export interface GraphEdge {
  source: string
  target: string
  strength: 'hard' | 'soft'
  reason: string
}
