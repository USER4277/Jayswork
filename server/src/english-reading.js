import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db, now } from './db.js'
import { config } from './config.js'
import { contentFor, isUnlocked } from './schedule.js'
import { chatJson, transcribeAudio, AiError } from './ai.js'
import { englishPrompt } from './prompts.js'

const execute = promisify(execFile)
const active = new Set()

export function readingTarget(date, line = null) {
  const dialogue = contentFor(date)?.english?.dialogues?.[0]
  if (!dialogue || (line !== null && (!Number.isInteger(line) || line < 0 || line >= dialogue.lines.length))) return null
  const lines = line === null ? dialogue.lines : [dialogue.lines[line]]
  return { questionKey: line === null ? 'english-dialogue' : `english-line-${line}`, attemptKey: line === null ? 'dialogue-reading' : `line-reading-${line}`, reference: lines.map((item) => item.en).join('\n'), translation: lines.map((item) => item.zh).join('\n') }
}

export function readingState(date, line = null) {
  const target = readingTarget(date, line)
  if (!target) return { recording: null, result: null }
  const recording = db.prepare('SELECT id, transcript FROM voice_answers WHERE date = ? AND question_key = ? ORDER BY rowid DESC LIMIT 1').get(date, target.questionKey)
  const attempt = db.prepare("SELECT result_json FROM attempts WHERE date = ? AND subject = 'english' AND question_key = ?").get(date, target.attemptKey)
  const saved = attempt?.result_json ? JSON.parse(attempt.result_json) : null
  const result = recording && saved?.voiceId === recording.id ? { ...saved, passed: saved.score >= 7, status: saved.score >= 7 ? 'correct' : 'wrong' } : null
  return { recording: recording ? { ...recording, url: `/api/homework/voice-file/${recording.id}` } : null, result }
}

export function sentencesPassed(date) {
  const lines = contentFor(date)?.english?.dialogues?.[0]?.lines
  return Boolean(lines?.length && lines.every((_, index) => {
    const result = readingState(date, index).result
    return result?.passed && result.score >= 7
  }))
}

export async function gradeReading(date, voiceId, line = null) {
  if (typeof voiceId !== 'string' || !voiceId) throw new AiError('请先保存跟读录音', 400)
  if (active.has(date)) throw new AiError('正在评估这段录音，请稍候', 409)
  if (!isUnlocked(date)) throw new AiError('只能评估当天的英语作业', 403)
  const target = readingTarget(date, line)
  if (!target) throw new AiError('找不到这句英语作业', 400)
  const recording = db.prepare('SELECT * FROM voice_answers WHERE id = ? AND date = ? AND question_key = ?').get(voiceId, date, target.questionKey)
  if (!recording || readingState(date, line).recording?.id !== voiceId) throw new AiError('请使用这一项最新保存的跟读录音', 400)
  active.add(date)
  let temporary
  try {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'jayswork-asr-'))
    const wav = path.join(temporary, 'reading.wav')
    try {
      await execute(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path.join(config.dataDir, recording.audio_path), '-vn', '-ac', '1', '-ar', '16000', wav], { timeout: 20000, maxBuffer: 1024 * 1024 })
    } catch { throw new AiError('录音转码失败，请检查录音文件和 FFmpeg 安装后重试', 422) }
    const audio = await fs.readFile(wav)
    if (audio.length > 4 * 1024 * 1024) throw new AiError('录音过长，请在 90 秒内完成跟读', 413)
    const transcript = await transcribeAudio(new Blob([audio], { type: 'audio/wav' }))
    if (transcript.duration < (line === null ? 1 : 0.2) || transcript.duration > (line === null ? 95 : 35)) throw new AiError(line === null ? '请录制 1 到 90 秒的英文对话' : '请在 30 秒内跟读这一句', 422)
    db.prepare('UPDATE voice_answers SET transcript = ? WHERE id = ?').run(transcript.text, voiceId)
    const feedback = await chatJson(englishPrompt({ sentence: target.reference, translation: target.translation, answer: transcript.text, mode: line === null ? 'dialogue' : 'sentence' }), { maxTokens: 1400 })
    if (typeof feedback.得分 !== 'number' || !Number.isFinite(feedback.得分) || feedback.得分 < 0 || feedback.得分 > 10 || typeof feedback.讲解 !== 'string' || !feedback.讲解.trim()) throw new AiError('评分返回不完整，请重试，系统不会自动判为通过', 502)
    const result = { voiceId, score: feedback.得分, passed: feedback.得分 >= 7, explanation: feedback.讲解, hint: typeof feedback.订正提示 === 'string' ? feedback.订正提示 : '', transcript: transcript.text, assessmentType: 'transcript-content', status: feedback.得分 >= 7 ? 'correct' : 'wrong' }
    if (!isUnlocked(date) || readingState(date, line).recording?.id !== voiceId) throw new AiError('录音或日期已变化，请重新评估最新录音', 409)
    const stamp = now()
    db.prepare("INSERT INTO attempts (date, subject, question_key, answer_json, correct, score, created_at, updated_at, result_json) VALUES (?, 'english', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(date, subject, question_key) DO UPDATE SET answer_json = excluded.answer_json, correct = excluded.correct, score = excluded.score, updated_at = excluded.updated_at, result_json = excluded.result_json").run(date, target.attemptKey, JSON.stringify({ voiceId, text: transcript.text }), result.passed ? 1 : 0, result.score, stamp, stamp, JSON.stringify(result))
    return result
  } finally {
    active.delete(date)
    if (temporary) await fs.rm(temporary, { recursive: true, force: true })
  }
}