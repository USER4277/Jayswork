import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') })

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const applicationSupport = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : process.platform === 'win32'
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')

export function defaultDataDir(base = path.join(applicationSupport, 'Jayswork'), legacy = path.join(root, 'server', 'data')) {
  const persistent = path.join(base, 'data')
  const previous = path.join(base, 'preview')
  if (fs.existsSync(path.join(persistent, 'app.db'))) return persistent
  if (fs.existsSync(path.join(previous, 'app.db'))) return previous
  if (fs.existsSync(path.join(legacy, 'app.db'))) throw new Error(`发现旧作业数据：${legacy}。请先备份完整目录，并设置 DATA_DIR 指向该目录；系统不会自动切换为空数据库。`)
  return persistent
}

export const config = {
  root,
  port: Number(process.env.PORT || 4000),
  /**
   * 监听地址。默认只监听本机 —— 画面和录像都是家里的隐私，没必要默认暴露到局域网。
   */
  host: process.env.HOST || '127.0.0.1',

  /** 作业内容（由 开发/content/build_content.py 生成） */
  contentDir: process.env.CONTENT_DIR || path.join(root, '作业'),
  /** 知识点图谱数据（由 开发/content/build_graph.py 抽取） */
  graphDir: process.env.GRAPH_DIR || path.join(root, '教学'),
  /** SQLite 落盘位置 */
  dataDir: path.resolve(process.env.DATA_DIR || defaultDataDir()),

  /** MiniMax M3 —— OpenAI 兼容接口 */
  ai: {
    apiKey: process.env.MINIMAX_API_KEY || '',
    baseUrl: (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1').replace(/\/+$/, ''),
    model: process.env.MINIMAX_MODEL || 'MiniMax-M3',
    /** 批改要快、答案要稳，默认关掉思考模式；设为 enabled 打开 */
    thinking: process.env.MINIMAX_THINKING || 'disabled',
    timeoutMs: Number(process.env.MINIMAX_TIMEOUT_MS || 60000),
  },

  parentPin: process.env.PARENT_PIN || '0000',
  /**
  * 保留旧配置兼容；不解除当天作答限制。
   */
  preview: process.env.PREVIEW === '1',
  /** 每日软提醒的截止时间（HH:MM），空字符串表示不限 */
  dailyDeadline: process.env.DAILY_DEADLINE || '',
  /** 是否启用语音跟读评分 */
  speechScoring: process.env.ENABLE_SPEECH_SCORING === '1',
}

export const aiEnabled = () => Boolean(config.ai.apiKey)
