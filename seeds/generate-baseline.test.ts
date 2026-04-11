/**
 * Tests for the baseline rule generator.
 *
 * Scope:
 *   - Structural sanity (counts, uniqueness, category validity)
 *   - Type-specific constraints (number has min/max, enum has choices)
 *   - Specific spec-mandated rules are present
 *
 * Run: bun test seeds/generate-baseline.test.ts
 */

import { describe, test, expect } from 'bun:test'
import { buildBaselineRules, toInsertSql } from './generate-baseline'

const KNOWN_CATEGORIES = new Set([
  'shaft', 'clearance', 'car', 'cwt', 'rail', 'door', 'height', 'usage',
])
const KNOWN_SOURCES = new Set(['cns', 'industry', 'engineering'])
const KNOWN_TYPES = new Set(['number', 'enum'])

describe('buildBaselineRules — structural', () => {
  test('returns exactly 44 rules', () => {
    const rules = buildBaselineRules()
    expect(rules).toHaveLength(44)
  })

  test('all rule keys are unique', () => {
    const keys = buildBaselineRules().map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('all rules have a known category', () => {
    for (const rule of buildBaselineRules()) {
      expect(KNOWN_CATEGORIES.has(rule.category)).toBe(true)
    }
  })

  test('all rules have a known source', () => {
    for (const rule of buildBaselineRules()) {
      expect(KNOWN_SOURCES.has(rule.source)).toBe(true)
    }
  })

  test('all rules have a known type', () => {
    for (const rule of buildBaselineRules()) {
      expect(KNOWN_TYPES.has(rule.type)).toBe(true)
    }
  })

  test('mandatory flag is 0 or 1', () => {
    for (const rule of buildBaselineRules()) {
      expect([0, 1]).toContain(rule.mandatory)
    }
  })

  test('every rule has name and description', () => {
    for (const rule of buildBaselineRules()) {
      expect(rule.name.length).toBeGreaterThan(0)
      expect(rule.description).toBeDefined()
    }
  })
})

describe('buildBaselineRules — type-specific', () => {
  test('number rules have numeric baseline_min/max when set, or null', () => {
    for (const rule of buildBaselineRules()) {
      if (rule.type !== 'number') continue
      if (rule.baseline_min !== null) {
        expect(typeof rule.baseline_min).toBe('number')
      }
      if (rule.baseline_max !== null) {
        expect(typeof rule.baseline_max).toBe('number')
      }
    }
  })

  test('number rules have parseable value and default_value', () => {
    for (const rule of buildBaselineRules()) {
      if (rule.type !== 'number') continue
      expect(Number.isFinite(parseFloat(rule.value))).toBe(true)
      expect(Number.isFinite(parseFloat(rule.default_value))).toBe(true)
    }
  })

  test('number rules value respects baseline_min/max', () => {
    for (const rule of buildBaselineRules()) {
      if (rule.type !== 'number') continue
      const n = parseFloat(rule.value)
      if (rule.baseline_min !== null) expect(n).toBeGreaterThanOrEqual(rule.baseline_min)
      if (rule.baseline_max !== null) expect(n).toBeLessThanOrEqual(rule.baseline_max)
    }
  })

  test('enum rules have non-empty baseline_choices array', () => {
    for (const rule of buildBaselineRules()) {
      if (rule.type !== 'enum') continue
      expect(rule.baseline_choices).not.toBeNull()
      expect(Array.isArray(rule.baseline_choices)).toBe(true)
      expect(rule.baseline_choices!.length).toBeGreaterThan(0)
    }
  })

  test('enum rules value is one of baseline_choices', () => {
    for (const rule of buildBaselineRules()) {
      if (rule.type !== 'enum') continue
      expect(rule.baseline_choices).toContain(rule.value)
    }
  })
})

describe('buildBaselineRules — specific spec rules present', () => {
  const byKey = () => {
    const m = new Map<string, ReturnType<typeof buildBaselineRules>[0]>()
    for (const r of buildBaselineRules()) m.set(r.key, r)
    return m
  }

  test('clearance.side_mm exists with value 200, baseline 150-400, mandatory, engineering', () => {
    const r = byKey().get('clearance.side_mm')!
    expect(r).toBeDefined()
    expect(r.type).toBe('number')
    expect(r.value).toBe('200')
    expect(r.baseline_min).toBe(150)
    expect(r.baseline_max).toBe(400)
    expect(r.mandatory).toBe(1)
    expect(r.source).toBe('engineering')
  })

  test('cwt.position exists as enum with back_left default', () => {
    const r = byKey().get('cwt.position')!
    expect(r).toBeDefined()
    expect(r.type).toBe('enum')
    expect(r.value).toBe('back_left')
    expect(r.baseline_choices).toEqual([
      'back_left', 'back_center', 'back_right', 'side_left', 'side_right',
    ])
    expect(r.mandatory).toBe(0)
  })

  test('door.default_width_mm.accessible exists, 900, mandatory, cns', () => {
    const r = byKey().get('door.default_width_mm.accessible')!
    expect(r).toBeDefined()
    expect(r.value).toBe('900')
    expect(r.baseline_min).toBe(900)
    expect(r.mandatory).toBe(1)
    expect(r.source).toBe('cns')
  })

  test('height.overhead.bounce_coef exists, 0.035, mandatory, cns', () => {
    const r = byKey().get('height.overhead.bounce_coef')!
    expect(r).toBeDefined()
    expect(r.value).toBe('0.035')
    expect(r.mandatory).toBe(1)
    expect(r.source).toBe('cns')
    expect(r.unit).toBeNull()
  })

  test('shaft.min_width_mm and shaft.min_depth_mm exist', () => {
    const map = byKey()
    expect(map.get('shaft.min_width_mm')!.value).toBe('1400')
    expect(map.get('shaft.min_depth_mm')!.value).toBe('1500')
  })

  test('car aspect ratio rules have no unit', () => {
    const map = byKey()
    const ratioKeys = [
      'car.aspect_ratio.passenger.w',
      'car.aspect_ratio.passenger.d',
      'car.aspect_ratio.accessible.w',
      'car.aspect_ratio.accessible.d',
      'car.aspect_ratio.bed.w',
      'car.aspect_ratio.bed.d',
      'car.aspect_ratio.freight.w',
      'car.aspect_ratio.freight.d',
    ]
    for (const key of ratioKeys) {
      const r = map.get(key)
      expect(r).toBeDefined()
      expect(r!.unit).toBeNull()
    }
  })

  test('usage.accessible.min_car_width_mm is 1100, cns, mandatory', () => {
    const r = byKey().get('usage.accessible.min_car_width_mm')!
    expect(r.value).toBe('1100')
    expect(r.source).toBe('cns')
    expect(r.mandatory).toBe(1)
  })
})

describe('toInsertSql', () => {
  test('produces a single INSERT INTO rules statement', () => {
    const sql = toInsertSql(buildBaselineRules())
    expect(sql).toContain('INSERT INTO rules')
    expect(sql).toContain('VALUES')
    // Should end with a semicolon
    expect(sql.trimEnd().endsWith(';')).toBe(true)
  })

  test('escapes single quotes in text fields', () => {
    const fakeRule = {
      key: 'test.key',
      name: "it's ok",
      description: null,
      type: 'number' as const,
      value: '1',
      default_value: '1',
      unit: 'mm',
      baseline_min: null,
      baseline_max: null,
      baseline_choices: null,
      category: 'shaft',
      mandatory: 0 as const,
      source: 'engineering' as const,
    }
    const sql = toInsertSql([fakeRule])
    expect(sql).toContain("'it''s ok'")
  })

  test('serializes baseline_choices as JSON string', () => {
    const rules = buildBaselineRules().filter(r => r.type === 'enum')
    expect(rules.length).toBeGreaterThan(0)
    const sql = toInsertSql(rules)
    // JSON array should appear as a quoted string
    expect(sql).toMatch(/'\[.*\]'/)
  })

  test('emits NULL for null columns', () => {
    const fakeRule = {
      key: 'test.null',
      name: 'x',
      description: null,
      type: 'number' as const,
      value: '1',
      default_value: '1',
      unit: null,
      baseline_min: null,
      baseline_max: null,
      baseline_choices: null,
      category: 'shaft',
      mandatory: 0 as const,
      source: 'engineering' as const,
    }
    const sql = toInsertSql([fakeRule])
    // unit, baseline_min, baseline_max, baseline_choices, description all null
    expect(sql).toContain('NULL')
  })
})
