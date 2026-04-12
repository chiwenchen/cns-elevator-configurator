// src/handlers/admin.ts
import { getWeekStartUtc } from '../config/quota'

export class AdminError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'AdminError'
  }
}

const VALID_ROLES = ['user', 'pro', 'admin']

export async function handleListUsers(
  db: any,
): Promise<{ users: any[] }> {
  const weekStart = getWeekStartUtc()

  const result = await db.prepare(`
    SELECT u.id, u.email, u.raw_email, u.role, u.company_id, u.created_at,
      c.name as company_name,
      (SELECT COUNT(*) FROM saved_designs d WHERE d.user_id = u.id AND d.created_at >= ?) as dxf_this_week,
      (SELECT COUNT(*) FROM chat_sessions s WHERE s.user_id = u.id AND s.created_at >= ?) as ai_this_week
    FROM users u
    LEFT JOIN companies c ON u.company_id = c.id
    ORDER BY u.created_at DESC
  `).bind(weekStart, weekStart).all()

  return { users: result.results }
}

export async function handleUpdateRole(
  userId: string,
  body: { role?: string },
  db: any,
): Promise<{ ok: true; user: { id: string; role: string } }> {
  const role = body.role
  if (!role || !VALID_ROLES.includes(role)) {
    throw new AdminError(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`)
  }

  const user = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(userId).first()
  if (!user) throw new AdminError('找不到此使用者', 404)

  await db.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, userId).run()

  return { ok: true, user: { id: userId, role } }
}
