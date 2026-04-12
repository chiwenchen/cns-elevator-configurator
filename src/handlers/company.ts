// src/handlers/company.ts
import type { AuthUser } from '../auth/middleware'
import { normalizeEmail } from '../auth/normalize-email'

export class CompanyError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'CompanyError'
  }
}

type SendInviteFn = (to: string, inviterEmail: string, companyName: string, token: string) => Promise<void>

export async function handleCreateCompany(
  body: { name?: string },
  user: AuthUser,
  db: any,
): Promise<{ company: { id: string; name: string } }> {
  if (user.company_id) {
    throw new CompanyError('您已經屬於一間公司，請先離開目前的公司')
  }
  const name = (body.name ?? '').trim()
  if (!name) {
    throw new CompanyError('請輸入公司名稱')
  }

  const companyId = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.prepare(
    `INSERT INTO companies (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)`
  ).bind(companyId, name, user.id, now).run()

  await db.prepare(
    `UPDATE users SET company_id = ? WHERE id = ?`
  ).bind(companyId, user.id).run()

  return { company: { id: companyId, name } }
}

export async function handleGetCompany(
  user: AuthUser,
  db: any,
): Promise<{ company: any; members: any[] }> {
  if (!user.company_id) {
    throw new CompanyError('您尚未加入任何公司', 404)
  }

  const company = await db.prepare(
    `SELECT id, name, owner_id, created_at FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (!company) throw new CompanyError('找不到公司', 404)

  const membersResult = await db.prepare(
    `SELECT id, email, raw_email, role, created_at FROM users WHERE company_id = ?`
  ).bind(user.company_id).all()

  return {
    company: { ...company, is_owner: company.owner_id === user.id },
    members: membersResult.results,
  }
}

export async function handleInvite(
  body: { email?: string },
  user: AuthUser,
  db: any,
  sendInvite: SendInviteFn,
): Promise<{ ok: true; invite_id: string }> {
  if (!user.company_id) throw new CompanyError('您尚未加入任何公司')

  // Check ownership
  const company = await db.prepare(
    `SELECT id, name, owner_id FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (!company || company.owner_id !== user.id) {
    throw new CompanyError('只有公司擁有者可以邀請成員', 403)
  }

  const rawEmail = (body.email ?? '').trim()
  if (!rawEmail || !rawEmail.includes('@')) throw new CompanyError('請輸入有效的 email')

  const email = normalizeEmail(rawEmail)

  // Check if already a member
  const existing = await db.prepare(
    `SELECT id FROM users WHERE email = ? AND company_id = ?`
  ).bind(email, user.company_id).first()

  if (existing) throw new CompanyError('此使用者已經是公司成員')

  const inviteId = crypto.randomUUID()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await db.prepare(
    `INSERT INTO company_invites (id, company_id, invited_email, invited_by, expires_at, accepted, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).bind(inviteId, user.company_id, email, user.id, expiresAt, now).run()

  await sendInvite(rawEmail, user.raw_email, company.name, inviteId)

  return { ok: true, invite_id: inviteId }
}

export async function handleJoinCompany(
  token: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true; company: { id: string; name: string } }> {
  if (user.company_id) {
    throw new CompanyError('您已經屬於一間公司，請先離開目前的公司')
  }

  const invite = await db.prepare(
    `SELECT i.*, c.name as company_name FROM company_invites i JOIN companies c ON i.company_id = c.id WHERE i.id = ?`
  ).bind(token).first()

  if (!invite) throw new CompanyError('找不到此邀請連結', 404)
  if (invite.accepted) throw new CompanyError('此邀請已被使用')
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new CompanyError('此邀請已過期')
  if (invite.invited_email !== user.email) {
    throw new CompanyError('此邀請連結不是寄給您的 email', 403)
  }

  // Accept invite
  await db.prepare(`UPDATE company_invites SET accepted = 1 WHERE id = ?`).bind(token).run()
  await db.prepare(`UPDATE users SET company_id = ? WHERE id = ?`).bind(invite.company_id, user.id).run()

  return { ok: true, company: { id: invite.company_id, name: invite.company_name } }
}

export async function handleLeaveCompany(
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  if (!user.company_id) throw new CompanyError('您尚未加入任何公司')

  const company = await db.prepare(
    `SELECT owner_id FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (company && company.owner_id === user.id) {
    throw new CompanyError('公司擁有者無法離開公司')
  }

  await db.prepare(`UPDATE users SET company_id = NULL WHERE id = ?`).bind(user.id).run()

  return { ok: true }
}

export async function handleRemoveMember(
  targetUserId: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  if (!user.company_id) throw new CompanyError('您尚未加入任何公司')

  const company = await db.prepare(
    `SELECT owner_id FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (!company || company.owner_id !== user.id) {
    throw new CompanyError('只有公司擁有者可以移除成員', 403)
  }

  if (targetUserId === user.id) {
    throw new CompanyError('無法移除自己')
  }

  const target = await db.prepare(
    `SELECT id, company_id FROM users WHERE id = ?`
  ).bind(targetUserId).first()

  if (!target || target.company_id !== user.company_id) {
    throw new CompanyError('此使用者不是公司成員', 404)
  }

  await db.prepare(`UPDATE users SET company_id = NULL WHERE id = ?`).bind(targetUserId).run()

  return { ok: true }
}
