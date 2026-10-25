import { config, aiEnabled } from './config.js'

/**
 * MiniMax M3 客户端（OpenAI 兼容接口）。
 *
 *   POST {baseUrl}/chat/completions
 *   Authorization: Bearer {apiKey}
 *
 * 国内站用 https://api.minimaxi.com/v1，国际站用 https://api.minimax.io/v1，
 * key 和域名是绑定的，配错了会 401。
 */

class AiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AiError'
    this.status = status
  }
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.ai.apiKey}`,
  }
}

function buildBody(messages, { temperature = 0.3, maxTokens = 1500, json = false } = {}) {
  const body = {
    model: config.ai.model,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
    stream: false,
  }
  if (json) body.response_format = { type: 'json_object' }
  if (config.ai.thinking && config.ai.thinking !== 'disabled') {
    body.thinking = { type: config.ai.thinking }
  }
  return body
}

async function call(messages, opts = {}) {
  if (!aiEnabled()) throw new AiError('没有配置 MINIMAX_API_KEY，AI 功能不可用', 503)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs)
  try {
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildBody(messages, opts)),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new AiError(`MiniMax 返回 ${res.status}：${text.slice(0, 300)}`, res.status)
    }
    const data = await res.json()
    const msg = data?.choices?.[0]?.message
    if (!msg) throw new AiError('MiniMax 返回的内容无法解析', 502)
    // 思考模型会把推理放在 reasoning_content 里，正文在 content
    return {
      content: msg.content ?? '',
      reasoning: msg.reasoning_content ?? '',
      usage: data.usage ?? null,
    }
  } catch (err) {
    if (err instanceof AiError) throw err
    if (err.name === 'AbortError') throw new AiError('AI 回答超时了，请再试一次', 504)
    throw new AiError(`调用 MiniMax 失败：${err.message}`, 502)
  } finally {
    clearTimeout(timer)
  }
}

/** 从模型回复里抠出 JSON（容忍 ```json 围栏、前后废话） */
export function extractJson(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  try {
    return JSON.parse(s)
  } catch {
    /* 继续尝试找最外层的对象 */
  }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1))
    } catch {
      /* 放弃 */
    }
  }
  return null
}

/** 普通对话调用 */
export async function chat(messages, opts = {}) {
  const r = await call(messages, opts)
  return r.content
}

/** 要求模型返回 JSON 的调用；解析失败会再试一次 */
export async function chatJson(messages, opts = {}) {
  const first = await call(messages, { ...opts, json: true })
  const parsed = extractJson(first.content)
  if (parsed) return parsed
  const second = await call(
    [
      ...messages,
      { role: 'assistant', content: first.content.slice(0, 2000) },
      {
        role: 'user',
        content: '你的上一条回答不是合法的 JSON。请只输出一个 JSON 对象，不要任何解释文字、不要代码围栏。',
      },
    ],
    { ...opts, json: true }
  )
  return extractJson(second.content) || { raw: second.content }
}

/** 流式对话（SSE 用）：逐块 yield 文本 */
export async function* streamChat(messages, opts = {}) {
  if (!aiEnabled()) throw new AiError('没有配置 MINIMAX_API_KEY，AI 功能不可用', 503)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs)
  let res
  try {
    res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ...buildBody(messages, opts), stream: true }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    throw new AiError(`调用 MiniMax 失败：${err.message}`, 502)
  }
  if (!res.ok) {
    clearTimeout(timer)
    const text = await res.text().catch(() => '')
    throw new AiError(`MiniMax 返回 ${res.status}：${text.slice(0, 300)}`, res.status)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta =
            json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? ''
          if (delta) yield delta
        } catch {
          /* 跳过不完整的一行 */
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

export { AiError }
