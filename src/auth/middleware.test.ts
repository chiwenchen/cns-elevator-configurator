// src/auth/middleware.test.ts
import { describe, test, expect } from 'bun:test'
import { parseCookie, extractUser } from './middleware'
import { signJwt } from './jwt'

const TEST_SECRET = 'test-secret-key-for-hmac-sha256-minimum-32-chars!'

describe('parseCookie', () => {
  test('extracts named cookie from header', () => {
    expect(parseCookie('vp_session=abc123; other=xyz', 'vp_session')).toBe('abc123')
  })

  test('returns null when cookie not found', () => {
    expect(parseCookie('other=xyz', 'vp_session')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseCookie('', 'vp_session')).toBeNull()
  })

  test('handles spaces in cookie header', () => {
    expect(parseCookie('a=1; vp_session=tok; b=2', 'vp_session')).toBe('tok')
  })
})

describe('extractUser', () => {
  test('returns null for missing cookie', async () => {
    const result = await extractUser(null, TEST_SECRET)
    expect(result).toBeNull()
  })

  test('returns null for invalid token', async () => {
    const result = await extractUser('garbage', TEST_SECRET)
    expect(result).toBeNull()
  })

  test('returns payload for valid token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, 3600)
    const result = await extractUser(token, TEST_SECRET)
    expect(result).not.toBeNull()
    expect(result!.sub).toBe('u1')
    expect(result!.jti).toBe('s1')
  })

  test('returns null for expired token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, -1)
    const result = await extractUser(token, TEST_SECRET)
    expect(result).toBeNull()
  })
})
