/**
 * 自动批改。
 *
 * 判分器的种类和作业/homework.json 里 answer.parts[].kind 一一对应：
 *   number      数值相等
 *   choice      取值一致
 *   ranking     有序序列完全一致
 *   expression  24 点：表达式求值 + 数字多重集校验（有理数精确运算）
 *   lines       采购员：逐行解析「物品 + 数量」，校验总价不超过预算
 *   grid        数独：按行/列/宫校验
 *   text        纯开放题 → 交给 AI
 *
 * 另外还有两种题目级判分：
 *   text+number 数字部分自动判，文字部分交给 AI
 *   aiText      题目需要 AI 批改文字
 */

// --------------------------------------------------------------------------
// 归一化
// --------------------------------------------------------------------------

/** 全角 → 半角，常见数学符号统一 */
export function normalize(text) {
  if (text === null || text === undefined) return ''
  let s = String(text)
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  s = s.replace(/　/g, ' ')
  s = s.replace(/[−–—]/g, '-')
  s = s.replace(/[＋]/g, '+')
  s = s.replace(/[×✕✖]/g, '*')
  s = s.replace(/[÷]/g, '/')
  s = s.replace(/[.．。]/g, '.')
  s = s.replace(/[…]/g, '...')
  s = s.replace(/[，]/g, ',')
  return s.trim()
}

/** 抽出文本里的第一个数字（支持负数和小数） */
export function extractNumber(text) {
  const s = normalize(text)
  const m = s.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** 抽出文本里的所有数字 */
export function extractNumbers(text) {
  const s = normalize(text)
  return (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
}

/** 「8余3」「8……3」「商8余3」→ {quotient, remainder} */
export function parseQuotientRemainder(text) {
  const s = normalize(text)
  const m = s.match(/(\d+)\s*(?:余|余数|\.{2,}|…)\s*(\d+)/)
  if (m) return { quotient: Number(m[1]), remainder: Number(m[2]) }
  const nums = extractNumbers(s)
  if (nums.length >= 2) return { quotient: nums[0], remainder: nums[1] }
  return null
}

// --------------------------------------------------------------------------
// 有理数（24 点用，避免浮点误差）
// --------------------------------------------------------------------------

function rat(n, d = 1n) {
  if (d === 0n) throw new Error('除以零')
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n < 0n ? -n : n, d)
  return { n: n / g, d: d / g }
}

function gcd(a, b) {
  while (b) {
    const t = a % b
    a = b
    b = t
  }
  return a || 1n
}

const ratAdd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d)
const ratSub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d)
const ratMul = (a, b) => rat(a.n * b.n, a.d * b.d)
const ratDiv = (a, b) => rat(a.n * b.d, a.d * b.n)

/**
 * 递归下降解析算式：只允许 + - * / ( ) 和数字。
 * 返回 { value: {n,d}, numbers: number[] }
 */
export function parseExpression(input) {
  const cleaned = normalize(input).replace(/\s+/g, '')
  if (!cleaned) throw new Error('算式为空')
  const bad = cleaned.match(/[^0-9+\-*/().]/)
  if (bad) throw new Error(`算式里有不认识的符号「${bad[0]}」`)
  const s = cleaned
  let i = 0
  const numbers = []

  const peek = () => s[i]
  const eat = (ch) => {
    if (s[i] === ch) {
      i++
      return true
    }
    return false
  }

  function parseExpr() {
    let left = parseTerm()
    for (;;) {
      if (eat('+')) left = ratAdd(left, parseTerm())
      else if (eat('-')) left = ratSub(left, parseTerm())
      else return left
    }
  }

  function parseTerm() {
    let left = parseFactor()
    for (;;) {
      if (eat('*')) left = ratMul(left, parseFactor())
      else if (eat('/')) left = ratDiv(left, parseFactor())
      else return left
    }
  }

  function parseFactor() {
    if (eat('-')) return ratSub(rat(0n), parseFactor())
    if (eat('(')) {
      const v = parseExpr()
      if (!eat(')')) throw new Error('括号不匹配')
      return v
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i))
    if (!m) throw new Error('找不到数字')
    i += m[0].length
    const num = Number(m[0])
    numbers.push(num)
    return rat(BigInt(Math.round(num * 1000)), 1000n)
  }

  const value = parseExpr()
  if (i < s.length) throw new Error('算式末尾有多余内容')
  return { value, numbers }
}

