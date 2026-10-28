import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Check, ChevronRight, ClipboardCheck, Headphones, History, Mic, RotateCcw, Save, Volume2 } from 'lucide-react'
import { api, getRazApi, type RazLesson, type RazQuestion, type RazResult, type RazState } from '../lib/api'
import { cn, formatDate } from '../lib/format'
import { speak, speechSupported, stopSpeaking } from '../lib/speech'
import { nextHomeworkSubject } from '../lib/session'
import type { Subject } from '../types'
import RazReader from '../components/RazReader'
import Recorder from '../components/Recorder'

type Step = 'review' | 'listen' | 'read' | 'practice' | 'output'
const steps = { review: { title: '旧知复习', icon: History }, listen: { title: '原声听读', icon: Headphones }, read: { title: '绘本阅读', icon: BookOpen }, practice: { title: '理解练习', icon: ClipboardCheck }, output: { title: '我的表达', icon: Mic } }
const message = (failure: unknown) => failure instanceof Error ? failure.message : '暂时未能保存，请重试'

function Questions({ questions, answers, result, disabled, select, play }: { questions: RazQuestion[]; answers: Record<string, string>; result: RazResult | null; disabled: boolean; select: (id: string, value: string) => void; play: (text: string) => void }) {
  return <div className="space-y-5">{questions.map((question, index) => {
    const feedback = result?.results.find(value => value.id === question.id)
    return <fieldset key={question.id} disabled={disabled} className={cn('min-w-0 space-y-3 rounded-lg border border-[var(--color-line)] p-4', feedback && (feedback.correct ? 'bg-emerald-50' : 'bg-red-50'))}>
      <legend className="max-w-full break-words px-1 text-sm font-medium">第 {index + 1} 题{question.bookTitle && ` · ${question.bookTitle}`}</legend>
      <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words leading-relaxed" lang={question.audio ? 'zh-CN' : 'en'}>{question.prompt}</p><button type="button" title="播放读音" aria-label={`播放第${index + 1}题`} onClick={() => play(question.audio || [question.prompt, ...question.options.map(option => option.text)].join('. '))} className="shrink-0 p-2"><Volume2 className="h-5 w-5" /></button></div>
      <div className="grid gap-3 sm:grid-cols-2">{question.options.map(option => <label key={option.id} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] p-3 has-checked:border-[var(--color-english)] has-checked:bg-[var(--color-english-soft)]">
        <input type="radio" name={question.id} value={option.id} checked={answers[question.id] === option.id} onChange={() => select(question.id, option.id)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-english)]" /><span className="min-w-0 break-words leading-relaxed">{option.text}</span>
      </label>)}</div>
      {feedback && <p className={cn('text-sm font-medium', feedback.correct ? 'text-emerald-700' : 'text-red-700')}>{feedback.correct ? '答对了' : `正确答案：${question.options.find(option => option.id === feedback.answer)?.text || feedback.answer}`}</p>}
    </fieldset>
  })}</div>
}

