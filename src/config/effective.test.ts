/**
 * Unit tests for buildEffectiveConfig — the three-layer rule merger.
 *
 * Tests operate on fixture TeamRule[] arrays (no D1 access). Covers:
 *   - No override → team defaults used
 *   - Override within baseline → applied
 *   - Override violates baseline min/max/choices → throws BaselineViolationError
 *   - Stale / unknown override key → silently ignored
 *   - Type coercion (number string → number, enum string → literal)
 *   - Structural assembly (per-usage records, nested formula params)
 *   - Missing required rule → throws (seed drift guard)
 */

import { describe, test, expect } from 'bun:test'
import { buildEffectiveConfig, BaselineViolationError } from './effective'
import type { TeamRule, CaseOverride } from './types'

// ---- Fixture helpers ----

function num(
  key: string,
  value: number,
  opts: { min?: number; max?: number; category?: string; mandatory?: 0 | 1; source?: 'cns' | 'industry' | 'engineering' } = {}
): TeamRule {
  return {
    id: 0,
    key,
    name: key,
    description: null,
    type: 'number',
    value: String(value),
    default_value: String(value),
    unit: 'mm',
    baseline_min: opts.min ?? null,
    baseline_max: opts.max ?? null,
    baseline_choices: null,
    category: opts.category ?? 'shaft',
    mandatory: opts.mandatory ?? 0,
    source: opts.source ?? 'engineering',
  }
}

function enumR(
  key: string,
  value: string,
  choices: string[],
  opts: { category?: string; mandatory?: 0 | 1 } = {}
): TeamRule {
  return {
    id: 0,
    key,
    name: key,
    description: null,
    type: 'enum',
    value,
    default_value: value,
    unit: null,
    baseline_min: null,
    baseline_max: null,
    baseline_choices: choices,
    category: opts.category ?? 'cwt',
    mandatory: opts.mandatory ?? 0,
    source: 'engineering',
  }
}

/**
 * Minimal set of rules the config parser requires. In tests we inject via
 * defaultFixtureConfig in src/config/fixtures.ts, but for unit tests we build
 * the minimal set manually to avoid coupling to the generator.
 */
function makeCompleteRuleSet(): TeamRule[] {
  return [
    num('shaft.min_width_mm', 1400, { min: 1400, category: 'shaft', mandatory: 1 }),
    num('shaft.min_depth_mm', 1500, { min: 1500, category: 'shaft', mandatory: 1 }),
    num('clearance.side_mm', 200, { min: 150, max: 400, category: 'clearance', mandatory: 1 }),
    num('clearance.back_mm', 250, { min: 200, max: 400, category: 'clearance', mandatory: 1 }),
    num('clearance.front_mm', 150, { min: 100, max: 300, category: 'clearance', mandatory: 1 }),
    num('car.aspect_ratio.passenger.w', 1.15, { category: 'car' }),
    num('car.aspect_ratio.passenger.d', 1.0, { category: 'car' }),
    num('car.aspect_ratio.accessible.w', 1.0, { category: 'car' }),
    num('car.aspect_ratio.accessible.d', 1.27, { category: 'car' }),
    num('car.aspect_ratio.bed.w', 1.0, { category: 'car' }),
    num('car.aspect_ratio.bed.d', 2.18, { category: 'car' }),
    num('car.aspect_ratio.freight.w', 1.0, { category: 'car' }),
    num('car.aspect_ratio.freight.d', 1.0, { category: 'car' }),
    num('car.height_mm.passenger', 2300, { category: 'car' }),
    num('car.height_mm.accessible', 2300, { category: 'car' }),
    num('car.height_mm.bed', 2400, { category: 'car' }),
    num('car.height_mm.freight', 2200, { category: 'car' }),
    enumR('cwt.position', 'back_left', ['back_left', 'back_center', 'back_right', 'side_left', 'side_right']),
    num('cwt.width_mm', 700, { category: 'cwt' }),
    num('cwt.thickness_mm', 120, { category: 'cwt' }),
    num('cwt.back_offset_mm', 40, { category: 'cwt' }),
    num('cwt.left_offset_mm', 250, { category: 'cwt' }),
    num('rail.car.size_mm', 90, { category: 'rail' }),
    num('rail.car.gap_mm', 30, { category: 'rail' }),
    num('rail.cwt.size_mm', 70, { category: 'rail' }),
    num('rail.cwt.gap_mm', 20, { category: 'rail' }),
    num('door.frame_depth_mm', 100, { category: 'door' }),
    num('door.leaf_thickness_mm', 30, { category: 'door' }),
    num('door.sill_depth_mm', 90, { category: 'door' }),
    num('door.default_width_mm.passenger', 800, { category: 'door' }),
    num('door.default_width_mm.accessible', 900, { category: 'door', mandatory: 1, source: 'cns' }),
    num('door.default_width_mm.bed', 1100, { category: 'door' }),
    num('door.default_width_mm.freight', 1100, { category: 'door' }),
    num('door.type_switch.center_opening_min_car_width_mm', 1400, { category: 'door' }),
    num('height.floor_default_mm', 3000, { category: 'height' }),
    num('height.default_speed_mpm', 60, { category: 'height' }),
    num('height.overhead.refuge_mm', 2000, { category: 'height', mandatory: 1, source: 'cns' }),
    num('height.overhead.machine_buffer_mm', 2000, { category: 'height', mandatory: 1 }),
    num('height.overhead.bounce_coef', 0.035, { category: 'height', mandatory: 1, source: 'cns' }),
    num('height.pit.refuge_mm', 1000, { category: 'height', mandatory: 1, source: 'cns' }),
    num('height.pit.buffer_mm', 500, { category: 'height', mandatory: 1 }),
    num('height.pit.speed_bonus_90mpm_mm', 200, { category: 'height' }),
    num('height.pit.speed_bonus_150mpm_mm', 500, { category: 'height' }),
    num('usage.accessible.min_car_width_mm', 1100, { category: 'usage', mandatory: 1, source: 'cns' }),
    num('usage.accessible.min_car_depth_mm', 1400, { category: 'usage', mandatory: 1, source: 'cns' }),
    num('usage.bed.min_car_depth_mm', 2400, { category: 'usage', mandatory: 1 }),
  ]
}

