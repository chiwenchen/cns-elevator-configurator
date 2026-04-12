// src/handlers/designs-integration.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
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

// ---------------------------------------------------------------------------
// In-memory mock DB with real storage for designs
// ---------------------------------------------------------------------------
interface Row { [key: string]: any }

function createInMemoryDb() {
  const store: Record<string, Row[]> = {
    saved_designs: [],
    users: [],
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
          // SELECT * FROM saved_designs WHERE id = ?
          if (query.includes('FROM saved_designs') && query.includes('WHERE id')) {
            const design = store.saved_designs.find(d => d.id === _args[0])
            if (!design) return null
            // If the query also fetches user_raw_email (the get-design query)
            if (query.includes('raw_email')) {
              const user = store.users.find(u => u.id === design.user_id)
              return { ...design, user_raw_email: user?.raw_email ?? null }
            }
            return design
          }
          return null
        },

        async all() {
          // Shared designs (company, not own, not archived) — check BEFORE own
          if (query.includes('saved_designs') && query.includes('user_id !=')) {
            const companyId = _args[0]
            const userId = _args[1]
            return {
              results: store.saved_designs
                .filter(d => d.company_id === companyId && d.user_id !== userId && !d.archived_at)
                .map(d => {
                  const user = store.users.find(u => u.id === d.user_id)
                  return { ...d, user_raw_email: user?.raw_email ?? null }
                }),
            }
          }
          // Archived designs
          if (query.includes('FROM saved_designs') && query.includes('archived_at IS NOT NULL')) {
            const userId = _args[0]
            return {
              results: store.saved_designs.filter(
                d => d.user_id === userId && d.archived_at,
              ),
            }
          }
          // Active own designs
          if (query.includes('FROM saved_designs') && query.includes('archived_at IS NULL')) {
            const userId = _args[0]
            return {
              results: store.saved_designs.filter(
                d => d.user_id === userId && !d.archived_at,
              ),
            }
          }
          return { results: [] }
        },

        async run() {
          // UPDATE saved_designs SET archived_at = ? WHERE id = ?
          // OR: UPDATE saved_designs SET archived_at = NULL WHERE id = ?
          if (query.includes('UPDATE saved_designs') && query.includes('archived_at')) {
            if (query.includes('archived_at = NULL')) {
              // archived_at = NULL WHERE id = ? → _args[0] is design id
              const design = store.saved_designs.find(d => d.id === _args[0])
              if (design) design.archived_at = null
            } else {
              // archived_at = ? WHERE id = ? → _args[0] is timestamp, _args[1] is id
              const design = store.saved_designs.find(d => d.id === _args[1])
              if (design) design.archived_at = _args[0]
            }
            return { success: true }
          }
          // DELETE FROM saved_designs WHERE id = ?
          if (query.includes('DELETE FROM saved_designs')) {
            const idx = store.saved_designs.findIndex(d => d.id === _args[0])
            if (idx >= 0) store.saved_designs.splice(idx, 1)
            return { success: true }
          }
          return { success: true }
        },
      }
      return stmt
    },
  }
}

// Helpers ---------------------------------------------------------------

const userA: AuthUser = {
  id: 'user-a',
  email: 'a@test.com',
  raw_email: 'a@test.com',
  role: 'user',
  company_id: null,
  session_id: 'sess-a',
}

const userB: AuthUser = {
  id: 'user-b',
  email: 'b@test.com',
  raw_email: 'b@test.com',
  role: 'user',
  company_id: null,
  session_id: 'sess-b',
}

const userAWithCompany: AuthUser = { ...userA, company_id: 'comp-1' }
const userBWithCompany: AuthUser = { ...userB, company_id: 'comp-1' }

function seedDesign(store: Record<string, Row[]>, overrides: Partial<Row> = {}): Row {
  const design: Row = {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: overrides.user_id ?? 'user-a',
    company_id: overrides.company_id ?? null,
    name: overrides.name ?? 'Test Design',
    solver_input: '{}',
    case_overrides: '{}',
    detail_level: 'basic',
    dxf_kb: 12,
    dxf_string: '<dxf-content>',
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
  }
  store.saved_designs.push(design)
  return design
}

