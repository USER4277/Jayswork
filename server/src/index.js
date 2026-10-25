import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import { config, aiEnabled } from './config.js'
import { loadHomework } from './content.js'
import { router as homeworkRouter } from './routes/homework.js'
import { router as aiRouter } from './routes/ai.js'
import { router as reviewRouter } from './routes/review.js'
import { router as graphRouter } from './routes/graph.js'
import { router as parentRouter } from './routes/parent.js'
import { router as watchRouter, attachWatchServer } from './routes/watch.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

// 简易访问日志
app.use((req, res, next) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) return next()
  const t0 = Date.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - t0}ms)`)
  })
  next()
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ai: aiEnabled(), time: new Date().toISOString() })
})

app.use('/api/homework', homeworkRouter)
app.use('/api/ai', aiRouter)
app.use('/api/review', reviewRouter)
app.use('/api/graph', graphRouter)
app.use('/api/parent', parentRouter)
app.use('/api/watch', watchRouter)

// 生产模式下托管前端构建产物
const DIST = path.join(config.root, 'web', 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^(?!\/api|\/ws).*/, (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .send('前端还没构建。在 web/ 目录跑 npm run build，或在根目录跑 npm run dev。')
  })
}

const server = http.createServer(app)
attachWatchServer(server)

try {
  const hw = loadHomework()
  console.log(`✓ 作业内容：${hw.days.length} 天（锚点 ${hw.meta.anchorStart}）`)
} catch (err) {
  console.error('✗ 作业内容加载失败：', err.message)
  console.error('  请先运行：python3 开发/content/build_content.py')
}
console.log(`✓ AI：${aiEnabled() ? config.ai.model : '未配置（本地规则批改）'}`)

server.listen(config.port, config.host, () => {
  const lan = config.host === '0.0.0.0' || config.host === '::'
  console.log(`✓ 服务已启动： http://localhost:${config.port}`)
  console.log(`  孩子端请用 localhost 打开（摄像头需要安全上下文）`)
  if (lan) {
    console.log(`  爸爸手机观看页： http://<本机局域网IP>:${config.port}/watch （需要家长 PIN）`)
    console.log('  ⚠ 局域网访问已开启，用完建议把 HOST 改回 127.0.0.1')
  } else {
    console.log('  爸爸手机同步画面：在 .env 里设 HOST=0.0.0.0 后重启即可开放局域网访问')
  }
})
