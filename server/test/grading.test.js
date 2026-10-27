import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadHomework } from '../src/content.js'
import { checkSudoku, checkPurchaseLines, gradeQuestion, checkExpression } from '../src/grading.js'
import { columnCalculation, workedSolution } from '../src/math-solutions.js'

test('worked arithmetic follows brackets, precedence, and left-to-right operations', () => {
  const steps = workedSolution({ prompt: '（24 + 12） ÷ 6 × 2 − 3 = ____' }, 'arith').steps
  assert.equal(steps.length, 4)
  assert.match(steps[0], /括号.*24 \+ 12 = 36/)
  assert.match(steps[1], /36 ÷ 6 = 6/)
  assert.match(steps[2], /6 × 2 = 12/)
  assert.match(steps[3], /12 − 3 = 9/)
})

test('column arithmetic aligns digits and computes carries and borrowing through zero', () => {
  for (const [expression, expected] of [['3456+1237',4693],['2648+1505',4153],['5789−2341',3448],['4021−1675',2346],['4000-1',3999],['9999+1',10000],['0-0',0],['9+1',10]]) {
    const solution = columnCalculation(expression)
    assert.equal(Number(solution.result), expected)
    assert.equal(solution.upper.length, solution.result.length)
    assert.equal(solution.lower.length, solution.result.length)
  }
  assert.deepEqual(columnCalculation('3456+1237').carries, [null,null,1,null])
  assert.deepEqual(columnCalculation('4021-1675').adjusted, [3,9,11,11])
  assert.match(columnCalculation('4000-1').steps[0], /连续借位/)
  assert.equal(columnCalculation('1-2'), null)
  assert.equal(columnCalculation('10000+1'), null)
})

test('sudoku rejects empty, malformed and out-of-range boards', () => {
  assert.equal(checkSudoku([], 4, 2, 2, []).ok, false)
  assert.equal(checkSudoku([['1']], 4, 2, 2, []).ok, false)
  const board = [['1', '2', '3', '4'], ['3', '4', '1', '2'], ['2', '1', '4', '3'], ['4', '3', '2', '1']]
  assert.equal(checkSudoku(board, 4, 2, 2, []).ok, true)
  board[0][0] = '5'
  assert.equal(checkSudoku(board, 4, 2, 2, []).ok, false)
})

test('purchases require the requested number of distinct nonzero plans', () => {
  const spec = { rows: 5, budget: 10, items: [{ name: '铅笔', price: 1 }] }
  assert.equal(checkPurchaseLines([], spec).ok, false)
  assert.equal(checkPurchaseLines(['1支铅笔'], spec).ok, false)
  assert.equal(checkPurchaseLines(['1支铅笔', '2支铅笔', '3支铅笔', '4支铅笔', '5支铅笔'], spec).ok, true)
})

test('24-point answers must be distinct and use exactly the required numbers', () => {
  const part = { kind: 'expression', numbers: [2, 3, 4, 5], target: 24 }
  const question = { answer: { parts: [{ ...part, label: '第一种' }, { ...part, label: '第二种' }] } }
  const answer = { parts: [{ label: '第一种', value: '(5+3+4)*2' }, { label: '第二种', value: '(5 + 3 + 4) * 2' }] }
  assert.equal(gradeQuestion(question, answer).correct, false)
  assert.equal(checkExpression('(5+3+4)*2', part.numbers, 24).ok, true)
  assert.equal(checkExpression('24', part.numbers, 24).ok, false)
})

test('numeric answers cannot contain a list of guesses', () => {
  const question = { answer: { parts: [{ kind: 'number', label: '答案', value: 4 }] } }
  assert.equal(gradeQuestion(question, { parts: [{ label: '答案', value: '4,5,6' }] }).correct, false)
  assert.equal(gradeQuestion(question, { parts: [{ label: '答案', value: '４' }] }).correct, true)
})

test('all 28 easy extension questions grade locally and leave other math questions unchanged', () => {
  const original = JSON.parse(fs.readFileSync(new URL('../../作业/homework.json', import.meta.url), 'utf8'))
  let count = 0
  for (const day of loadHomework().days) {
    assert.deepEqual(day.math.groups.filter((group) => ['arith', 'addsub'].includes(group.key)), original.days.find((item) => item.day === day.day).math.groups.filter((group) => ['arith', 'addsub'].includes(group.key)))
    const questions = day.math.groups.find((group) => group.key === 'extend').questions
    assert.equal(questions.length, 2)
    for (const question of questions) {
      const parts = question.answer.parts.map((part) => ({ label: part.label, value: part.kind === 'grid' ? [['1','2','3','4'],['3','4','1','2'],['2','1','4','3'],['4','3','2','1']] : part.value }))
      const result = gradeQuestion(question, { parts, text: '' })
      assert.equal(result.correct, true, `day ${day.day}, question ${question.no}`)
      assert.equal(result.needAi, false)
      assert.equal(gradeQuestion(question, { parts: [], text: '' }).correct, false)
      count++
    }
  }
  assert.equal(count, 28)
})

test('all 28 word problems have local step-by-step methods and corrected reference values', () => {
  const days = loadHomework().days
  let count = 0
  for (const day of days) {
    for (const question of day.math.groups.find((group) => group.key === 'word').questions) {
      const solution = workedSolution(question, 'word')
      assert.ok(solution.steps.length >= 3)
      assert.match(solution.steps.at(-1), /答：/)
      count++
    }
  }
  assert.equal(count, 28)
  assert.equal(days[5].math.groups.find((group) => group.key === 'word').questions[1].answer.parts[0].value, 144)
  assert.equal(days[13].math.groups.find((group) => group.key === 'word').questions[1].answer.parts[0].value, 46)
})