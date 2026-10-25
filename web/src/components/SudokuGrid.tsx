import { cn } from '../lib/format'

interface Props {
  rows: number
  cols: number
  boxRows: number
  boxCols: number
  values: number
  /** 题目给定的格子（不可改） */
  given: string[][]
  value: string[][]
  onChange: (grid: string[][]) => void
  /** 批改后标出出错的格子 */
  errors?: { r: number; c: number }[]
}

/**
 * 可填写的数独格子。
 * 粗线按 boxRows / boxCols 划分小方框，和题目说明一致。
 */
export default function SudokuGrid({
  rows,
  cols,
  boxRows,
  boxCols,
  values,
  given,
  value,
  onChange,
  errors = [],
}: Props) {
  const errorSet = new Set(errors.map((e) => `${e.r},${e.c}`))

  const setCell = (r: number, c: number, v: string) => {
    const next = value.map((row) => [...row])
    next[r][c] = v
    onChange(next)
  }

  const cellSize = 44

  return (
    <div className="inline-block rounded-lg border-2 border-[var(--color-ink)] bg-white">
      <div
        style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cellSize}px)` }}
        role="grid"
        aria-label="数独填格"
      >
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const fixed = (given[r]?.[c] || '').trim()
            const v = value[r]?.[c] ?? ''
            const isError = errorSet.has(`${r},${c}`)
            const borderRight = (c + 1) % boxCols === 0 && c !== cols - 1
            const borderBottom = (r + 1) % boxRows === 0 && r !== rows - 1
            return (
              <div
                key={`${r}-${c}`}
                role="gridcell"
                className={cn(
                  'relative flex items-center justify-center',
                  borderRight && 'border-r-2 border-[var(--color-ink)]',
                  borderBottom && 'border-b-2 border-[var(--color-ink)]',
                  isError && 'bg-red-50'
                )}
              >
                <input
                  value={v}
                  disabled={Boolean(fixed)}
                  inputMode="numeric"
                  maxLength={1}
                  aria-label={`第${r + 1}行第${c + 1}格`}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '')
                    const n = raw ? Number(raw) : 0
                    setCell(r, c, n >= 1 && n <= values ? String(n) : '')
                  }}
                  className={cn(
                    'h-full w-full bg-transparent text-center text-lg font-medium outline-none',
                    fixed
                      ? 'cursor-default text-[var(--color-ink)]'
                      : 'text-[var(--color-math)] focus:bg-[var(--color-math-soft)]'
                  )}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
