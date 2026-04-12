// src/handlers/auth.ts
import { normalizeEmail } from '../auth/normalize-email'
import { generateOtpCode, getOtpExpiresAt, isOtpExpired, isOtpExhausted, OTP_RATE_LIMIT_MS, OTP_HOURLY_LIMIT } from '../auth/otp'
import { signJwt } from '../auth/jwt'
import { buildSessionCookie, buildClearSessionCookie, SESSION_MAX_AGE, type AuthUser } from '../auth/middleware'
import { getWeekStartUtc, getNextResetUtc, getQuotaLimits } from '../config/quota'

export class AuthError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'AuthError'
  }
}

type SendOtpFn = (to: string, code: string) => Promise<void>

export async function handleRequestOtp(
  body: { email?: string },
  db: any,
  sendOtp: SendOtpFn,
): Promise<{ ok: true }> {
  const rawEmail = (body.email ?? '').trim()
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new AuthError('請輸入有效的 email')
  }
  const email = normalizeEmail(rawEmail)

  // Rate limit: 60s between requests
  const recentOtp = await db.prepare(
    `SELECT created_at FROM otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first()

  if (recentOtp) {
    const elapsed = Date.now() - new Date(recentOtp.created_at).getTime()
    if (elapsed < OTP_RATE_LIMIT_MS) {
      throw new AuthError('請稍候再試，每 60 秒只能寄送一次驗證碼', 429)
    }
  }

  // Rate limit: max 5 per hour
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const hourlyCount = await db.prepare(
    `SELECT COUNT(*) as count FROM otp_codes WHERE email = ? AND created_at >= ?`
  ).bind(email, hourAgo).first()

  if (hourlyCount && hourlyCount.count >= OTP_HOURLY_LIMIT) {
    throw new AuthError('已超過每小時驗證碼上限，請稍後再試', 429)
  }

  // Create user if doesn't exist
  const existingUser = await db.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(email).first()

  if (!existingUser) {
    const userId = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO users (id, email, raw_email, role, created_at) VALUES (?, ?, ?, 'user', ?)`
    ).bind(userId, email, rawEmail, new Date().toISOString()).run()
  }

  // Invalidate old OTPs
  await db.prepare(
    `UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0`
  ).bind(email).run()

  // Generate new OTP
  const code = generateOtpCode()
  const otpId = crypto.randomUUID()
  const now = new Date().toISOString()
  const expiresAt = getOtpExpiresAt()

  await db.prepare(
    `INSERT INTO otp_codes (id, email, code, expires_at, used, attempts, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)`
  ).bind(otpId, email, code, expiresAt, now).run()

  // Send email (use raw_email for delivery)
  const user = await db.prepare(`SELECT raw_email FROM users WHERE email = ?`).bind(email).first()
  await sendOtp(user?.raw_email ?? rawEmail, code)

  return { ok: true }
}

export async function handleVerifyOtp(
  body: { email?: string; code?: string },
  db: any,
  jwtSecret: string,
): Promise<{ user: any; is_new: boolean; cookie: string }> {
  const rawEmail = (body.email ?? '').trim()
  const code = (body.code ?? '').trim()
  if (!rawEmail || !code) {
    throw new AuthError('請輸入 email 和驗證碼')
  }
  const email = normalizeEmail(rawEmail)

  // Find latest unused OTP for this email
  const otp = await db.prepare(
    `SELECT * FROM otp_codes WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first()

  if (!otp) {
    throw new AuthError('找不到驗證碼，請重新寄送')
  }

  if (isOtpExpired(otp.expires_at)) {
    throw new AuthError('驗證碼已過期，請重新寄送')
  }

  if (isOtpExhausted(otp.attempts)) {
    throw new AuthError('驗證碼嘗試次數已達上限，請重新寄送')
  }

  if (otp.code !== code) {
    await db.prepare(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`
    ).bind(otp.id).run()
    throw new AuthError('驗證碼錯誤')
  }

  // Mark used
  await db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).bind(otp.id).run()

  // Get user
  const user = await db.prepare(
    `SELECT id, email, raw_email, role, company_id, created_at FROM users WHERE email = ?`
  ).bind(email).first()

  if (!user) {
    throw new AuthError('使用者不存在', 500)
  }

  // Check if new user (created within last 5 minutes = likely just created by request-otp)
  const isNew = (Date.now() - new Date(user.created_at).getTime()) < 5 * 60 * 1000

  // Create session
  const sessionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const sessionExpires = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString()

  await db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).bind(sessionId, user.id, sessionExpires, now).run()

  // Sign JWT
  const token = await signJwt(
    { sub: user.id, jti: sessionId, role: user.role },
    jwtSecret,
    SESSION_MAX_AGE,
  )

  return {
    user: { id: user.id, email: user.email, raw_email: user.raw_email, role: user.role, company_id: user.company_id },
    is_new: isNew,
    cookie: buildSessionCookie(token),
  }
}

export async function handleLogout(
  sessionId: string,
  db: any,
): Promise<{ ok: true; cookie: string }> {
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run()
  return { ok: true, cookie: buildClearSessionCookie() }
}

export async function handleMe(
  user: AuthUser,
  db: any,
): Promise<{
  user: { id: string; email: string; raw_email: string; role: string; company: { id: string; name: string } | null }
  quota: { dxf_used: number; dxf_limit: number; ai_used: number; ai_limit: number; resets_at: string }
}> {
  // Get company info
  let company: { id: string; name: string } | null = null
  if (user.company_id) {
    const row = await db.prepare(`SELECT id, name FROM companies WHERE id = ?`).bind(user.company_id).first()
    if (row) company = { id: row.id, name: row.name }
  }

  // Get quota limits (all members if company)
  const weekStart = getWeekStartUtc()
  let members: Array<{ role: string }>

  if (user.company_id) {
    const result = await db.prepare(
      `SELECT role FROM users WHERE company_id = ?`
    ).bind(user.company_id).all()
    members = result.results as Array<{ role: string }>
  } else {
    members = [{ role: user.role }]
  }

  const limits = getQuotaLimits(members)

  // Get usage counts
  let dxfUsed: number
  let aiUsed: number

  if (user.company_id) {
    const dxfRow = await db.prepare(
      `SELECT COUNT(*) as count FROM saved_designs WHERE created_at >= ? AND user_id IN (SELECT id FROM users WHERE company_id = ?)`
    ).bind(weekStart, user.company_id).first()
    dxfUsed = dxfRow?.count ?? 0

    const aiRow = await db.prepare(
      `SELECT COUNT(*) as count FROM chat_sessions WHERE created_at >= ? AND user_id IN (SELECT id FROM users WHERE company_id = ?)`
    ).bind(weekStart, user.company_id).first()
    aiUsed = aiRow?.count ?? 0
  } else {
    const dxfRow = await db.prepare(
      `SELECT COUNT(*) as count FROM saved_designs WHERE created_at >= ? AND user_id = ?`
    ).bind(weekStart, user.id).first()
    dxfUsed = dxfRow?.count ?? 0

    const aiRow = await db.prepare(
      `SELECT COUNT(*) as count FROM chat_sessions WHERE created_at >= ? AND user_id = ?`
    ).bind(weekStart, user.id).first()
    aiUsed = aiRow?.count ?? 0
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      raw_email: user.raw_email,
      role: user.role,
      company,
    },
    quota: {
      dxf_used: dxfUsed,
      dxf_limit: limits.dxf_limit,
      ai_used: aiUsed,
      ai_limit: limits.ai_limit,
      resets_at: getNextResetUtc(),
    },
  }
}
