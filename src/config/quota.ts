export const QUOTA_LIMITS: Record<string, { dxf: number; ai: number }> = {
  user:  { dxf: 3,   ai: 10 },
  pro:   { dxf: 20,  ai: 200 },
  admin: { dxf: 999, ai: 9999 },
}

export function getWeekStartUtc(): string {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = utc8.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  utc8.setUTCDate(utc8.getUTCDate() - diff)
  utc8.setUTCHours(0, 0, 0, 0)
  const weekStart = new Date(utc8.getTime() - 8 * 60 * 60 * 1000)
  return weekStart.toISOString()
}

export function getNextResetUtc(): string {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = utc8.getUTCDay()
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day
  utc8.setUTCDate(utc8.getUTCDate() + daysUntilMonday)
  utc8.setUTCHours(0, 0, 0, 0)
  const nextReset = new Date(utc8.getTime() - 8 * 60 * 60 * 1000)
  return nextReset.toISOString()
}

export function getQuotaLimits(members: Array<{ role: string }>): { dxf_limit: number; ai_limit: number } {
  let dxf_limit = 0
  let ai_limit = 0
  for (const m of members) {
    const limits = QUOTA_LIMITS[m.role] ?? QUOTA_LIMITS.user!
    dxf_limit += limits.dxf
    ai_limit += limits.ai
  }
  return { dxf_limit, ai_limit }
}
