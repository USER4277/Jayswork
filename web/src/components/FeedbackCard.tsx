import type { GradeResult } from '../types'
import SpeechButton from './SpeechButton'
import { cn } from '../lib/format'
import WorkedSolution from './WorkedSolution'

interface Props {
  result: GradeResult
  /** 显示题目序号和标题 */
  no?: number
  title?: string
  openEnded?: boolean
}

const STATUS_STYLE = {
  correct: { label: '答对了', box: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700' },
  partial: { label: '基本对了，再补一点', box: 'border-sky-200 bg-sky-50', text: 'text-sky-700' },
  wrong: { label: '再想想', box: 'border-amber-200 bg-amber-50', text: 'text-amber-700' },
  pending: { label: '等 AI 老师批改', box: 'border-slate-200 bg-slate-50', text: 'text-slate-600' },
} as const

/** 一道题的批改结果 */
export default function FeedbackCard({ result, no, title, openEnded = false }: Props) {
  const style = STATUS_STYLE[result.status]
  const speakText = [result.message, result.errorReason, result.hint, result.referenceAnswer, result.explanation, ...(result.workedSolution?.steps || [])].filter(Boolean).join('。')

  return (
    <div className={cn('rounded-xl border p-3', style.box)}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-0.5 shrink-0 text-sm font-semibold', style.text)}>
          {openEnded ? '阅读建议' : style.label}
        </span>
        <div className="min-w-0 flex-1">
          {no !== undefined && (
            <div className="text-[13px] font-medium text-[var(--color-ink)]">
              第 {no} 题{title ? ` · ${title}` : ''}
            </div>
          )}
          {result.message && (
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">{result.message}</p>
          )}
          {result.errorReason && result.errorReason !== result.message && (
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              错在哪：{result.errorReason}
            </p>
          )}
          {result.hint && (
            <p className="mt-1 text-sm leading-relaxed text-emerald-800">小提示：{result.hint}</p>
          )}
          {result.parts?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.parts.map((p) => (
                <li key={p.label} className="text-[13px]">
                  <span className={p.correct ? 'text-emerald-700' : 'text-amber-700'}>
                    {p.correct ? '✓' : '✗'} {p.label}
                  </span>
                  {!p.correct && (
                    <span className="text-[var(--color-ink-soft)]">
                      {' '}
                      你写的 {String(p.actual ?? '（空）')}，正确答案是 {String(p.expected ?? '')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {result.referenceAnswer && <div className="mt-3 space-y-2 border-t border-[var(--color-line)] pt-3"><h4 className="text-[13px] font-semibold">{openEnded ? '参考思路' : '参考解答'}</h4><p className="whitespace-pre-line text-sm leading-relaxed">{result.referenceAnswer}</p>{result.explanation && <><h4 className="text-[13px] font-semibold">讲解</h4><p className="whitespace-pre-line text-sm leading-relaxed">{result.explanation}</p></>}</div>}
          {result.workedSolution && <WorkedSolution solution={result.workedSolution} />}
          {speakText && <SpeechButton text={speakText} className="mt-2" label="听讲解" />}
        </div>
      </div>
    </div>
  )
}
