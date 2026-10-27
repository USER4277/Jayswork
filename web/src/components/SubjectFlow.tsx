import { Link } from 'react-router-dom'
import type { DayContent, Subject } from '../types'

export default function SubjectFlow({ day, date, subject }: { day: DayContent; date: string; subject: Subject }) {
  const next = subject === 'math' ? day.schedule.languageSubject : subject !== 'coding' && day.coding ? 'coding' : null
  const labels = { chinese: '语文', english: '英语', coding: '编程' }
  return (
    <Link className="inline-block rounded-lg bg-[var(--color-math)] px-4 py-2 text-sm text-white" to={next ? `/${next}/${date}` : '/'}>
      {next ? `继续${labels[next]}作业` : '返回首页查看完成情况'}
    </Link>
  )
}