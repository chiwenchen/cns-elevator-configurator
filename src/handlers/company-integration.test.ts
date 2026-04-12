// src/handlers/company-integration.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  handleCreateCompany,
  handleGetCompany,
  handleInvite,
  handleJoinCompany,
  handleLeaveCompany,
  handleRemoveMember,
  CompanyError,
} from './company'
import type { AuthUser } from '../auth/middleware'

// ---------------------------------------------------------------------------
// In-memory mock DB
// ---------------------------------------------------------------------------
interface Row { [key: string]: any }

function createInMemoryDb() {
  const store: Record<string, Row[]> = {
    users: [],
    companies: [],
    company_invites: [],
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
          // companies WHERE id = ?
          if (query.includes('FROM companies') && query.includes('WHERE id')) {
            return store.companies.find(c => c.id === _args[0]) ?? null
          }
          // company_invites ... WHERE i.id = ?
          if (query.includes('company_invites') && query.includes('WHERE i.id')) {
            const invite = store.company_invites.find(i => i.id === _args[0])
            if (!invite) return null
            const company = store.companies.find(c => c.id === invite.company_id)
            return { ...invite, company_name: company?.name ?? null }
          }
          // users WHERE email = ? AND company_id = ?
          if (query.includes('FROM users') && query.includes('email') && query.includes('company_id')) {
            return store.users.find(u => u.email === _args[0] && u.company_id === _args[1]) ?? null
          }
          // users WHERE id = ?
          if (query.includes('FROM users') && query.includes('WHERE id')) {
            return store.users.find(u => u.id === _args[0]) ?? null
          }
          // companies WHERE id — owner_id check
          if (query.includes('FROM companies')) {
            return store.companies.find(c => c.id === _args[0]) ?? null
          }
          return null
        },

        async all() {
          // members: users WHERE company_id = ?
          if (query.includes('FROM users') && query.includes('company_id')) {
            return {
              results: store.users.filter(u => u.company_id === _args[0]),
            }
          }
          return { results: [] }
        },

        async run() {
          // INSERT INTO companies
          if (query.startsWith('INSERT INTO companies')) {
            store.companies.push({
              id: _args[0],
              name: _args[1],
              owner_id: _args[2],
              created_at: _args[3],
            })
            return { success: true }
          }
          // UPDATE users SET company_id = ? WHERE id = ?
          // OR: UPDATE users SET company_id = NULL WHERE id = ?
          if (query.includes('UPDATE users') && query.includes('company_id')) {
            if (query.includes('company_id = NULL')) {
              // company_id = NULL WHERE id = ? → _args[0] is user id
              const user = store.users.find(u => u.id === _args[0])
              if (user) user.company_id = null
            } else {
              // company_id = ? WHERE id = ? → _args[0] is company_id, _args[1] is user id
              const user = store.users.find(u => u.id === _args[1])
              if (user) user.company_id = _args[0]
            }
            return { success: true }
          }
          // INSERT INTO company_invites
          if (query.startsWith('INSERT INTO company_invites')) {
            store.company_invites.push({
              id: _args[0],
              company_id: _args[1],
              invited_email: _args[2],
              invited_by: _args[3],
              expires_at: _args[4],
              accepted: 0,
              created_at: _args[5],
            })
            return { success: true }
          }
          // UPDATE company_invites SET accepted = 1
          if (query.includes('UPDATE company_invites') && query.includes('accepted')) {
            const invite = store.company_invites.find(i => i.id === _args[0])
            if (invite) invite.accepted = 1
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

function mockSendInvite() {
  const sent: Array<{ to: string; inviter: string; company: string; token: string }> = []
  return {
    sent,
    fn: async (to: string, inviterEmail: string, companyName: string, token: string) => {
      sent.push({ to, inviter: inviterEmail, company: companyName, token })
    },
  }
}

function makeUser(id: string, email: string, companyId: string | null = null): AuthUser {
  return {
    id,
    email,
    raw_email: email,
    role: 'user',
    company_id: companyId,
    session_id: `sess-${id}`,
  }
}

// =======================================================================
// Tests
// =======================================================================

describe('Company Integration', () => {
  let db: ReturnType<typeof createInMemoryDb>

  beforeEach(() => {
    db = createInMemoryDb()
  })

  // --- create --------------------------------------------------------

  test('create company: sets user as owner', async () => {
    const owner = makeUser('u1', 'owner@test.com')
    db._store.users.push({ id: 'u1', email: 'owner@test.com', raw_email: 'owner@test.com', role: 'user', company_id: null })

    const result = await handleCreateCompany({ name: 'Acme Corp' }, owner, db as any)
    expect(result.company.name).toBe('Acme Corp')
    expect(result.company.id).toBeTruthy()

    // Company created with correct owner
    expect(db._store.companies).toHaveLength(1)
    expect(db._store.companies[0]!.owner_id).toBe('u1')

    // User's company_id updated
    expect(db._store.users[0]!.company_id).toBe(result.company.id)
  })

  test('create company: rejects if already has company', async () => {
    const user = makeUser('u2', 'taken@test.com', 'existing-co')

    await expect(
      handleCreateCompany({ name: 'New Co' }, user, db as any),
    ).rejects.toThrow(CompanyError)
  })

  // --- get -----------------------------------------------------------

  test('get company: returns company + members', async () => {
    const companyId = 'comp-get'
    db._store.companies.push({ id: companyId, name: 'GetCo', owner_id: 'u-owner', created_at: new Date().toISOString() })
    db._store.users.push(
      { id: 'u-owner', email: 'owner@co.com', raw_email: 'owner@co.com', role: 'user', company_id: companyId },
      { id: 'u-member', email: 'member@co.com', raw_email: 'member@co.com', role: 'user', company_id: companyId },
    )

    const user = makeUser('u-owner', 'owner@co.com', companyId)
    const result = await handleGetCompany(user, db as any)

    expect(result.company.name).toBe('GetCo')
    expect(result.company.is_owner).toBe(true)
    expect(result.members).toHaveLength(2)
  })

  // --- invite --------------------------------------------------------

  test('invite: creates invite record', async () => {
    const companyId = 'comp-inv'
    db._store.companies.push({ id: companyId, name: 'InvCo', owner_id: 'u-inv-owner', created_at: new Date().toISOString() })
    db._store.users.push({ id: 'u-inv-owner', email: 'owner@inv.com', raw_email: 'owner@inv.com', role: 'user', company_id: companyId })

    const owner = makeUser('u-inv-owner', 'owner@inv.com', companyId)
    const send = mockSendInvite()

    const result = await handleInvite({ email: 'new@inv.com' }, owner, db as any, send.fn)
    expect(result.ok).toBe(true)
    expect(result.invite_id).toBeTruthy()

    // Invite stored
    expect(db._store.company_invites).toHaveLength(1)
    expect(db._store.company_invites[0]!.invited_email).toBe('new@inv.com')

    // Email sent
    expect(send.sent).toHaveLength(1)
    expect(send.sent[0]!.to).toBe('new@inv.com')
  })

  test('invite: rejects non-owner', async () => {
    const companyId = 'comp-noown'
    db._store.companies.push({ id: companyId, name: 'NoOwn', owner_id: 'someone-else', created_at: new Date().toISOString() })

    const nonOwner = makeUser('u-noown', 'noown@test.com', companyId)
    const send = mockSendInvite()

    await expect(
      handleInvite({ email: 'target@test.com' }, nonOwner, db as any, send.fn),
    ).rejects.toThrow('只有公司擁有者可以邀請成員')
  })

  // --- join ----------------------------------------------------------

  test('join: sets company_id on user', async () => {
    const companyId = 'comp-join'
    const inviteId = 'inv-join'
    db._store.companies.push({ id: companyId, name: 'JoinCo', owner_id: 'u-jowner', created_at: new Date().toISOString() })
    db._store.company_invites.push({
      id: inviteId,
      company_id: companyId,
      invited_email: 'joiner@test.com',
      invited_by: 'u-jowner',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      accepted: 0,
      created_at: new Date().toISOString(),
    })
    db._store.users.push({ id: 'u-joiner', email: 'joiner@test.com', raw_email: 'joiner@test.com', role: 'user', company_id: null })

    const joiner = makeUser('u-joiner', 'joiner@test.com')
    const result = await handleJoinCompany(inviteId, joiner, db as any)

    expect(result.ok).toBe(true)
    expect(result.company.name).toBe('JoinCo')

    // User company_id updated
    expect(db._store.users[0]!.company_id).toBe(companyId)
    // Invite marked accepted
    expect(db._store.company_invites[0]!.accepted).toBe(1)
  })

  test('join: rejects wrong email', async () => {
    const inviteId = 'inv-wrong'
    db._store.companies.push({ id: 'comp-w', name: 'WrongCo', owner_id: 'u-w', created_at: new Date().toISOString() })
    db._store.company_invites.push({
      id: inviteId,
      company_id: 'comp-w',
      invited_email: 'correct@test.com',
      invited_by: 'u-w',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      accepted: 0,
      created_at: new Date().toISOString(),
    })

    const wrongUser = makeUser('u-wrong', 'wrong@test.com')
    await expect(
      handleJoinCompany(inviteId, wrongUser, db as any),
    ).rejects.toThrow('不是寄給您的 email')
  })

  test('join: rejects expired invite', async () => {
    const inviteId = 'inv-exp'
    db._store.companies.push({ id: 'comp-e', name: 'ExpCo', owner_id: 'u-e', created_at: new Date().toISOString() })
    db._store.company_invites.push({
      id: inviteId,
      company_id: 'comp-e',
      invited_email: 'exp@test.com',
      invited_by: 'u-e',
      expires_at: new Date(Date.now() - 1000).toISOString(), // expired
      accepted: 0,
      created_at: new Date().toISOString(),
    })

    const user = makeUser('u-exp', 'exp@test.com')
    await expect(
      handleJoinCompany(inviteId, user, db as any),
    ).rejects.toThrow('已過期')
  })

  // --- leave ---------------------------------------------------------

  test('leave: clears company_id', async () => {
    const companyId = 'comp-leave'
    db._store.companies.push({ id: companyId, name: 'LeaveCo', owner_id: 'u-other', created_at: new Date().toISOString() })
    db._store.users.push({ id: 'u-leaver', email: 'leaver@test.com', raw_email: 'leaver@test.com', role: 'user', company_id: companyId })

    const user = makeUser('u-leaver', 'leaver@test.com', companyId)
    const result = await handleLeaveCompany(user, db as any)
    expect(result.ok).toBe(true)

    // company_id cleared
    expect(db._store.users[0]!.company_id).toBeNull()
  })

  test('leave: rejects owner', async () => {
    const companyId = 'comp-ownerleave'
    db._store.companies.push({ id: companyId, name: 'OwnCo', owner_id: 'u-owner2', created_at: new Date().toISOString() })

    const owner = makeUser('u-owner2', 'owner2@test.com', companyId)
    await expect(
      handleLeaveCompany(owner, db as any),
    ).rejects.toThrow('公司擁有者無法離開公司')
  })

  // --- remove member -------------------------------------------------

  test('remove member: clears target company_id', async () => {
    const companyId = 'comp-rm'
    db._store.companies.push({ id: companyId, name: 'RmCo', owner_id: 'u-rmowner', created_at: new Date().toISOString() })
    db._store.users.push(
      { id: 'u-rmowner', email: 'rmowner@test.com', raw_email: 'rmowner@test.com', role: 'user', company_id: companyId },
      { id: 'u-target', email: 'target@test.com', raw_email: 'target@test.com', role: 'user', company_id: companyId },
    )

    const owner = makeUser('u-rmowner', 'rmowner@test.com', companyId)
    const result = await handleRemoveMember('u-target', owner, db as any)
    expect(result.ok).toBe(true)

    // Target's company_id cleared
    const target = db._store.users.find(u => u.id === 'u-target')
    expect(target!.company_id).toBeNull()
  })

  test('remove member: rejects non-owner', async () => {
    const companyId = 'comp-rmno'
    db._store.companies.push({ id: companyId, name: 'RmNoCo', owner_id: 'u-real-owner', created_at: new Date().toISOString() })
    db._store.users.push(
      { id: 'u-notowner', email: 'no@test.com', raw_email: 'no@test.com', role: 'user', company_id: companyId },
    )

    const nonOwner = makeUser('u-notowner', 'no@test.com', companyId)
    await expect(
      handleRemoveMember('u-someone', nonOwner, db as any),
    ).rejects.toThrow('只有公司擁有者可以移除成員')
  })
})