/** 校验一个 24 点算式：结果等于目标值，且用到的数字恰好是给定数字 */
export function checkExpression(input, expectedNumbers, target) {
  let parsed
  try {
    parsed = parseExpression(input)
  } catch (err) {
    return { ok: false, reason: err.message }
  }
  const { value, numbers } = parsed
  const targetRat = rat(BigInt(Math.round(target * 1000)), 1000n)
  if (value.n !== targetRat.n || value.d !== targetRat.d) {
    return { ok: false, reason: `算出来是 ${formatRat(value)}，不是 ${target}` }
  }
  const used = numbers.slice().sort((a, b) => a - b)
  const want = expectedNumbers.slice().sort((a, b) => a - b)
  if (used.length !== want.length || used.some((v, idx) => v !== want[idx])) {
    return {
      ok: false,
      reason: `用到的数字是 ${used.join('、')}，应该是 ${want.join('、')}（每个数字只能用一次）`,
    }
  }
  return { ok: true, reason: '' }
}

export function formatRat(r) {
  if (r.d === 1n) return r.n.toString()
  const num = Number(r.n) / Number(r.d)
  return String(Math.round(num * 1000) / 1000)
}

// --------------------------------------------------------------------------
// 数独
// --------------------------------------------------------------------------

/**
 * 校验数独答案。
 * @param {string[][]} grid 学生的填格（空字符串表示没填）
 * @param {number} values 宫内可用数字个数（4 或 6）
 * @param {number} boxRows 宫的行数
 * @param {number} boxCols 宫的列数
 * @param {string[][]} given 题目给定的格子（用于判断是否动了给定值）
 */
