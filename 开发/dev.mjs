#!/usr/bin/env node
/**
 * 开发模式：同时起后端（:4000）和前端 vite（:5173）。
 * 前端把 /api 和 /ws 代理到后端，所以直接开 http://localhost:5173 就能用。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const children = []

function run(name, args, color) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  const tag = `\x1b[${color}m[${name}]\x1b[0m `
  const pipe = (stream, out) => {
    stream.on('data', (buf) => {
      String(buf)
        .split('\n')
        .filter((l) => l.trim())
        .forEach((l) => out.write(tag + l + '\n'))
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    console.log(tag + `退出（${code}）`)
    shutdown()
  })
  children.push(child)
  return child
}

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM')
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

run('server', ['--prefix', 'server', 'run', 'dev'], '36')
run('web', ['--prefix', 'web', 'run', 'dev'], '35')

console.log('\n  前端：http://localhost:5173')
console.log('  后端：http://localhost:4000\n')
