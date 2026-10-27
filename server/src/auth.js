import crypto from 'node:crypto'

const sessions = new Map()
const COOKIE = 'jayswork_parent'
const MAX_AGE = 8 * 60 * 60 * 1000

function tokenFrom(req) {
  const cookies = String(req.headers.cookie || '').split(';')
  return cookies.find((cookie) => cookie.trim().startsWith(`${COOKIE}=`))?.trim().slice(COOKIE.length + 1)
}

export function parentAuthenticated(req) {
  const token = tokenFrom(req)
  const expires = sessions.get(token)
  if (!expires || expires <= Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

export function loginParent(req, res) {
  for (const [token, expires] of sessions) {
    if (expires <= Date.now()) sessions.delete(token)
  }
  sessions.delete(tokenFrom(req))
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, Date.now() + MAX_AGE)
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: MAX_AGE, path: '/' })
}

export function logoutParent(req, res) {
  sessions.delete(tokenFrom(req))
  res.clearCookie(COOKIE, { path: '/' })
}

export function invalidateParentSessions() {
  sessions.clear()
}

export function requireParent(req, res, next) {
  if (!parentAuthenticated(req)) return res.status(401).json({ error: '请先输入家长 PIN 登录' })
  next()
}