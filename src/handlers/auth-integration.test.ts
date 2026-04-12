// src/handlers/auth-integration.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  handleRequestOtp,
  handleVerifyOtp,
  handleLogout,
  handleMe,
  AuthError,
} from './auth'
import type { AuthUser } from '../auth/middleware'
import { OTP_RATE_LIMIT_MS, OTP_HOURLY_LIMIT } from '../auth/otp'

// ---------------------------------------------------------------------------
// In-memory mock DB that actually stores & retrieves rows
// ---------------------------------------------------------------------------
interface Row { [key: string]: any }

function createInMemoryDb() {
  const store: Record<string, Row[]> = {
    users: [],
    otp_codes: [],
    sessions: [],
    companies: [],
    saved_designs: [],
    chat_sessions: [],
  }

  function matchRow(table: Row[], col: string, val: any): Row | undefined {
    return table.find(r => r[col] === val)
  }

  return {
    _store: store,
    prepare(query: string) {
      let _args: any[] = []
      const stmt = {
        bind(...args: any[]) {
          _args = args
          return stmt
        },

        async first(): Promise<Row | null> {
          // SELECT ... FROM users WHERE email = ?
          if (query.includes('FROM users') && query.includes('WHERE email')) {
            return matchRow(store.users, 'email', _args[0]) ?? null
          }
          // SELECT ... FROM users WHERE id = ?
          if (query.includes('FROM users') && query.includes('WHERE id')) {
            return matchRow(store.users, 'id', _args[0]) ?? null
          }
          // SELECT ... FROM otp_codes WHERE email = ? ... ORDER BY created_at DESC LIMIT 1
          if (query.includes('FROM otp_codes') && query.includes('WHERE email')) {
            const forEmail = store.otp_codes
              .filter(o => o.email === _args[0])
            if (query.includes('used = 0')) {
              const unused = forEmail
                .filter(o => !o.used)
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              return unused[0] ?? null
            }
            if (query.includes('COUNT(*)')) {
              const hourAgo = _args[1]
              const count = forEmail.filter(o => o.created_at >= hourAgo).length
              return { count } as any
            }
            // rate-limit check — latest OTP
            const sorted = [...forEmail].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            )
            return sorted[0] ?? null
          }
          // COUNT saved_designs
          if (query.includes('COUNT(*)') && query.includes('saved_designs')) {
            const weekStart = _args[0]
            const userId = _args[1]
            const count = store.saved_designs.filter(
              d => d.created_at >= weekStart && d.user_id === userId,
            ).length
            return { count }
          }
          // COUNT chat_sessions
          if (query.includes('COUNT(*)') && query.includes('chat_sessions')) {
            const weekStart = _args[0]
            const userId = _args[1]
            const count = store.chat_sessions.filter(
              s => s.created_at >= weekStart && s.user_id === userId,
            ).length
            return { count }
          }
          // SELECT ... FROM companies WHERE id = ?
          if (query.includes('FROM companies')) {
            return matchRow(store.companies, 'id', _args[0]) ?? null
          }
          // SELECT ... FROM sessions
          if (query.includes('FROM sessions')) {
            return matchRow(store.sessions, 'id', _args[0]) ?? null
          }
          return null
        },

        async all() {
          if (query.includes('FROM users') && query.includes('company_id')) {
            const companyId = _args[0]
            return { results: store.users.filter(u => u.company_id === companyId) }
          }
          return { results: [] }
        },

        async run() {
          // INSERT INTO users
          if (query.startsWith('INSERT INTO users')) {
            store.users.push({
              id: _args[0],
              email: _args[1],
              raw_email: _args[2],
              role: _args[3] ?? 'user',
              company_id: null,
              created_at: _args[4] ?? _args[3],
            })
            return { success: true }
          }
          // INSERT INTO otp_codes
          if (query.startsWith('INSERT INTO otp_codes')) {
            store.otp_codes.push({
              id: _args[0],
              email: _args[1],
              code: _args[2],
              expires_at: _args[3],
              used: 0,
              attempts: 0,
              created_at: _args[4],
            })
            return { success: true }
          }
          // INSERT INTO sessions
          if (query.startsWith('INSERT INTO sessions')) {
            store.sessions.push({
              id: _args[0],
              user_id: _args[1],
              expires_at: _args[2],
              created_at: _args[3],
            })
            return { success: true }
          }
          // UPDATE otp_codes SET used = 1 WHERE email
          if (query.includes('UPDATE otp_codes') && query.includes('SET used = 1') && query.includes('WHERE email')) {
            for (const o of store.otp_codes) {
              if (o.email === _args[0] && !o.used) o.used = 1
            }
            return { success: true }
          }
          // UPDATE otp_codes SET used = 1 WHERE id
          if (query.includes('UPDATE otp_codes') && query.includes('SET used = 1') && query.includes('WHERE id')) {
            const otp = matchRow(store.otp_codes, 'id', _args[0])
            if (otp) otp.used = 1
            return { success: true }
          }
          // UPDATE otp_codes SET attempts = attempts + 1
          if (query.includes('UPDATE otp_codes') && query.includes('attempts')) {
            const otp = matchRow(store.otp_codes, 'id', _args[0])
            if (otp) otp.attempts += 1
            return { success: true }
          }
          // DELETE FROM sessions
          if (query.includes('DELETE FROM sessions')) {
            const idx = store.sessions.findIndex(s => s.id === _args[0])
            if (idx >= 0) store.sessions.splice(idx, 1)
            return { success: true }
          }
          return { success: true }
        },
      }
      return stmt
    },
    batch(stmts: any[]) {
      return Promise.all(stmts.map((s: any) => s.run()))
    },
  }
}