export function checkSudoku(grid, values, boxRows, boxCols, given) {
  const rows = grid.length
  const cols = grid[0]?.length || 0
  const allowed = Array.from({ length: values + 1 }, (_, i) => String(i + 1))
  const errors = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = (grid[r][c] || '').trim()
      const g = ((given?.[r]?.[c] || '').trim())
      if (!v) {
        errors.push({ r, c, msg: `第 ${r + 1} 行第 ${c + 1} 格还没填` })
        continue
      }
      if (!allowed.includes(v)) {
        errors.push({ r, c, msg: `第 ${r + 1} 行第 ${c + 1} 格填了 ${v}，只能填 1 到 ${values}` })
        continue
      }
      if (g && g !== v) {
        errors.push({ r, c, msg: `第 ${r + 1} 行第 ${c + 1} 格是题目给定的 ${g}，不能改` })
      }
    }
  }

  // 同一行/列/宫里不能重复
  const dup = (indices, label, posLabel) => {
    const seen = new Map()
    for (const [r, c] of indices) {
      const v = (grid[r][c] || '').trim()
      if (!v || !allowed.includes(v)) continue
      if (seen.has(v)) {
        const [pr, pc] = seen.get(v)
        errors.push({
          r,
          c,
          msg: `${label}里 ${v} 重复了（${posLabel(pr, pc)} 和 ${posLabel(r, c)}）`,
        })
      } else {
        seen.set(v, [r, c])
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    dup(
      Array.from({ length: cols }, (_, c) => [r, c]),
      `第 ${r + 1} 行`,
      (_r, c) => `第 ${c + 1} 列`
    )
  }
  for (let c = 0; c < cols; c++) {
    dup(
      Array.from({ length: rows }, (_, r) => [r, c]),
      `第 ${c + 1} 列`,
      (r) => `第 ${r + 1} 行`
    )
  }
  for (let br = 0; br < rows; br += boxRows) {
    for (let bc = 0; bc < cols; bc += boxCols) {
      const cells = []
      for (let i = 0; i < boxRows; i++) {
        for (let j = 0; j < boxCols; j++) cells.push([br + i, bc + j])
      }
      dup(cells, `第 ${br / boxRows + 1} 行第 ${bc / boxCols + 1} 个小方框`, (r, c) =>
        `第 ${r + 1} 行第 ${c + 1} 列`)
    }
  }

  return { ok: errors.length === 0, errors }
}

// --------------------------------------------------------------------------
// 采购员：解析「2 本笔记本 + 1 支铅笔」
// --------------------------------------------------------------------------

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

export function parsePurchaseLine(line, items) {
  const s = normalize(line)
  if (!s) return null
  const found = []
  for (const item of items) {
    const re = new RegExp(`(\\d+|[一二两三四五六七八九十])?\\s*[本支块个]?\\s*${item.name}`)
    const m = re.exec(s)
    if (m) {
      const qty = m[1] ? (/^\d+$/.test(m[1]) ? Number(m[1]) : CN_NUM[m[1]] || 1) : 1
      found.push({ name: item.name, qty, price: item.price })
    }
  }
  if (!found.length) return null
  const total = found.reduce((sum, f) => sum + f.qty * f.price, 0)
  return { items: found, total, count: found.reduce((sum, f) => sum + f.qty, 0) }
}

export function checkPurchaseLines(lines, spec) {
  const errors = []
  const parsed = []
  lines.forEach((line, idx) => {
    const p = parsePurchaseLine(line, spec.items)
    if (!p) {
      errors.push(`第 ${idx + 1} 种买法没看懂，请写成「2 本笔记本 + 1 支铅笔」这样的样子`)
      return
    }
    parsed.push(p)
    if (p.total > spec.budget) {
      errors.push(`第 ${idx + 1} 种买法一共 ${p.total} 元，超过 ${spec.budget} 元了`)
    }
  })
  const sigs = parsed.map((p) => p.items.map((i) => `${i.name}x${i.qty}`).sort().join('+'))
  if (new Set(sigs).size !== sigs.length) {
    errors.push('有几条买法是一样的，要写出 5 种不同的买法')
  }
  return { ok: errors.length === 0, errors, parsed }
}

// --------------------------------------------------------------------------
// 题目级判分
// --------------------------------------------------------------------------

/**
 * 判一道题。
 * @param {object} question 作业内容里的题目
 * @param {object} answer 学生的作答，形如 { parts: [...], text: '...' }
 * @returns {{correct: boolean, score: number, parts: object[], needAi: boolean, message: string}}
 */
export function gradeQuestion(question, answer) {
  const spec = question.answer || {}
  const given = answer?.parts || []
  const results = []
  let allCorrect = true
  let needAi = Boolean(spec.aiText)

  for (const part of spec.parts || []) {
    const submitted = given.find((p) => p.label === part.label) || {}
    const res = gradePart(part, submitted)
    results.push(res)
    if (!res.correct) allCorrect = false
  }

  // 数值部分全对但还需要 AI 判文字时，先按部分正确处理
  const hasNumeric = (spec.parts || []).length > 0
  const score = hasNumeric ? (results.filter((r) => r.correct).length / results.length) * 10 : 0

  let message = ''
  if (!allCorrect) {
    const bad = results.filter((r) => !r.correct)
    message = bad.map((r) => r.message).filter(Boolean).join('；')
  }

  return {
    correct: allCorrect,
    score: allCorrect ? 10 : score,
    parts: results,
    needAi,
    message,
  }
}

function gradePart(part, submitted) {
  const label = part.label || ''
  const actual = submitted.value ?? submitted.text ?? ''

  switch (part.kind) {
    case 'number': {
      const num = extractNumber(actual)
      if (num === null) {
        return { label, correct: false, expected: part.value, actual: actual || '', message: `${label}还没有填` }
      }
      const ok = num === part.value
      return {
        label,
        correct: ok,
        expected: part.value,
        actual: num,
        message: ok ? '' : `${label}答错了，正确答案是 ${part.value}`,
      }
    }

    case 'choice': {
      const ok = String(actual).trim() === String(part.value).trim()
      return {
        label,
        correct: ok,
        expected: part.value,
        actual,
        message: ok ? '' : `${label}选错了，正确答案是「${part.value}」`,
      }
    }

    case 'ranking': {
      const got = Array.isArray(actual) ? actual : []
      const want = part.value || []
      const ok =
        got.length === want.length && got.every((v, i) => String(v) === String(want[i]))
      return {
        label,
        correct: ok,
        expected: want.join(' → '),
        actual: got.join(' → '),
        message: ok ? '' : `${label}不对，正确顺序是 ${want.join(' → ')}`,
      }
    }

    case 'expression': {
      const check = checkExpression(String(actual || ''), part.numbers || [], part.target || 24)
      return {
        label,
        correct: check.ok,
        expected: `用 ${(part.numbers || []).join('、')} 算出 ${part.target}`,
        actual,
        message: check.ok ? '' : `${label}不对：${check.reason}`,
      }
    }

    case 'lines': {
      const lines = Array.isArray(actual) ? actual : []
      const check = checkPurchaseLines(lines, part)
      return {
        label,
        correct: check.ok,
        expected: `写出 ${part.rows} 种买法，每种总价不超过 ${part.budget} 元`,
        actual: lines.join(' / '),
        message: check.ok ? '' : `${label}有问题：${check.errors.join('；')}`,
      }
    }

    case 'grid': {
      const grid = Array.isArray(actual) ? actual : []
      const check = checkSudoku(
        grid,
        part.values || 4,
        part.boxRows || 2,
        part.boxCols || 2,
        part.given
      )
      return {
        label,
        correct: check.ok,
        expected: '每行、每列、每个小方框里的数字都不能重复',
        actual: grid.map((r) => r.join('')).join(' / '),
        message: check.ok ? '' : `数独还没填对：${check.errors.map((e) => e.msg).join('；')}`,
        errors: check.errors,
      }
    }

    default:
      return { label, correct: true, expected: null, actual, message: '' }
  }
}

/**
 * 判英语选择题。
 */
export function gradeChoice(selected, answer) {
  const ok = String(selected || '').trim() === String(answer || '').trim()
  return {
    correct: ok,
    score: ok ? 10 : 0,
    message: ok ? '答对了！' : `再听一遍，正确答案是「${answer}」`,
  }
}