// =======================================================================
// Tests
// =======================================================================

describe('Designs Integration', () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeEach(() => {
    db = createInMemoryDb()
    db._store.users.push(
      { id: 'user-a', email: 'a@test.com', raw_email: 'a@test.com', role: 'user', company_id: null },
      { id: 'user-b', email: 'b@test.com', raw_email: 'b@test.com', role: 'user', company_id: null },
    )
  })

  test('list designs: empty returns empty arrays', async () => {
    const result = await handleListDesigns(userA, db as any)
    expect(result.own).toEqual([])
    expect(result.shared).toEqual([])
  })

  test('list designs: returns own + shared', async () => {
    seedDesign(db._store, { id: 'd1', user_id: 'user-a', company_id: 'comp-1' })
    seedDesign(db._store, { id: 'd2', user_id: 'user-b', company_id: 'comp-1' })

    const result = await handleListDesigns(userAWithCompany, db as any)
    expect(result.own).toHaveLength(1)
    expect(result.own[0].id).toBe('d1')
    expect(result.shared).toHaveLength(1)
    expect(result.shared[0].id).toBe('d2')
  })

  test('get design by ID: includes dxf_string', async () => {
    seedDesign(db._store, { id: 'd-get', user_id: 'user-a' })

    const design = await handleGetDesign('d-get', userA, db as any)
    expect(design.id).toBe('d-get')
    expect(design.dxf_string).toBe('<dxf-content>')
  })

  test('get design: access denied for other user without company', async () => {
    seedDesign(db._store, { id: 'd-other', user_id: 'user-a', company_id: null })

    await expect(
      handleGetDesign('d-other', userB, db as any),
    ).rejects.toThrow(DesignError)
  })

  test('archive: design disappears from active list', async () => {
    seedDesign(db._store, { id: 'd-arch', user_id: 'user-a' })

    // Before archive: active list has 1
    const before = await handleListDesigns(userA, db as any)
    expect(before.own).toHaveLength(1)

    // Archive
    const result = await handleArchiveDesign('d-arch', userA, db as any)
    expect(result.ok).toBe(true)

    // After archive: active list empty
    const after = await handleListDesigns(userA, db as any)
    expect(after.own).toHaveLength(0)
  })

  test('unarchive: design reappears in active list', async () => {
    seedDesign(db._store, { id: 'd-unarch', user_id: 'user-a', archived_at: new Date().toISOString() })

    // Before unarchive: active list empty
    const before = await handleListDesigns(userA, db as any)
    expect(before.own).toHaveLength(0)

    // Unarchive
    const result = await handleUnarchiveDesign('d-unarch', userA, db as any)
    expect(result.ok).toBe(true)

    // After unarchive: active list has 1
    const after = await handleListDesigns(userA, db as any)
    expect(after.own).toHaveLength(1)
  })

  test('delete: design permanently removed', async () => {
    seedDesign(db._store, { id: 'd-del', user_id: 'user-a' })
    expect(db._store.saved_designs).toHaveLength(1)

    const result = await handleDeleteDesign('d-del', userA, db as any)
    expect(result.ok).toBe(true)
    expect(db._store.saved_designs).toHaveLength(0)
  })

  test('delete: cannot delete other user design', async () => {
    seedDesign(db._store, { id: 'd-no', user_id: 'user-a' })

    await expect(
      handleDeleteDesign('d-no', userB, db as any),
    ).rejects.toThrow(DesignError)

    // Still exists
    expect(db._store.saved_designs).toHaveLength(1)
  })

  test('list archived: shows days_remaining', async () => {
    const archivedAt = new Date().toISOString()
    seedDesign(db._store, { id: 'd-ar', user_id: 'user-a', archived_at: archivedAt })

    const result = await handleListArchivedDesigns(userA, db as any)
    expect(result.designs).toHaveLength(1)
    expect(result.designs[0].days_remaining).toBeGreaterThanOrEqual(6) // 7-day window, just created
    expect(result.designs[0].days_remaining).toBeLessThanOrEqual(7)
  })
})