export default function RazEnglishPage({ testMode = false }: { testMode?: boolean }) {
  const { date = '' } = useParams()
  const [course, setCourse] = useState<RazState | null>(null)
  const [step, setStep] = useState<Step>('listen')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [reflection, setReflection] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [nextSubject, setNextSubject] = useState<Subject | undefined>()
  const audio = useRef<HTMLAudioElement>(null)
  const teacherAudio = useRef<HTMLAudioElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const client = getRazApi(testMode)

  const accept = (value: RazState) => {
    setCourse(value)
    setAnswers(value.mode === 'lesson' ? value.lesson.answers || {} : {})
    setReflection(value.mode === 'lesson' ? value.lesson.values.reflection : '')
    if (value.mode === 'lesson') {
      const lesson = value.lesson
      setStep(lesson.completed ? 'output' : lesson.questions.some(question => question.id.startsWith('review-')) && !lesson.result ? 'review' : lesson.kind === 'review' ? 'review' : !lesson.values.listened ? 'listen' : lesson.values.page < lesson.endPage ? 'read' : lesson.questions.some(question => question.id.startsWith('main-')) && !lesson.result ? 'practice' : 'output')
    }
  }
  useEffect(() => {
    let active = true
    setCourse(null)
    setError('')
    setNotice('')
    pending.current = Promise.resolve()
    getRazApi(testMode).state(date).then(value => { if (active) accept(value) }).catch(failure => { if (active) setError(message(failure)) })
    return () => { active = false; stopSpeaking() }
  }, [date, testMode])
  useEffect(() => {
    if (testMode || course?.mode !== 'lesson' || !course.lesson.completed) return
    let active = true
    api.today(date).then(value => { if (active) setNextSubject(nextHomeworkSubject(value)) }).catch(() => {})
    return () => { active = false }
  }, [course?.mode === 'lesson' && course.lesson.completed, date, testMode])

  const setLesson = (lesson: RazLesson) => setCourse(previous => previous?.mode === 'lesson' ? { ...previous, lesson } : previous)
  const persist = (patch: Partial<RazLesson['values']> & { answers?: Record<string, string> }) => {
    const request = pending.current.then(() => client.progress(date, patch))
    pending.current = request.catch(() => {})
    void request.catch(failure => setError(message(failure)))
    return request
  }
  const play = (text: string) => {
    audio.current?.pause()
    teacherAudio.current?.pause()
    video.current?.pause()
    if (!speechSupported()) { setError('当前浏览器不支持读音播放，请使用 Chrome、Edge 或 Safari。'); return }
    stopSpeaking()
    speak(text, { lang: 'en-US', rate: 0.85 })
  }
  const changeStep = (value: Step) => { stopSpeaking(); if (value !== 'listen' && value !== 'read') audio.current?.pause(); setStep(value) }
  const select = (id: string, value: string) => {
    setAnswers(previous => ({ ...previous, [id]: value }))
    if (course?.mode === 'lesson' && !course.lesson.completed) {
      setLesson({ ...course.lesson, result: null, answers: { ...answers, [id]: value } })
      void persist({ answers: { [id]: value } })
    }
  }
  const grade = async () => {
    if (!course) return
    setBusy(true)
    setError('')
    stopSpeaking()
    try {
      await pending.current
      if (course.mode === 'placement') {
        const result = await client.place(date, course.placement.index, answers)
        setNotice(result.finished ? `测级完成，起始级别为 ${result.profile.level}` : `本轮答对 ${result.result.correct} / ${result.result.total} 题`)
        accept(await client.state(date))
      } else {
        const lesson = await client.quiz(date, answers)
        setLesson(lesson)
        if (lesson.result) setNotice(`本次理解练习：${lesson.result.correct} / ${lesson.result.total} 题`)
      }
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  const heard = () => {
    if (course?.mode !== 'lesson' || course.lesson.completed || course.lesson.values.listened) return
    setLesson({ ...course.lesson, values: { ...course.lesson.values, listened: true } })
    void persist({ listened: true })
  }
  const viewed = (page: number) => {
    if (course?.mode !== 'lesson' || course.lesson.completed || page <= course.lesson.values.page) return
    setLesson({ ...course.lesson, values: { ...course.lesson.values, page } })
    void persist({ page })
  }
  const finish = async () => {
    if (course?.mode !== 'lesson') return
    setBusy(true)
    setError('')
    audio.current?.pause()
    stopSpeaking()
    try {
      await pending.current
      await client.progress(date, { reflection })
      setLesson(await client.complete(date))
      setNotice('今日英语已完成')
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  const saveRecording = async (blob: Blob) => {
    setBusy(true)
    setError('')
    try { await pending.current; await client.output(date, blob); const value = await client.state(date); if (value.mode === 'lesson') setLesson(value.lesson) }
    catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }

  if (!course) return <section className="space-y-4 py-8">{error ? <><p role="alert" className="text-red-700">{error}</p><button type="button" className="inline-flex items-center gap-2 text-sm" onClick={() => { setError(''); void client.state(date).then(accept).catch(failure => setError(message(failure))) }}><RotateCcw className="h-4 w-4" />重试</button><Link to={testMode ? '/parent' : '/'} className="ml-4 text-sm underline">返回</Link></> : <p role="status">正在准备本地英语课程…</p>}</section>
  const lesson = course.mode === 'lesson' ? course.lesson : null
  const book = lesson?.book || (course.mode === 'placement' ? course.placement.book : null)!
  const review = lesson?.questions.filter(question => question.id.startsWith('review-')) || []
  const practice = lesson?.questions.filter(question => question.id.startsWith('main-')) || []
  const sequence: Step[] = [...(review.length ? ['review' as const] : []), ...(lesson?.kind === 'review' ? [] : ['listen' as const, 'read' as const]), ...(practice.length ? ['practice' as const] : []), 'output']
  const locked = busy || recording || Boolean(lesson?.completed)
  const done = (value: Step) => value === 'review' ? review.every(question => answers[question.id]) : value === 'listen' ? lesson?.values.listened : value === 'read' ? lesson && lesson.values.page >= lesson.endPage : value === 'practice' ? lesson?.result : reflection.trim().length >= 2 || lesson?.outputId
  const continueStep = () => changeStep(sequence[Math.min(sequence.length - 1, sequence.indexOf(step) + 1)])
  const allAnswered = (questions: RazQuestion[]) => questions.length > 0 && questions.every(question => answers[question.id])

  return <div className="space-y-5 pb-8" data-raz-course={course.mode}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-line)] pb-4">
      <div className="min-w-0 space-y-1"><p className="text-sm text-[var(--color-ink-soft)]">{formatDate(date, true)} · {testMode ? '家长测试 · 独立数据' : '英语阅读'}</p><h1 className="break-words text-2xl font-semibold" lang="en">{lesson?.kind === 'review' ? '主题复习' : book.title}</h1><p className="text-sm text-[var(--color-ink-soft)]">Level {book.level}{course.mode === 'placement' ? ` · 起点测评 ${course.placement.index + 1} / 4` : ` · 约 ${course.profile.targetMinutes} 分钟${lesson?.wordCount ? ` · ${lesson.wordCount} 词` : ''}${lesson && lesson.parts > 1 ? ` · 第 ${lesson.part} / ${lesson.parts} 次` : ''}`}</p></div>
      <Link to={testMode ? '/parent' : '/'} className="inline-flex shrink-0 items-center gap-2 py-2 text-sm"><ArrowLeft className="h-4 w-4" />{testMode ? '返回家长区' : '返回首页'}</Link>
    </header>
    {notice && <p role="status" className="text-sm font-medium text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {lesson?.resumedFrom && !lesson.completed && <p className="text-sm text-amber-700">接着 {formatDate(lesson.resumedFrom)} 的进度继续</p>}
    {lesson && <nav aria-label="英语学习步骤" className="flex overflow-x-auto border-b border-[var(--color-line)]" role="tablist">{sequence.map(value => { const Icon = done(value) ? Check : steps[value].icon; return <button key={value} type="button" role="tab" aria-selected={step === value} disabled={busy || recording} onClick={() => changeStep(value)} className={cn('inline-flex min-h-14 shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm', step === value ? 'border-[var(--color-english)] font-semibold text-[var(--color-english)]' : 'border-transparent text-[var(--color-ink-soft)]')}><Icon className="h-4 w-4" />{steps[value].title}</button> })}</nav>}
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
      <section aria-label="英语学习区" className="order-2 min-w-0 space-y-5 lg:order-none">
        {course.mode === 'placement' ? <>
          <RazReader key={book.id} src={client.asset(date, book.id, 'book')} title={book.title} />
          <section className="space-y-4 border-t border-[var(--color-line)] pt-5"><h2 className="text-lg font-semibold">听读理解</h2><Questions questions={course.placement.questions} answers={answers} result={null} disabled={busy} select={select} play={play} /><button type="button" disabled={busy || !allAnswered(course.placement.questions)} onClick={() => void grade()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-english)] px-5 py-3 text-white disabled:opacity-40"><Check className="h-5 w-5" />{busy ? '检查中…' : '提交本轮测评'}</button></section>
        </> : lesson && <>
          {(step === 'listen' || step === 'read') && <>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{steps[step].title}</h2><span className="text-sm text-[var(--color-ink-soft)]">本次第 {lesson.startPage}–{lesson.endPage} 页</span></div>
            <RazReader key={`${book.id}-${lesson.part}`} src={client.asset(date, book.id, 'book')} title={book.title} start={lesson.startPage} end={lesson.endPage} initialPage={Math.min(lesson.endPage, Math.max(lesson.startPage, lesson.values.page))} onViewed={viewed} />
            <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy || recording || (step === 'listen' ? !lesson.values.listened : lesson.values.page < lesson.endPage)} onClick={continueStep} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-english)] px-5 py-3 text-white disabled:opacity-40">{step === 'listen' ? '继续阅读' : '阅读完成'}<ChevronRight className="h-5 w-5" /></button><span className="text-sm text-[var(--color-ink-soft)]">{step === 'listen' ? lesson.values.listened ? '原声听读已完成' : '原声听读未完成' : `阅读进度 ${Math.max(0, Math.min(lesson.endPage, lesson.values.page) - lesson.startPage + 1)} / ${lesson.endPage - lesson.startPage + 1} 页`}</span></div>
          </>}
          {(step === 'review' || step === 'practice') && <section className="space-y-5">
            <h2 className="text-lg font-semibold">{steps[step].title}</h2>
            <Questions questions={step === 'review' ? review : practice} answers={answers} result={lesson.result} disabled={locked} select={select} play={play} />
            {lesson.result && <p role="status" className={cn('font-medium', lesson.result.score >= 80 ? 'text-emerald-700' : 'text-amber-700')}>本次答对 {lesson.result.correct} / {lesson.result.total} 题 · {lesson.result.score} 分</p>}
            <div className="flex flex-wrap gap-3">{(step === 'practice' || !practice.length) && <button type="button" disabled={locked || !allAnswered(lesson.questions)} onClick={() => void grade()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-english)] px-5 py-3 text-white disabled:opacity-40"><ClipboardCheck className="h-5 w-5" />{busy ? '检查中…' : '提交理解练习'}</button>}<button type="button" disabled={busy || recording || (step === 'review' && practice.length > 0 ? !allAnswered(review) : !lesson.result)} onClick={continueStep} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-5 py-3 disabled:opacity-40">继续<ChevronRight className="h-5 w-5" /></button></div>
            {step === 'practice' && review.some(question => !answers[question.id]) && <button type="button" className="text-sm underline" onClick={() => changeStep('review')}>返回完成旧知复习</button>}
          </section>}
          {step === 'output' && <section className="space-y-5">
            <h2 className="text-lg font-semibold">我的表达</h2>
            <label className="block space-y-3"><span className="block leading-relaxed">{lesson.reflectionPrompt}</span><textarea aria-label="我的英语表达" rows={5} maxLength={2000} disabled={locked} value={reflection} onChange={event => setReflection(event.target.value)} onBlur={() => { if (!locked && reflection !== lesson.values.reflection) void persist({ reflection }) }} className="field min-h-36 resize-y" /></label>
            <div className="flex flex-wrap items-center gap-4"><Recorder label="录下我的表达" maxSeconds={60} disabled={locked} onBusyChange={setRecording} onStart={() => { audio.current?.pause(); teacherAudio.current?.pause(); video.current?.pause(); stopSpeaking() }} onRecorded={blob => void saveRecording(blob)} />{lesson.outputId && <audio aria-label="我的表达回放" controls preload="none" src={client.recording(date, lesson.outputId)} className="max-w-full" onPlay={() => { audio.current?.pause(); teacherAudio.current?.pause(); video.current?.pause(); stopSpeaking() }} />}</div>
            {lesson.completed ? <div className="space-y-3 border-t border-[var(--color-line)] pt-5"><p className="flex items-center gap-2 font-semibold text-emerald-700"><Check className="h-5 w-5" />今日英语已完成</p><p className="text-sm text-[var(--color-ink-soft)]">{lesson.result ? `理解练习 ${lesson.result.score} 分` : '表达已保存 · 未自动评分'}</p><Link className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-coding)] px-5 py-3 text-white" to={testMode ? '/parent' : nextSubject ? `/${nextSubject}/${date}` : '/'}>{testMode ? '返回家长区' : nextSubject === 'coding' ? '继续编程作业' : '返回首页'}<ChevronRight className="h-5 w-5" /></Link></div> : <button type="button" disabled={busy || recording || (!lesson.outputId && reflection.trim().length < 2) || (lesson.kind === 'reading' && (!lesson.values.listened || lesson.values.page < lesson.endPage)) || (lesson.questions.length > 0 && !lesson.result)} onClick={() => void finish()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-english)] px-5 py-3 text-white disabled:opacity-40"><Save className="h-5 w-5" />{busy ? '保存中…' : '完成今日英语'}</button>}
          </section>}
        </>}
      </section>
      <aside className="contents min-w-0 lg:order-last lg:sticky lg:top-5 lg:block lg:self-start lg:space-y-5 lg:border-l lg:border-[var(--color-line)] lg:pl-5" aria-label="今日英语资源">
        {(course.mode === 'placement' || lesson?.kind === 'reading') && <section className="order-1 space-y-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Headphones className="h-5 w-5" />原版朗读</h2><audio ref={audio} key={book.id} aria-label="原版英语音频" controls preload="metadata" src={client.asset(date, book.id, 'audio')} onLoadedMetadata={event => { if (lesson) event.currentTarget.currentTime = lesson.audioStart }} onPlay={() => { stopSpeaking(); teacherAudio.current?.pause(); video.current?.pause() }} onTimeUpdate={event => { if (lesson?.audioEnd && event.currentTarget.currentTime >= lesson.audioEnd - 0.15) { event.currentTarget.pause(); heard() } }} onEnded={heard} onError={() => setError('原版音频加载失败，请检查本地资源后重试')} className="w-full min-w-0" /><button type="button" disabled={busy || recording} className="inline-flex items-center gap-2 text-sm" onClick={() => { if (audio.current) { audio.current.currentTime = lesson?.audioStart || 0; void audio.current.play().catch(() => setError('未能播放音频，请重新点击播放。')) } }}><RotateCcw className="h-4 w-4" />重听本段</button>{lesson && lesson.parts > 1 && <p className="text-xs text-[var(--color-ink-soft)]">第 {Math.floor(lesson.audioStart / 60)}:{String(Math.floor(lesson.audioStart % 60)).padStart(2, '0')} 至 {Math.floor((lesson.audioEnd || 0) / 60)}:{String(Math.floor((lesson.audioEnd || 0) % 60)).padStart(2, '0')}</p>}</section>}
        {lesson && <section className="order-3 space-y-3 border-t border-[var(--color-line)] pt-4"><h2 className="text-sm font-semibold">今日进度</h2><ul className="space-y-3">{sequence.map(value => <li key={value} className="flex items-center justify-between gap-2 text-sm"><span>{steps[value].title}</span><span className={done(value) ? 'text-emerald-700' : 'text-[var(--color-ink-soft)]'}>{done(value) ? '已完成' : '未完成'}</span></li>)}</ul></section>}
        {lesson?.kind !== 'review' && book.hasTeacherAudio && <details className="order-4 border-t border-[var(--color-line)] pt-4"><summary className="cursor-pointer text-sm font-medium">教师讲解</summary><audio ref={teacherAudio} controls preload="none" src={client.asset(date, book.id, 'teacherAudio')} aria-label="教师讲解音频" className="mt-3 w-full" onPlay={() => { audio.current?.pause(); video.current?.pause(); stopSpeaking() }} /></details>}
        {lesson?.kind !== 'review' && book.hasVideo && <details className="order-4 border-t border-[var(--color-line)] pt-4"><summary className="cursor-pointer text-sm font-medium">配套视频</summary><video ref={video} controls preload="none" src={client.asset(date, book.id, 'video')} aria-label="绘本配套视频" className="mt-3 aspect-video w-full" onPlay={() => { audio.current?.pause(); teacherAudio.current?.pause(); stopSpeaking() }} /></details>}
        <div className="order-5 border-t border-[var(--color-line)] pt-4 text-xs leading-relaxed text-[var(--color-ink-soft)]"><p>本地资源 · Level {book.level}</p>{lesson && <p>{lesson.kind === 'review' ? '复习日' : `阅读 ${lesson.startPage}–${lesson.endPage} 页`}</p>}{testMode && <p>测试记录不计入正式成绩</p>}</div>
      </aside>
    </div>
  </div>
}