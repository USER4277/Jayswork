import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

let server
let config
let client
let responses = []
const requests = []

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.url === '/speech_to_text') {
      assert.equal(req.headers.authorization, 'Bearer test-only-key')
      assert.equal(req.headers.language, 'en')
      assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/)
      assert.match(body, /asr-1.0/)
      assert.match(body, /filename="reading.wav"/)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ text: 'Hello, how are you?', duration: 2.5 }))
      return
    }
    requests.push(JSON.parse(body))
    assert.equal(req.headers.authorization, 'Bearer test-only-key')
    const reply = responses.shift()
    if (reply?.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"先算括号"}}]}\n\n')
      res.end('data: {"choices":[{"delta":{"content":"再算乘除"}}]}\n\ndata: [DONE]\n\n')
    } else if (reply?.error) {
      res.writeHead(reply.error)
      res.end('mock failure')
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: reply?.text || '' } }] }))
    }
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  ;({ config } = await import('../src/config.js'))
  config.ai.apiKey = 'test-only-key'
  config.ai.baseUrl = `http://127.0.0.1:${server.address().port}`
  client = await import('../src/ai.js')
})

after(async () => { await new Promise((resolve) => server.close(resolve)) })

test('AI JSON grading accepts fenced JSON and retries malformed responses', async () => {
  responses = [{ text: 'not json' }, { text: '```json\n{"判定":"对","得分":10,"讲解":"很好"}\n```' }]
  const result = await client.chatJson([{ role: 'user', content: 'test' }])
  assert.equal(result.得分, 10)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].response_format.type, 'json_object')
  assert.deepEqual(requests[0].thinking, { type: 'disabled' })
  assert.equal(requests[0].reasoning_split, true)
  assert.equal(requests[0].temperature, undefined)
})

test('JSON parsing ignores provider reasoning and Flash uses adaptive thinking', async () => {
  assert.deepEqual(client.extractJson('<think>Consider {invalid}.</think>\n{"得分":8}'), { 得分: 8 })
  const previous = config.ai.model
  config.ai.model = 'MiniMax-M3.1-Flash'
  try {
    responses = [{ text: '{"ok":true}' }]
    assert.equal((await client.chatJson([{ role: 'user', content: 'test' }])).ok, true)
    assert.deepEqual(requests.at(-1).thinking, { type: 'adaptive' })
  } finally { config.ai.model = previous }
})

test('AI tutor streams Chinese text and reports provider errors', async () => {
  responses = [{ stream: true }]
  let text = ''
  for await (const chunk of client.streamChat([{ role: 'user', content: 'test' }])) text += chunk
  assert.equal(text, '先算括号再算乘除')
  responses = [{ error: 429 }]
  await assert.rejects(client.chat([{ role: 'user', content: 'test' }]), (error) => error.status === 429)
})

test('ASR sends a multipart audio file and the documented language header', async () => {
  const result = await client.transcribeAudio(new Blob(['test audio'], { type: 'audio/wav' }))
  assert.deepEqual(result, { text: 'Hello, how are you?', duration: 2.5 })
})