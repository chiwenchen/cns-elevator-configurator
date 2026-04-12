// src/handlers/designs.test.ts
import { describe, test, expect } from 'bun:test'
import {
  handleListDesigns,
  handleListArchivedDesigns,
  handleGetDesign,
  handleArchiveDesign,
  handleUnarchiveDesign,
  handleDeleteDesign,
  DesignError,
} from './designs'
import type { AuthUser } from '../auth/middleware'

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'test@test.com',
  raw_email: 'test@test.com',
  role: 'user',
  company_id: null,
  session_id: 'sess-1',
}

const mockUserWithCompany: AuthUser = {
  ...mockUser,
  company_id: 'comp-1',
}

// Minimal mock DB
function createMockDb(designs: any[] = []) {
  return {
    prepare(query: string) {
      return {
        bind(..._args: any[]) { return this },
        async first() {
          if (query.includes('FROM saved_designs') && query.includes('WHERE id')) {
            return designs[0] ?? null
          }
          return null
        },
        async all() {
          return { results: designs }
        },
        async run() { return { success: true } },
      }
    },
  }
}

describe('handleListDesigns', () => {
  test('returns empty arrays when no designs', async () => {
    const db = createMockDb()
    const result = await handleListDesigns(mockUser, db as any)
    expect(result).toHaveProperty('own')
    expect(result).toHaveProperty('shared')
    expect(Array.isArray(result.own)).toBe(true)
  })
})

describe('handleDeleteDesign', () => {
  test('rejects when design not found', async () => {
    const db = createMockDb([])
    await expect(
      handleDeleteDesign('nonexistent', mockUser, db as any)
    ).rejects.toThrow(DesignError)
  })

  test('rejects when user does not own design', async () => {
    const db = createMockDb([{ id: 'd1', user_id: 'other-user' }])
    await expect(
      handleDeleteDesign('d1', mockUser, db as any)
    ).rejects.toThrow(DesignError)
  })
})

describe('handleArchiveDesign', () => {
  test('rejects when design not found', async () => {
    const db = createMockDb([])
    await expect(
      handleArchiveDesign('nonexistent', mockUser, db as any)
    ).rejects.toThrow(DesignError)
  })
})
