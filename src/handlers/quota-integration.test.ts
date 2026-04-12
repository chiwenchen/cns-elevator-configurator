// src/handlers/quota-integration.test.ts
import { describe, test, expect } from 'bun:test'
import { getQuotaLimits, QUOTA_LIMITS } from '../config/quota'

// =======================================================================
// Tests — verify quota aggregation logic for all roles & company combos
// =======================================================================

describe('Quota Integration', () => {
  test('individual user = 3 DXF, 10 AI', () => {
    const limits = getQuotaLimits([{ role: 'user' }])
    expect(limits.dxf_limit).toBe(3)
    expect(limits.ai_limit).toBe(10)
  })

  test('individual pro = 20 DXF, 200 AI', () => {
    const limits = getQuotaLimits([{ role: 'pro' }])
    expect(limits.dxf_limit).toBe(20)
    expect(limits.ai_limit).toBe(200)
  })

  test('individual admin = 999 DXF, 9999 AI', () => {
    const limits = getQuotaLimits([{ role: 'admin' }])
    expect(limits.dxf_limit).toBe(999)
    expect(limits.ai_limit).toBe(9999)
  })

  test('company with pro + user = 23 DXF, 210 AI', () => {
    const members = [{ role: 'pro' }, { role: 'user' }]
    const limits = getQuotaLimits(members)
    expect(limits.dxf_limit).toBe(23) // 20 + 3
    expect(limits.ai_limit).toBe(210) // 200 + 10
  })

  test('company with 2 users = 6 DXF, 20 AI', () => {
    const members = [{ role: 'user' }, { role: 'user' }]
    const limits = getQuotaLimits(members)
    expect(limits.dxf_limit).toBe(6)
    expect(limits.ai_limit).toBe(20)
  })

  test('company with pro + 2 users = 26 DXF, 220 AI', () => {
    const members = [{ role: 'pro' }, { role: 'user' }, { role: 'user' }]
    const limits = getQuotaLimits(members)
    expect(limits.dxf_limit).toBe(26) // 20 + 3 + 3
    expect(limits.ai_limit).toBe(220) // 200 + 10 + 10
  })

  test('unknown role falls back to user limits', () => {
    const limits = getQuotaLimits([{ role: 'unknown_role' }])
    expect(limits.dxf_limit).toBe(QUOTA_LIMITS.user!.dxf)
    expect(limits.ai_limit).toBe(QUOTA_LIMITS.user!.ai)
  })

  test('empty members array = 0 limits', () => {
    const limits = getQuotaLimits([])
    expect(limits.dxf_limit).toBe(0)
    expect(limits.ai_limit).toBe(0)
  })
})