// Helpers ---------------------------------------------------------------

const JWT_SECRET = 'test-jwt-secret-for-integration'

function createMockSendOtp() {
  const sent: Array<{ to: string; code: string }> = []
  return {
    sent,
    fn: async (to: string, code: string) => { sent.push({ to, code }) },
  }
}

// =======================================================================
// Tests
// =======================================================================

describe('Auth Integration', () => {
  let db: ReturnType<typeof createInMemoryDb>
  let sendOtp: ReturnType<typeof createMockSendOtp>

  beforeEach(() => {
    db = createInMemoryDb()
    sendOtp = createMockSendOtp()
  })

  // --- request-otp ---------------------------------------------------

  test('request-otp: creates user + stores OTP', async () => {
    const result = await handleRequestOtp({ email: 'alice@example.com' }, db as any, sendOtp.fn)
    expect(result).toEqual({ ok: true })

    // User created
    expect(db._store.users).toHaveLength(1)
    expect(db._store.users[0]!.email).toBe('alice@example.com')

    // OTP stored
    expect(db._store.otp_codes).toHaveLength(1)
    expect(db._store.otp_codes[0]!.email).toBe('alice@example.com')
    expect(db._store.otp_codes[0]!.code).toMatch(/^\d{6}$/)

    // Email sent
    expect(sendOtp.sent).toHaveLength(1)
    expect(sendOtp.sent[0]!.to).toBe('alice@example.com')
  })

  test('request-otp: rejects empty email', async () => {
    await expect(
      handleRequestOtp({ email: '' }, db as any, sendOtp.fn),
    ).rejects.toThrow(AuthError)
  })

  test('request-otp: rejects invalid email (no @)', async () => {
    await expect(
      handleRequestOtp({ email: 'not-email' }, db as any, sendOtp.fn),
    ).rejects.toThrow(AuthError)
  })

  test('request-otp: rate limits (60s between requests)', async () => {
    // First request succeeds
    await handleRequestOtp({ email: 'rate@test.com' }, db as any, sendOtp.fn)

    // Second request within 60s should fail
    await expect(
      handleRequestOtp({ email: 'rate@test.com' }, db as any, sendOtp.fn),
    ).rejects.toThrow('請稍候再試')
  })

  test('request-otp: hourly limit (5 per hour)', async () => {
    // Seed 5 OTP codes with recent timestamps for the same email
    const email = 'flood@test.com'
    for (let i = 0; i < OTP_HOURLY_LIMIT; i++) {
      db._store.otp_codes.push({
        id: `otp-${i}`,
        email,
        code: '000000',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        used: 1,
        attempts: 0,
        // Spread them out so rate-limit (60s) doesn't trigger
        created_at: new Date(Date.now() - (OTP_HOURLY_LIMIT - i) * 61_000).toISOString(),
      })
    }
    // The user already exists
    db._store.users.push({ id: 'u-flood', email, raw_email: email, role: 'user', company_id: null, created_at: new Date().toISOString() })

    await expect(
      handleRequestOtp({ email }, db as any, sendOtp.fn),
    ).rejects.toThrow('已超過每小時驗證碼上限')
  })

  // --- verify-otp ----------------------------------------------------

  test('verify-otp: correct code returns user + cookie', async () => {
    // Seed user + OTP
    const email = 'verify@test.com'
    const now = new Date().toISOString()
    db._store.users.push({
      id: 'u-verify',
      email,
      raw_email: 'Verify@Test.com',
      role: 'user',
      company_id: null,
      created_at: now,
    })
    db._store.otp_codes.push({
      id: 'otp-v1',
      email,
      code: '123456',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used: 0,
      attempts: 0,
      created_at: now,
    })

    const result = await handleVerifyOtp({ email, code: '123456' }, db as any, JWT_SECRET)
    expect(result.user.id).toBe('u-verify')
    expect(result.user.email).toBe(email)
    expect(result.cookie).toContain('vp_session=')
    expect(typeof result.is_new).toBe('boolean')

    // Session created
    expect(db._store.sessions).toHaveLength(1)
    // OTP marked used
    expect(db._store.otp_codes[0]!.used).toBe(1)
  })

  test('verify-otp: wrong code increments attempts', async () => {
    const email = 'wrong@test.com'
    const now = new Date().toISOString()
    db._store.users.push({ id: 'u-w', email, raw_email: email, role: 'user', company_id: null, created_at: now })
    db._store.otp_codes.push({
      id: 'otp-w1',
      email,
      code: '999999',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used: 0,
      attempts: 0,
      created_at: now,
    })

    await expect(
      handleVerifyOtp({ email, code: '000000' }, db as any, JWT_SECRET),
    ).rejects.toThrow('驗證碼錯誤')

    expect(db._store.otp_codes[0]!.attempts).toBe(1)
  })

  test('verify-otp: expired OTP returns error', async () => {
    const email = 'expired@test.com'
    const now = new Date().toISOString()
    db._store.users.push({ id: 'u-e', email, raw_email: email, role: 'user', company_id: null, created_at: now })
    db._store.otp_codes.push({
      id: 'otp-e1',
      email,
      code: '123456',
      expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
      used: 0,
      attempts: 0,
      created_at: now,
    })

    await expect(
      handleVerifyOtp({ email, code: '123456' }, db as any, JWT_SECRET),
    ).rejects.toThrow('驗證碼已過期')
  })

  test('verify-otp: exhausted attempts returns error', async () => {
    const email = 'exhausted@test.com'
    const now = new Date().toISOString()
    db._store.users.push({ id: 'u-ex', email, raw_email: email, role: 'user', company_id: null, created_at: now })
    db._store.otp_codes.push({
      id: 'otp-ex1',
      email,
      code: '123456',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used: 0,
      attempts: 5, // already exhausted
      created_at: now,
    })

    await expect(
      handleVerifyOtp({ email, code: '123456' }, db as any, JWT_SECRET),
    ).rejects.toThrow('嘗試次數已達上限')
  })

  test('verify-otp: new user flag (is_new: true)', async () => {
    const email = 'newuser@test.com'
    const now = new Date().toISOString()
    // User created "just now" → is_new = true
    db._store.users.push({
      id: 'u-new',
      email,
      raw_email: email,
      role: 'user',
      company_id: null,
      created_at: now,
    })
    db._store.otp_codes.push({
      id: 'otp-new',
      email,
      code: '111111',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      used: 0,
      attempts: 0,
      created_at: now,
    })

    const result = await handleVerifyOtp({ email, code: '111111' }, db as any, JWT_SECRET)
    expect(result.is_new).toBe(true)
  })

  // --- me ------------------------------------------------------------

  test('me: returns user info + quota', async () => {
    const user: AuthUser = {
      id: 'u-me',
      email: 'me@test.com',
      raw_email: 'me@test.com',
      role: 'user',
      company_id: null,
      session_id: 'sess-me',
    }
    db._store.users.push({ ...user })

    const result = await handleMe(user, db as any)
    expect(result.user.id).toBe('u-me')
    expect(result.user.email).toBe('me@test.com')
    expect(result.user.company).toBeNull()
    expect(result.quota).toHaveProperty('dxf_used')
    expect(result.quota).toHaveProperty('dxf_limit')
    expect(result.quota).toHaveProperty('ai_used')
    expect(result.quota).toHaveProperty('ai_limit')
    expect(result.quota).toHaveProperty('resets_at')
    expect(result.quota.dxf_limit).toBe(3)  // user role
    expect(result.quota.ai_limit).toBe(10)
  })

  // --- logout --------------------------------------------------------

  test('logout: clears session', async () => {
    db._store.sessions.push({ id: 'sess-logout', user_id: 'u1', expires_at: '', created_at: '' })
    expect(db._store.sessions).toHaveLength(1)

    const result = await handleLogout('sess-logout', db as any)
    expect(result.ok).toBe(true)
    expect(result.cookie).toContain('Max-Age=0')
    expect(db._store.sessions).toHaveLength(0)
  })
})
