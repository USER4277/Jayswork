import { useEffect, useState } from 'react'
import { api } from './api'
import type { DayContent, Subject, SubmitResult } from '../types'

export function useHomework<T>(date: string, subject: Subject) {
  const [day, setDay] = useState<DayContent | null>(null)
  const [answers, setAnswers] = useState<Record<string, T>>({})
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [error, setError] = useState('')
  const [loadedDate, setLoadedDate] = useState('')
  const [correctingKey, setCorrectingKey] = useState<string | null>(null)
  const key = `jayswork:draft:${date}:${subject}`

  useEffect(() => {
    let cancelled = false
    setDay(null)
    setResult(null)
    setError('')
    setLoadedDate('')
    Promise.all([api.day(date, subject), api.attempts(date, subject)])
      .then(([content, saved]) => {
        if (cancelled) return
        let restored = Object.fromEntries(Object.entries(saved.answers).map(([question, answer]) => [question, subject === 'math' ? { parts: answer.parts || [], text: answer.text || '' } : subject === 'chinese' ? answer.text || '' : answer.value || '']))
        try {
          const draft = JSON.parse(localStorage.getItem(key) || 'null')
          if (draft && typeof draft === 'object' && !Array.isArray(draft)) restored = draft
        } catch {}
        setAnswers(restored as Record<string, T>)
        setDay(content)
        if (subject !== 'math') setResult(saved.result)
        setLoadedDate(date)
      })
      .catch((failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : '作业加载失败，请重试'))
    return () => { cancelled = true }
  }, [date, subject, key])

  useEffect(() => {
    if (loadedDate !== date) return
    try { localStorage.setItem(key, JSON.stringify(answers)) } catch {}
  }, [answers, date, key, loadedDate])

  const submitCorrection = async (questionKey: string) => {
    if (correctingKey) return null
    setCorrectingKey(questionKey)
    setError('')
    try {
      const answer = subject === 'math' ? answers[questionKey] : subject === 'chinese' ? { text: answers[questionKey] || '' } : { value: answers[questionKey] || '' }
      const next = await api.correct(date, subject, questionKey, answer)
      setResult(next)
      return next
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '订正提交失败，请重试')
      return null
    } finally { setCorrectingKey(null) }
  }

  return { day, answers, setAnswers, result, setResult, error, setError, correctingKey, submitCorrection }
}