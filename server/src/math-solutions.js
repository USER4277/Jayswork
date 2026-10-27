import { normalize, parseExpression } from './grading.js'

export function columnCalculation(input) {
  const expression = normalize(input).split('=')[0].trim()
  const match = /^(\d{1,4})\s*([+-])\s*(\d{1,4})$/.exec(expression)
  if (!match) return null
  const upper = Number(match[1])
  const lower = Number(match[3])
  const operator = match[2]
  const result = operator === '+' ? upper + lower : upper - lower
  if (result < 0) return null
  const length = Math.max(String(upper).length, String(lower).length)
  const names = ['个位', '十位', '百位', '千位', '万位']
  const digits = String(upper).padStart(length, '0').split('').reverse().map(Number)
  const lowerDigits = String(lower).padStart(length, '0').split('').reverse().map(Number)
  const original = [...digits]
  const carries = Array(length + 1).fill(0)
  const borrowMarks = Array(length).fill(false)
  const steps = []
  for (let column = 0; column < length; column++) {
    const bottom = lowerDigits[column]
    if (operator === '+') {
      const total = digits[column] + bottom + carries[column]
      carries[column + 1] = Math.floor(total / 10)
      steps.push(`${names[column]}：${digits[column]} + ${bottom}${carries[column] ? ' + 进来的1' : ''} = ${total}，${names[column]}写${total % 10}${total >= 10 ? `，向${names[column + 1]}进1` : '，不进位'}。`)
    } else {
      let borrowing = ''
      if (digits[column] < bottom) {
        let source = column + 1
        while (digits[source] === 0) source++
        const before = digits[source]
        digits[source]--
        borrowMarks[source] = true
        borrowing = `${digits[column]}不够减${bottom}，${source > column + 1 ? `中间的${names.slice(column + 1, source).join('、')}是0，要连续借位。` : ''}从${names[source]}借1，${names[source]}由${before}变成${digits[source]}。`
        for (let bridge = source - 1; bridge > column; bridge--) {
          digits[bridge] = 9
          borrowMarks[bridge] = true
          borrowing += `${names[bridge]}借到10，再借出1给${names[bridge - 1]}，留下9。`
        }
        digits[column] += 10
        borrowing += `${names[column]}变成${digits[column]}。`
      }
      steps.push(`${names[column]}：${borrowing}${digits[column]} − ${bottom} = ${digits[column] - bottom}，${names[column]}写${digits[column] - bottom}。`)
    }
  }
  if (operator === '+' && carries[length]) steps.push(`最高位还有进来的1，在${names[length]}写1。`)
  const width = Math.max(length, String(result).length)
  return {
    upper: String(upper).padStart(width, ' '), lower: String(lower).padStart(width, ' '), operator,
    result: String(result).padStart(width, ' '),
    carries: Array.from({ length: width }, (_, index) => carries[width - index - 1] || null),
    adjusted: Array.from({ length: width }, (_, index) => {
      const column = width - index - 1
      return column < length && digits[column] !== original[column] ? digits[column] : null
    }),
    borrowMarks: Array.from({ length: width }, (_, index) => borrowMarks[width - index - 1] || false), steps,
  }
}

export function workedSolution(question, group) {
  if (group === 'addsub') {
    const column = columnCalculation(question.prompt)
    return column ? { title: '竖式计算', steps: column.steps, column } : null
  }
  if (group === 'arith') {
    try { return { title: '计算顺序', steps: parseExpression(normalize(question.prompt).split('=')[0]).steps } } catch { return null }
  }
  if (group === 'word' && question.explanation) return { title: '解题思路与方法', steps: question.explanation }
  return null
}