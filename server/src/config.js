import { fileURLToPath } from 'node:url'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') })

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const config = {
  root,
  port: Number(process.env.PORT || 4000),
  /**
   * 监听地址。默认只监听本机 —— 画面和录像都是家里的隐私，没必要默认暴露到局域网。
   * 需要爸爸手机同步画面时，在 .env 里设 HOST=0.0.0.0 重启（见 .env.example 的说明）。
   */
  host: process.env.HOST || '127.0.0.1',

  /** 作业内容（由 开发/content/build_content.py 生成） */
  contentDir: process.env.CONTENT_DIR || path.join(root, '作业'),
  /** 知识点图谱数据（由 开发/content/build_graph.py 抽取） */
  graphDir: process.env.GRAPH_DIR || path.join(root, '教学'),
  /** SQLite 落盘位置 */
  dataDir: process.env.DATA_DIR || path.join(root, 'server', 'data'),

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
   * 试看模式：解除「未来日期不可打开」的限制，方便开学前先熟悉系统。
   * 正式使用时保持关闭。
   */
  preview: process.env.PREVIEW === '1',
  /** 每日软提醒的截止时间（HH:MM），空字符串表示不限 */
  dailyDeadline: process.env.DAILY_DEADLINE || '',
  /** 是否启用语音跟读评分 */
  speechScoring: process.env.ENABLE_SPEECH_SCORING === '1',
}

export const aiEnabled = () => Boolean(config.ai.apiKey)
