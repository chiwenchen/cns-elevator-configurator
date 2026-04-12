/**
 * Tests for D1RulesLoader + parseRuleRow path using a fake D1 binding,
 * and fixtureConfigWithOverride helper.
 */

import { describe, test, expect } from 'bun:test'
import { D1RulesLoader, StaticRulesLoader } from './load'
import { fixtureConfigWithOverride } from './fixtures'

interface FakeRow {
  id: number
  key: string
  name: string
  description: string | null
  type: string
  value: string
  default_value: string
  unit: string | null
  baseline_min: number | null
  baseline_max: number | null
  baseline_choices: string | null
  category: string
  mandatory: number
  source: string
}

function makeFakeD1(rows: FakeRow[]) {
  return {
    prepare(_query: string) {
      return {
        async all<T = unknown>(): Promise<{ results: T[] }> {
          return { results: rows as unknown as T[] }
        },
      }
    },
  }
}

describe('D1RulesLoader + parseRuleRow', () => {
  test('parses a number rule row correctly', async () => {
    const fakeRow: FakeRow = {
      id: 7,
      key: 'clearance.front_mm',
      name: '前方淨空',
      description: 'front gap',
      type: 'number',
      value: '150',
      default_value: '150',
      unit: 'mm',
      baseline_min: 100,
      baseline_max: 300,
      baseline_choices: null,
      category: 'clearance',
      mandatory: 1,
      source: 'engineering',
    }
    const loader = new D1RulesLoader(makeFakeD1([fakeRow]))
    const rules = await loader.loadActiveRules()
    expect(rules).toHaveLength(1)
    expect(rules[0]).toEqual({
      id: 7,
      key: 'clearance.front_mm',
      name: '前方淨空',
      description: 'front gap',
      type: 'number',
      value: '150',
      default_value: '150',
      unit: 'mm',
      baseline_min: 100,
      baseline_max: 300,
      baseline_choices: null,
      category: 'clearance',
      mandatory: 1,
      source: 'engineering',
    })
  })

  test('parses an enum rule row with JSON-encoded choices', async () => {
    const fakeRow: FakeRow = {
      id: 11,
      key: 'cwt.position',
      name: 'CWT 位置',
      description: null,
      type: 'enum',
      value: 'back_center',
      default_value: 'back_center',
      unit: null,
      baseline_min: null,
      baseline_max: null,
      baseline_choices: JSON.stringify(['back_left', 'back_center', 'back_right']),
      category: 'cwt',
      mandatory: 0,
      source: 'industry',
    }
    const loader = new D1RulesLoader(makeFakeD1([fakeRow]))
    const rules = await loader.loadActiveRules()
    const rule = rules[0]
    expect(rule).toBeDefined()
    if (!rule) throw new Error('unreachable')
    expect(rule.type).toBe('enum')
    expect(rule.baseline_choices).toEqual([
      'back_left',
      'back_center',
      'back_right',
    ])
    expect(rule.mandatory).toBe(0)
    expect(rule.source).toBe('industry')
  })

  test('coerces unknown type to enum and mandatory flag safely', async () => {
    const fakeRow: FakeRow = {
      id: 1,
      key: 'test.key',
      name: 'test',
      description: null,
      type: 'string', // not "number" → should become "enum"
      value: 'x',
      default_value: 'x',
      unit: null,
      baseline_min: null,
      baseline_max: null,
      baseline_choices: null,
      category: 'misc',
      mandatory: 5, // not 1 → should become 0
      source: 'cns',
    }
    const loader = new D1RulesLoader(makeFakeD1([fakeRow]))
    const rules = await loader.loadActiveRules()
    const rule = rules[0]
    expect(rule).toBeDefined()
    if (!rule) throw new Error('unreachable')
    expect(rule.type).toBe('enum')
    expect(rule.mandatory).toBe(0)
  })
})

describe('StaticRulesLoader', () => {
  test('loads the baseline rule set', async () => {
    const loader = new StaticRulesLoader()
    const rules = await loader.loadActiveRules()
    expect(rules.length).toBeGreaterThan(0)
    // Must contain the core clearance rule
    expect(rules.find((r) => r.key === 'clearance.front_mm')).toBeDefined()
  })
})

describe('fixtureConfigWithOverride', () => {
  test('applies the override on top of the baseline', () => {
    const config = fixtureConfigWithOverride({ 'clearance.front_mm': '250' })
    expect(config.clearance.front_mm).toBe(250)
  })

  test('empty override equals the default fixture', () => {
    const config = fixtureConfigWithOverride({})
    expect(config.clearance.front_mm).toBe(150) // baseline default
  })
})
