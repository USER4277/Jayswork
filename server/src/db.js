import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

/**
 * SQLite 落盘。用的是 Node 22+ 内置的 node:sqlite，免原生编译。
 */

fs.mkdirSync(config.dataDir, { recursive: true })
export const DB_PATH = path.join(config.dataDir, 'app.db')

export const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS schedule (
  date            TEXT PRIMARY KEY,
  day_index       INTEGER NOT NULL,
  cycle           INTEGER NOT NULL,
  language_subject TEXT,
  language_index  INTEGER,
  math_day        INTEGER,
  coding_day      INTEGER,
  status          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  question_key TEXT NOT NULL,
  answer_json  TEXT,
  correct      INTEGER NOT NULL DEFAULT 0,
  score        REAL NOT NULL DEFAULT 0,
  ai_feedback  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(date, subject, question_key)
);

CREATE TABLE IF NOT EXISTS daily_progress (
  date         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_progress',
  submitted_at TEXT,
  score        REAL,
  total        REAL,
  duration_sec INTEGER,
  PRIMARY KEY(date, subject)
);

CREATE TABLE IF NOT EXISTS wrong_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  cycle           INTEGER NOT NULL,
  question_key    TEXT NOT NULL,
  question_text   TEXT,
  my_answer       TEXT,
  correct_answer  TEXT,
  reason          TEXT,
  explanation     TEXT,
  knowledge_point TEXT,
  mastery         INTEGER NOT NULL DEFAULT 0,
  wrong_count     INTEGER NOT NULL DEFAULT 1,
  reviewed_count  INTEGER NOT NULL DEFAULT 0,
  next_review_date TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(date, subject, question_key)
);

CREATE TABLE IF NOT EXISTS coding_notes (
  date           TEXT PRIMARY KEY,
  gain           TEXT,
  learned        TEXT,
  checklist_json TEXT,
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  context_json TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  recording  TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);
`)

export const now = () => new Date().toISOString()

// 轻量迁移：给已存在的表补列（node:sqlite 没有 IF NOT EXISTS ADD COLUMN）
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}

// wrong_items.kind 区分「完全错了」和「基本对但没答全」
ensureColumn('wrong_items', 'kind', "TEXT NOT NULL DEFAULT 'wrong'")

export function getSetting(k, fallback = null) {
  const row = db.prepare('SELECT v FROM settings WHERE k = ?').get(k)
  if (!row) return fallback
  try {
    return JSON.parse(row.v)
  } catch {
    return row.v
  }
}

export function setSetting(k, v) {
  db.prepare(
    'INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  ).run(k, JSON.stringify(v))
  return v
}

export function allSettings() {
  const rows = db.prepare('SELECT k, v FROM settings').all()
  const out = {}
  for (const r of rows) {
    try {
      out[r.k] = JSON.parse(r.v)
    } catch {
      out[r.k] = r.v
    }
  }
  return out
}
