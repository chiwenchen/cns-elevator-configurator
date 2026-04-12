import { describe, test, expect } from 'bun:test'
import { getWeekStartUtc, getQuotaLimits, QUOTA_LIMITS } from './quota'

describe('getWeekStartUtc', () => {
  test('returns ISO string', () => {
    const result = getWeekStartUtc()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  test('returns a Monday in UTC+8', () => {
    const result = getWeekStartUtc()
    const date = new Date(result)
    const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    expect(utc8.getUTCHours()).toBe(0)
    expect(utc8.getUTCMinutes()).toBe(0)
    expect(utc8.getUTCDay()).toBe(1)
  })
  test('week start is in the past or now', () => {
    const result = getWeekStartUtc()
    expect(new Date(result).getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('getQuotaLimits', () => {
  test('returns user limits for single user without company', () => {
    const limits = getQuotaLimits([{ role: 'user' }])
    expect(limits).toEqual({ dxf_limit: 3, ai_limit: 10 })
  })
  test('returns pro limits for single pro', () => {
    const limits = getQuotaLimits([{ role: 'pro' }])
    expect(limits).toEqual({ dxf_limit: 20, ai_limit: 200 })
  })
  test('returns admin limits', () => {
    const limits = getQuotaLimits([{ role: 'admin' }])
    expect(limits).toEqual({ dxf_limit: 999, ai_limit: 9999 })
  })
  test('sums company members additively', () => {
    const limits = getQuotaLimits([{ role: 'pro' }, { role: 'user' }])
    expect(limits).toEqual({ dxf_limit: 23, ai_limit: 210 })
  })
  test('three members: pro + pro + user', () => {
    const limits = getQuotaLimits([{ role: 'pro' }, { role: 'pro' }, { role: 'user' }])
    expect(limits).toEqual({ dxf_limit: 43, ai_limit: 410 })
  })
})

describe('QUOTA_LIMITS', () => {
  test('user limits', () => { expect(QUOTA_LIMITS.user).toEqual({ dxf: 3, ai: 10 }) })
  test('pro limits', () => { expect(QUOTA_LIMITS.pro).toEqual({ dxf: 20, ai: 200 }) })
  test('admin limits', () => { expect(QUOTA_LIMITS.admin).toEqual({ dxf: 999, ai: 9999 }) })
})
