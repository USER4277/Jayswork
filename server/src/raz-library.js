import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

export const RAZ_LEVELS = ['AA', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'Z1', 'Z2']
const libraries = new Map()

export function titleKey(title) {
  const key = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/_Password_Removed/ig, '').replace(/^(?:[A-Z]{1,2})?\d{1,3}[\s._-]+/i, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return key === 'summercam' ? 'summercamp' : key
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(filename) : entry.isFile() ? [filename] : []
  })
}

export function loadRazLibrary(root = config.razDir, refresh = false) {
  if (!refresh && libraries.has(root)) return libraries.get(root)
  const library = { available: fs.existsSync(root), books: [], levels: [], issues: [] }
  if (!library.available) return library
  for (const level of RAZ_LEVELS) {
    const directory = path.join(root, `Level ${level}`)
    if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) continue
    const folders = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    const bookFolder = level === 'AA' ? 'AA绘本pdf' : folders.find(name => /级别pdf|电子书pdf/i.test(name) && !/有声|可发音/.test(name))
    const audioFolder = folders.find(name => /音频/.test(name) && !/老师|peggy/i.test(name))
    if (!bookFolder || !audioFolder) continue
    const allFiles = walk(directory)
    const audio = new Map(walk(path.join(directory, audioFolder)).filter(filename => /\.mp3$/i.test(filename) && !/全集|合集/.test(filename)).map(filename => [titleKey(path.basename(filename, '.mp3')), filename]))
    const packages = new Map()
    for (const filename of allFiles.filter(filename => /_clr\.pdf$/i.test(filename))) {
      const parent = path.dirname(filename)
      const key = titleKey(path.basename(parent))
      if (!packages.has(key)) packages.set(key, [])
      packages.get(key).push(...allFiles.filter(candidate => path.dirname(candidate) === parent))
    }
    const candidates = walk(path.join(directory, bookFolder)).filter(filename => /\.pdf$/i.test(filename))
    if (level === 'A') {
      const extra = path.join(directory, 'pdf', '20.What I Like.pdf')
      if (fs.existsSync(extra)) candidates.push(extra)
    }
    const seen = new Set()
    for (const filename of candidates) {
      const name = path.basename(filename, path.extname(filename)).replace(/_Password_Removed/ig, '').replace(/^(?:[A-Z]{1,2})?\d{1,3}[\s._-]+/i, '').trim()
      const key = titleKey(name)
      if (seen.has(key)) continue
      seen.add(key)
      const related = packages.get(key) || []
      const quiz = related.find(candidate => /\/[^/]*_cq[^/]*\.pdf$/i.test(candidate)) || allFiles.find(candidate => /小测试|小测验|quiz/i.test(candidate) && titleKey(path.basename(candidate).replace(/_cq\.pdf$/i, '')) === key)
      const assets = {
        book: filename,
        audio: audio.get(key) || null,
        video: allFiles.find(candidate => /\.mp4$/i.test(candidate) && !/peggy|老师/i.test(candidate) && titleKey(path.basename(candidate, '.mp4')) === key) || null,
        teacherAudio: allFiles.find(candidate => /\.mp3$/i.test(candidate) && /peggy|老师/i.test(candidate) && titleKey(path.basename(candidate, path.extname(candidate))) === key) || null,
        quiz: quiz || null,
        text: related.find(candidate => /_clr\.pdf$/i.test(candidate)) || filename,
        plan: related.find(candidate => /_(?:lp|lblp)\.pdf$/i.test(candidate)) || null,
      }
      const id = crypto.createHash('sha256').update(`${level}:${key}`).digest('hex').slice(0, 20)
      const book = { id, level, title: name === 'Summer Cam' ? 'Summer Camp' : name, key, ready: Boolean(assets.audio), assets }
      library.books.push(book)
      if (!book.ready) library.issues.push({ id, level, title: book.title, reason: '缺少已匹配的原版音频' })
    }
    library.levels.push({ level, total: library.books.filter(book => book.level === level).length, ready: library.books.filter(book => book.level === level && book.ready).length })
  }
  libraries.set(root, library)
  return library
}

export function publicBook(book) {
  return { id: book.id, title: book.title, level: book.level, ready: book.ready, hasVideo: Boolean(book.assets.video), hasTeacherAudio: Boolean(book.assets.teacherAudio), hasOriginalQuiz: Boolean(book.assets.quiz) }
}

export function razAsset(library, root, id, kind) {
  if (!['book', 'audio', 'video', 'teacherAudio'].includes(kind)) return null
  const filename = library.books.find(book => book.id === id)?.assets[kind]
  if (!filename || !fs.existsSync(filename)) return null
  const resolvedRoot = fs.realpathSync(root)
  const resolved = fs.realpathSync(filename)
  return resolved.startsWith(resolvedRoot + path.sep) ? resolved : null
}

export function razAudioType(filename) {
  const descriptor = fs.openSync(filename, 'r')
  const header = Buffer.alloc(12)
  try { fs.readSync(descriptor, header, 0, header.length, 0) }
  finally { fs.closeSync(descriptor) }
  return header.toString('ascii', 4, 8) === 'ftyp' ? 'audio/mp4' : header[0] === 255 && (header[1] & 246) === 240 ? 'audio/aac' : 'audio/mpeg'
}