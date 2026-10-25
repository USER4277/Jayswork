/** 各种小工具 */

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

/** 2026-10-26 → 10月26日 */
export function formatDate(dateStr: string, withWeekday = false) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const base = `${m}月${d}日`
  if (!withWeekday) return base
  const date = new Date(y, m - 1, d)
  const names = ['日', '一', '二', '三', '四', '五', '六']
  return `${base} 星期${names[date.getDay()]}`
}

export function weekdayOf(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const names = ['日', '一', '二', '三', '四', '五', '六']
  return names[new Date(y, m - 1, d).getDay()]
}

/** 今天之前的日期用「10月26日」，今天的用「今天」 */
export function friendlyDate(dateStr: string, today: string) {
  if (dateStr === today) return '今天'
  return formatDate(dateStr)
}

export const SUBJECT_META: Record<string, { label: string; color: string; soft: string }> = {
  math: { label: '数学', color: 'var(--color-math)', soft: 'var(--color-math-soft)' },
  chinese: { label: '语文', color: 'var(--color-chinese)', soft: 'var(--color-chinese-soft)' },
  english: { label: '英语', color: 'var(--color-english)', soft: 'var(--color-english-soft)' },
  coding: { label: '编程', color: 'var(--color-coding)', soft: 'var(--color-coding-soft)' },
}

/** 把答案部件的提交值统一成后端期望的形状 */
export function partValue(label: string, raw: string) {
  return { label, value: raw }
}

/** 抄送给家长看的纯文本错题 */
export function wrongItemText(item: {
  questionText: string
  myAnswer: string
  correctAnswer: string
  reason: string
}) {
  return [
    `题目：${item.questionText}`,
    `我写的：${item.myAnswer}`,
    `正确答案：${item.correctAnswer}`,
    item.reason ? `错在哪：${item.reason}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
