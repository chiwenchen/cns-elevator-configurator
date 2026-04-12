// src/handlers/admin.test.ts
import { describe, test, expect } from 'bun:test'
import { handleListUsers, handleUpdateRole, AdminError } from './admin'

function createMockDb(users: any[] = []) {
  return {
    prepare(query: string) {
      return {
        bind(..._args: any[]) { return this },
        async first() {
          return users[0] ?? null
        },
        async all() {
          return { results: users }
        },
        async run() { return { success: true } },
      }
    },
  }
}

describe('handleUpdateRole', () => {
  test('rejects invalid role', async () => {
    const db = createMockDb([{ id: 'u1', role: 'user' }])
    await expect(
      handleUpdateRole('u1', { role: 'superadmin' }, db as any)
    ).rejects.toThrow(AdminError)
  })

  test('rejects unknown user', async () => {
    const db = createMockDb([])
    await expect(
      handleUpdateRole('nonexistent', { role: 'pro' }, db as any)
    ).rejects.toThrow(AdminError)
  })
})
