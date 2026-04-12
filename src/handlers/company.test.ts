// src/handlers/company.test.ts
import { describe, test, expect } from 'bun:test'
import {
  handleCreateCompany,
  handleGetCompany,
  handleLeaveCompany,
  CompanyError,
} from './company'
import type { AuthUser } from '../auth/middleware'

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'test@test.com',
  raw_email: 'test@test.com',
  role: 'user',
  company_id: null,
  session_id: 'sess-1',
}

function createMockDb(overrides: Record<string, any> = {}) {
  return {
    prepare(query: string) {
      return {
        bind(..._args: any[]) { return this },
        async first() {
          if (query.includes('FROM companies') && overrides.company) return overrides.company
          return null
        },
        async all() {
          if (query.includes('FROM users') && query.includes('company_id')) {
            return { results: overrides.members ?? [] }
          }
          return { results: [] }
        },
        async run() { return { success: true } },
      }
    },
  }
}

describe('handleCreateCompany', () => {
  test('rejects if user already has company', async () => {
    const userWithCompany = { ...mockUser, company_id: 'existing-company' }
    const db = createMockDb()
    await expect(
      handleCreateCompany({ name: 'Test Co' }, userWithCompany, db as any)
    ).rejects.toThrow(CompanyError)
  })

  test('rejects empty company name', async () => {
    const db = createMockDb()
    await expect(
      handleCreateCompany({ name: '' }, mockUser, db as any)
    ).rejects.toThrow(CompanyError)
  })
})

describe('handleLeaveCompany', () => {
  test('rejects if user has no company', async () => {
    const db = createMockDb()
    await expect(
      handleLeaveCompany(mockUser, db as any)
    ).rejects.toThrow(CompanyError)
  })

  test('rejects if user is owner', async () => {
    const userOwner = { ...mockUser, company_id: 'comp-1' }
    const db = createMockDb({ company: { id: 'comp-1', owner_id: 'user-1' } })
    await expect(
      handleLeaveCompany(userOwner, db as any)
    ).rejects.toThrow(CompanyError)
  })
})
