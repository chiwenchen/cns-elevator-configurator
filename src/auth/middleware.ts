// src/auth/middleware.ts
import { verifyJwt, type JwtPayload } from './jwt'

export interface AuthUser {
  id: string
  email: string
  raw_email: string
  role: string
  company_id: string | null
  session_id: string
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const prefix = name + '='
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length)
    }
  }
  return null
}

/**
 * Extract JWT payload from cookie value.
 * Returns null if token is missing, invalid, or expired.
 * Does NOT check DB session — caller must do that.
 */
export async function extractUser(
  cookieValue: string | null,
  jwtSecret: string,
): Promise<JwtPayload | null> {
  if (!cookieValue) return null
  try {
    return await verifyJwt(cookieValue, jwtSecret)
  } catch {
    return null
  }
}

export const SESSION_COOKIE_NAME = 'vp_session'
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // 7 days in seconds

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

/**
 * Probabilistic cleanup — returns true 1% of the time.
 */
export function shouldRunCleanup(): boolean {
  return Math.random() < 0.01
}
