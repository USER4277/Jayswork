import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginParent, logoutParent, parentAuthenticated, requireParent, invalidateParentSessions } from '../src/auth.js'

test('parent sessions require an unguessable cookie and are revoked on logout', () => {
  invalidateParentSessions()
  const req = { headers: {}, secure: false }
  assert.equal(parentAuthenticated(req), false)
  let cookie
  loginParent(req, { cookie(name, value, options) {
    cookie = `${name}=${value}`
    assert.equal(options.httpOnly, true)
    assert.equal(options.sameSite, 'strict')
    assert.equal(value.length, 64)
  } })
  const authenticated = { headers: { cookie: `other=1; ${cookie}` } }
  assert.equal(parentAuthenticated(authenticated), true)
  assert.equal(parentAuthenticated({ headers: { cookie: 'jayswork_parent=forged' } }), false)
  logoutParent(authenticated, { clearCookie() {} })
  assert.equal(parentAuthenticated(authenticated), false)
})

test('parent middleware rejects anonymous requests', () => {
  let code
  let continued = false
  const res = { status(value) { code = value; return this }, json() {} }
  requireParent({ headers: {} }, res, () => { continued = true })
  assert.equal(code, 401)
  assert.equal(continued, false)
})