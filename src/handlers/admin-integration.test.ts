// src/handlers/admin-integration.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import { handleListUsers, handleUpdateRole, AdminError } from './admin'

// ---------------------------------------------------------------------------
// In-memory mock DB
// ---------------------------------------------------------------------------
interface Row { [key: string]: any }

function createInMemoryDb() {
  const store: Record<string, Row[]> = {
    users: [],
    companies: [],
    saved_designs: [],
    chat_sessions: [],
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
          // SELECT id, role FROM users WHERE id = ?
          if (query.includes('FROM users') && query.includes('WHERE id')) {
            return store.users.find(u => u.id === _args[0]) ?? null
          }
          return null
        },

        async all() {
          // The big list-users join query
          if (query.includes('FROM users') && query.includes('LEFT JOIN companies')) {
            const weekStart = _args[0]
            return {
              results: store.users.map(u => {
                const company = store.companies.find(c => c.id === u.company_id)
                const dxfCount = store.saved_designs.filter(
                  d => d.user_id === u.id && d.created_at >= weekStart,
                ).length
                const aiCount = store.chat_sessions.filter(
                  s => s.user_id === u.id && s.created_at >= weekStart,
                ).length
                return {
                  ...u,
                  company_name: company?.name ?? null,
                  dxf_this_week: dxfCount,
                  ai_this_week: aiCount,
                }
              }),
            }
          }
          return { results: [] }
        },

        async run() {
          // UPDATE users SET role = ? WHERE id = ?
          if (query.includes('UPDATE users') && query.includes('role')) {
            const user = store.users.find(u => u.id === _args[1])
            if (user) user.role = _args[0]
            return { success: true }
          }
          return { success: true }
        },
      }
      return stmt
    },
  }
}

// =======================================================================
// Tests
// =======================================================================

describe('Admin Integration', () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeEach(() => {
    db = createInMemoryDb()
  })

  test('list users: returns all users with usage counts', async () => {
    const now = new Date().toISOString()
    db._store.users.push(
      { id: 'u1', email: 'a@test.com', raw_email: 'a@test.com', role: 'user', company_id: null, created_at: now },
      { id: 'u2', email: 'b@test.com', raw_email: 'b@test.com', role: 'pro', company_id: 'comp-1', created_at: now },
    )
    db._store.companies.push({ id: 'comp-1', name: 'TestCo' })
    db._store.saved_designs.push(
      { id: 'd1', user_id: 'u1', created_at: now },
      { id: 'd2', user_id: 'u1', created_at: now },
    )
    db._store.chat_sessions.push(
      { id: 'cs1', user_id: 'u2', created_at: now },
    )

    const result = await handleListUsers(db as any)
    expect(result.users).toHaveLength(2)

    const userA = result.users.find((u: any) => u.id === 'u1')
    expect(userA.dxf_this_week).toBe(2)
    expect(userA.ai_this_week).toBe(0)
    expect(userA.company_name).toBeNull()

    const userB = result.users.find((u: any) => u.id === 'u2')
    expect(userB.dxf_this_week).toBe(0)
    expect(userB.ai_this_week).toBe(1)
    expect(userB.company_name).toBe('TestCo')
  })

  test('update role: user → pro', async () => {
    db._store.users.push({ id: 'u-role', email: 'role@test.com', raw_email: 'role@test.com', role: 'user', company_id: null, created_at: new Date().toISOString() })

    const result = await handleUpdateRole('u-role', { role: 'pro' }, db as any)
    expect(result.ok).toBe(true)
    expect(result.user.role).toBe('pro')

    // Actually updated in store
    expect(db._store.users[0]!.role).toBe('pro')
  })

  test('update role: rejects invalid role', async () => {
    db._store.users.push({ id: 'u-bad', email: 'bad@test.com', raw_email: 'bad@test.com', role: 'user', company_id: null, created_at: new Date().toISOString() })

    await expect(
      handleUpdateRole('u-bad', { role: 'superadmin' }, db as any),
    ).rejects.toThrow(AdminError)
  })

  test('update role: rejects unknown user', async () => {
    await expect(
      handleUpdateRole('nonexistent', { role: 'pro' }, db as any),
    ).rejects.toThrow(AdminError)
  })
})
