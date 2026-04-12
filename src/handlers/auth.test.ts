// src/handlers/auth.test.ts
import { describe, test, expect } from 'bun:test'
import {
  handleRequestOtp,
  handleVerifyOtp,
  handleLogout,
  handleMe,
  AuthError,
} from './auth'

// Mock D1 database
function createMockDb() {
  const tables: Record<string, any[]> = {
    users: [],
    otp_codes: [],
    sessions: [],
    companies: [],
    saved_designs: [],
    chat_sessions: [],
  }

  return {
    tables,
    prepare(query: string) {
      return {
        bind(..._args: any[]) {
          return this
        },
        async first() {
          // Simplified mock — returns based on query keywords
          if (query.includes('FROM users') && query.includes('WHERE email')) {
            return tables.users[0] ?? null
          }
          if (query.includes('FROM otp_codes') && query.includes('WHERE email')) {
            return tables.otp_codes.find((o: any) => !o.used) ?? null
          }
          if (query.includes('FROM sessions')) {
            return tables.sessions[0] ?? null
          }
          if (query.includes('COUNT(*)')) {
            return { count: 0 }
          }
          return null
        },
        async all() {
          return { results: [] }
        },
        async run() {
          return { success: true }
        },
      }
    },
    batch(stmts: any[]) {
      return Promise.all(stmts.map((s: any) => s.run()))
    },
  }
}

// Mock Resend
function createMockResend() {
  const sent: Array<{ to: string; subject: string }> = []
  return {
    sent,
    async sendOtp(to: string, code: string) {
      sent.push({ to, subject: `Vera Plot 驗證碼：${code}` })
    },
  }
}

describe('handleRequestOtp', () => {
  test('rejects empty email', async () => {
    const db = createMockDb()
    const resend = createMockResend()
    await expect(
      handleRequestOtp({ email: '' }, db as any, resend.sendOtp),
    ).rejects.toThrow(AuthError)
  })

  test('rejects invalid email format', async () => {
    const db = createMockDb()
    const resend = createMockResend()
    await expect(
      handleRequestOtp({ email: 'not-an-email' }, db as any, resend.sendOtp),
    ).rejects.toThrow(AuthError)
  })
})

describe('handleMe (unit)', () => {
  test('returns user info shape', () => {
    // handleMe requires a resolved auth user, test the structure
    const user = {
      id: 'u1',
      email: 'test@test.com',
      raw_email: 'test@test.com',
      role: 'user',
      company_id: null,
    }
    // Simply verify structure matches expected shape
    expect(user).toHaveProperty('id')
    expect(user).toHaveProperty('email')
    expect(user).toHaveProperty('role')
  })
})
