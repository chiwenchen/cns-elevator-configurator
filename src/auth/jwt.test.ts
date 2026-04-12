import { describe, test, expect } from 'bun:test'
import { signJwt, verifyJwt } from './jwt'

const TEST_SECRET = 'test-secret-key-for-hmac-sha256-minimum-32-chars!'

describe('JWT', () => {
  test('sign and verify roundtrip', async () => {
    const payload = { sub: 'user-1', jti: 'sess-1', role: 'user' }
    const token = await signJwt(payload, TEST_SECRET, 3600)
    const decoded = await verifyJwt(token, TEST_SECRET)
    expect(decoded.sub).toBe('user-1')
    expect(decoded.jti).toBe('sess-1')
    expect(decoded.role).toBe('user')
    expect(decoded.exp).toBeGreaterThan(Date.now() / 1000)
  })
  test('rejects tampered token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, 3600)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(verifyJwt(tampered, TEST_SECRET)).rejects.toThrow('Invalid signature')
  })
  test('rejects expired token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, -1)
    expect(verifyJwt(token, TEST_SECRET)).rejects.toThrow('Token expired')
  })
  test('rejects malformed token', async () => {
    expect(verifyJwt('not-a-jwt', TEST_SECRET)).rejects.toThrow()
  })
})
