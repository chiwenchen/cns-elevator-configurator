// src/handlers/designs.ts
import type { AuthUser } from '../auth/middleware'

export class DesignError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'DesignError'
  }
}

const LIST_COLUMNS = `id, user_id, company_id, name, solver_input, case_overrides, detail_level, dxf_kb, archived_at, created_at`

export async function handleListDesigns(
  user: AuthUser,
  db: any,
): Promise<{ own: any[]; shared: any[] }> {
  // Own active designs
  const ownResult = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM saved_designs WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC`
  ).bind(user.id).all()
  const own = ownResult.results

  // Shared designs (company members, excluding own)
  let shared: any[] = []
  if (user.company_id) {
    const sharedResult = await db.prepare(
      `SELECT d.${LIST_COLUMNS.split(',').map(c => 'd.' + c.trim()).join(', ')}, u.raw_email as user_raw_email
       FROM saved_designs d JOIN users u ON d.user_id = u.id
       WHERE d.company_id = ? AND d.user_id != ? AND d.archived_at IS NULL
       ORDER BY d.created_at DESC`
    ).bind(user.company_id, user.id).all()
    shared = sharedResult.results
  }

  return { own, shared }
}

export async function handleListArchivedDesigns(
  user: AuthUser,
  db: any,
): Promise<{ designs: any[] }> {
  const result = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM saved_designs WHERE user_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC`
  ).bind(user.id).all()

  const designs = result.results.map((d: any) => ({
    ...d,
    days_remaining: Math.max(0, Math.ceil((new Date(d.archived_at).getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000))),
  }))

  return { designs }
}

export async function handleGetDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<any> {
  const design = await db.prepare(
    `SELECT *, (SELECT raw_email FROM users WHERE id = saved_designs.user_id) as user_raw_email FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)

  // Check access: own design or same company
  if (design.user_id !== user.id) {
    if (!user.company_id || design.company_id !== user.company_id) {
      throw new DesignError('無權存取此圖紙', 403)
    }
  }

  return design
}

export async function handleArchiveDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  const design = await db.prepare(
    `SELECT id, user_id FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)
  if (design.user_id !== user.id) throw new DesignError('只能封存自己的圖紙', 403)

  await db.prepare(
    `UPDATE saved_designs SET archived_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), id).run()

  return { ok: true }
}

export async function handleUnarchiveDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  const design = await db.prepare(
    `SELECT id, user_id, archived_at FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)
  if (design.user_id !== user.id) throw new DesignError('只能取消封存自己的圖紙', 403)
  if (!design.archived_at) throw new DesignError('此圖紙未被封存', 400)

  await db.prepare(
    `UPDATE saved_designs SET archived_at = NULL WHERE id = ?`
  ).bind(id).run()

  return { ok: true }
}

export async function handleDeleteDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  const design = await db.prepare(
    `SELECT id, user_id FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)
  if (design.user_id !== user.id) throw new DesignError('只能刪除自己的圖紙', 403)

  await db.prepare(`DELETE FROM saved_designs WHERE id = ?`).bind(id).run()

  return { ok: true }
}
