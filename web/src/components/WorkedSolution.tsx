import type { GradeResult } from '../types'

export default function WorkedSolution({ solution }: { solution: NonNullable<GradeResult['workedSolution']> }) {
  const column = solution.column
  const places = ['个位', '十位', '百位', '千位', '万位']
  return <section className="mt-3 space-y-3 border-t border-[var(--color-line)] pt-3">
    <h4 className="text-sm font-semibold">{solution.title}</h4>
    {column && <div className="max-w-full overflow-x-auto pb-2">
      <div role="img" aria-label={`${column.upper.trim()} ${column.operator === '+' ? '加' : '减'} ${column.lower.trim()} 等于 ${column.result.trim()}，数位对齐的竖式`} className="grid w-max max-w-full text-center tabular-nums" style={{ gridTemplateColumns: `1.1rem repeat(${column.upper.length}, minmax(1.7rem, 2rem))` }}>
        <span />{[...column.upper].map((_, index) => <span key={`place-${index}`} className="text-[12px] text-[var(--color-ink-soft)]">{places[column.upper.length - index - 1]}</span>)}
        <span />{[...column.upper].map((digit, index) => <span key={`top-${index}`} className="relative flex h-14 items-end justify-center pb-2 text-xl">
          {column.carries[index] !== null && <small className="absolute left-0 top-3 text-[12px] font-semibold text-[var(--color-math-ink)]">{column.carries[index]}</small>}
          {column.borrowMarks[index] && <small className="absolute left-0 top-2 text-base font-bold text-[var(--color-math-ink)]">·</small>}
          {column.adjusted[index] !== null && <small className="absolute right-0 top-0 text-[12px] font-semibold text-[var(--color-math-ink)]">{column.adjusted[index]}</small>}
          <span className={column.adjusted[index] !== null ? 'decoration-1 line-through' : ''}>{digit === ' ' ? '\u00a0' : digit}</span>
        </span>)}
        <span className="flex h-10 items-center justify-center text-xl">{column.operator === '+' ? '+' : '−'}</span>
        {[...column.lower].map((digit, index) => <span key={`bottom-${index}`} className="flex h-10 items-center justify-center text-xl">{digit === ' ' ? '\u00a0' : digit}</span>)}
        <span className="col-span-full border-t-2 border-current" />
        <span />{[...column.result].map((digit, index) => <span key={`result-${index}`} className="flex h-11 items-center justify-center text-xl font-semibold">{digit === ' ' ? '\u00a0' : digit}</span>)}
      </div>
    </div>}
    <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
      {solution.steps.map((step, index) => <li key={index} className="pl-1">{step.replace(/^第\d+步：/, '')}</li>)}
    </ol>
  </section>
}