import { describe, test, expect } from 'bun:test'
import { handleSolve } from './solve'
import { InMemoryRulesStore } from '../config/load'

const validBody = { mode: 'B', stops: 6, usage: 'passenger', rated_load_kg: 1000 }

describe('handleSolve with auth', () => {
  test('returns dxf_string when user is provided', async () => {
    const store = new InMemoryRulesStore()
    const user = {
      id: 'u1',
      email: 't@t.com',
      raw_email: 't@t.com',
      role: 'user',
      company_id: null,
      session_id: 's1',
    }
    const result = await handleSolve(validBody, store, user, null)
    expect(result.dxf_string).toBeDefined()
    expect(typeof result.dxf_string).toBe('string')
    expect(result.dxf_string!.length).toBeGreaterThan(0)
  })

  test('omits dxf_string when user is null', async () => {
    const store = new InMemoryRulesStore()
    const result = await handleSolve(validBody, store, null, null)
    expect(result.dxf_string).toBeUndefined()
  })

  test('still returns design, dxf_kb, analysis, validation_report when user is null', async () => {
    const store = new InMemoryRulesStore()
    const result = await handleSolve(validBody, store, null, null)
    expect(result.design).toBeDefined()
    expect(typeof result.dxf_kb).toBe('number')
    expect(result.dxf_kb).toBeGreaterThan(0)
    expect(result.analysis).toBeDefined()
    expect(result.validation_report).toBeDefined()
  })

  test('returns full result including dxf_string when user is provided and db is null (no quota check)', async () => {
    const store = new InMemoryRulesStore()
    const user = {
      id: 'u2',
      email: 'admin@t.com',
      raw_email: 'admin@t.com',
      role: 'admin',
      company_id: null,
      session_id: 's2',
    }
    const result = await handleSolve(validBody, store, user, null)
    expect(result.dxf_string).toBeDefined()
    expect(result.design).toBeDefined()
    expect(result.analysis).toBeDefined()
  })
})