describe('buildEffectiveConfig — happy path', () => {
  test('no override: final values match team defaults', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {})
    expect(config.clearance.side_mm).toBe(200)
    expect(config.shaft.min_width_mm).toBe(1400)
    expect(config.cwt.position).toBe('back_left')
    expect(config.cwt.left_offset_mm).toBe(250)
    expect(config.rail.cwt_gap_mm).toBe(20)
  })

  test('override within baseline number: applied', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {
      'clearance.side_mm': '250',
    })
    expect(config.clearance.side_mm).toBe(250)
  })

  test('override enum with valid choice: applied', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {
      'cwt.position': 'back_center',
    })
    expect(config.cwt.position).toBe('back_center')
  })

  test('per-usage variants round-trip through config structure', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {})
    expect(config.car.aspect_ratio.passenger).toEqual({ w: 1.15, d: 1.0 })
    expect(config.car.aspect_ratio.accessible).toEqual({ w: 1.0, d: 1.27 })
    expect(config.car.aspect_ratio.bed).toEqual({ w: 1.0, d: 2.18 })
    expect(config.car.aspect_ratio.freight).toEqual({ w: 1.0, d: 1.0 })
    expect(config.car.height_mm.passenger).toBe(2300)
    expect(config.car.height_mm.bed).toBe(2400)
    expect(config.door.default_width_mm.accessible).toBe(900)
  })

  test('formula params round-trip through nested structure', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {})
    expect(config.height.overhead.refuge_mm).toBe(2000)
    expect(config.height.overhead.bounce_coef).toBe(0.035)
    expect(config.height.pit.refuge_mm).toBe(1000)
    expect(config.height.pit.speed_bonus_150mpm_mm).toBe(500)
  })
})

describe('buildEffectiveConfig — baseline violations', () => {
  test('number override below baseline_min throws BaselineViolationError', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'clearance.side_mm': '100' })
    ).toThrow(BaselineViolationError)
  })

  test('number override above baseline_max throws', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'clearance.side_mm': '500' })
    ).toThrow(BaselineViolationError)
  })

  test('number override is not a valid number throws', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'clearance.side_mm': 'hello' })
    ).toThrow(BaselineViolationError)
  })

  test('enum override with invalid choice throws', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'cwt.position': 'moon_base' })
    ).toThrow(BaselineViolationError)
  })

  test('thrown error exposes rule key and reason', () => {
    const rules = makeCompleteRuleSet()
    try {
      buildEffectiveConfig(rules, { 'clearance.side_mm': '50' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BaselineViolationError)
      const e = err as BaselineViolationError
      expect(e.ruleKey).toBe('clearance.side_mm')
      expect(e.attemptedValue).toBe('50')
      expect(e.baseline.min).toBe(150)
      expect(e.baseline.max).toBe(400)
    }
  })
})

describe('buildEffectiveConfig — stale / missing keys', () => {
  test('unknown override key is silently ignored (stale client)', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {
      'deleted.long.ago': '999',
      'clearance.side_mm': '220',
    })
    expect(config.clearance.side_mm).toBe(220)
  })

  test('missing required rule throws (seed drift)', () => {
    const rules = makeCompleteRuleSet().filter(r => r.key !== 'clearance.side_mm')
    expect(() => buildEffectiveConfig(rules, {})).toThrow(/Missing rule: clearance.side_mm/)
  })
})

describe('buildEffectiveConfig — team default already differs from original baseline', () => {
  test('team default within baseline, no override: team default used', () => {
    // Simulate a rule where admin changed clearance.side_mm from 200 (factory) to 230
    const rules = makeCompleteRuleSet()
    const modified = rules.map(r =>
      r.key === 'clearance.side_mm' ? { ...r, value: '230' } : r
    )
    const config = buildEffectiveConfig(modified, {})
    expect(config.clearance.side_mm).toBe(230)
  })

  test('case override wins over team default', () => {
    const rules = makeCompleteRuleSet()
    const modified = rules.map(r =>
      r.key === 'clearance.side_mm' ? { ...r, value: '230' } : r
    )
    const config = buildEffectiveConfig(modified, { 'clearance.side_mm': '280' })
    expect(config.clearance.side_mm).toBe(280)
  })
})

describe('BaselineViolationError class', () => {
  test('instanceof Error', () => {
    const e = new BaselineViolationError('test.key', '99', 'too low', { min: 100, max: 500 })
    expect(e).toBeInstanceOf(Error)
  })

  test('has name property', () => {
    const e = new BaselineViolationError('test.key', '99', 'too low', {})
    expect(e.name).toBe('BaselineViolationError')
  })
})
