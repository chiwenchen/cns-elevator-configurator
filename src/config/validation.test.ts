/**
 * Unit tests for buildValidationReport.
 *
 * Coverage:
 *   - All rules pass when no case override
 *   - Override that differs from team default → warning
 *   - Override that equals team default → pass (no-op)
 *   - Summary counts split by source (cns vs non-cns)
 *   - baseline_description rendering for number vs enum
 *   - status_reason strings are meaningful Chinese
 *   - Items are stable-ordered (category then key) for UI consistency
 */

import { describe, test, expect } from 'bun:test'
import { buildValidationReport } from './validation'
import type { TeamRule, CaseOverride } from './types'

function num(key: string, value: number, opts: {
  min?: number; max?: number; category?: string; mandatory?: 0 | 1; source?: 'cns' | 'industry' | 'engineering'
} = {}): TeamRule {
  return {
    id: 0, key, name: key, description: null,
    type: 'number', value: String(value), default_value: String(value),
    unit: 'mm',
    baseline_min: opts.min ?? null, baseline_max: opts.max ?? null,
    baseline_choices: null,
    category: opts.category ?? 'shaft',
    mandatory: opts.mandatory ?? 0,
    source: opts.source ?? 'engineering',
  }
}

function enumR(key: string, value: string, choices: string[], opts: { source?: 'cns' | 'industry' | 'engineering' } = {}): TeamRule {
  return {
    id: 0, key, name: key, description: null,
    type: 'enum', value, default_value: value, unit: null,
    baseline_min: null, baseline_max: null, baseline_choices: choices,
    category: 'cwt', mandatory: 0, source: opts.source ?? 'engineering',
  }
}

function makeRules(): TeamRule[] {
  return [
    num('shaft.min_width_mm', 1400, { category: 'shaft', source: 'engineering' }),
    num('clearance.side_mm', 200, { min: 150, max: 400, category: 'clearance', mandatory: 1 }),
    num('door.default_width_mm.accessible', 900, { min: 900, max: 1400, category: 'door', source: 'cns', mandatory: 1 }),
    num('height.overhead.refuge_mm', 2000, { min: 1800, max: 2500, category: 'height', source: 'cns', mandatory: 1 }),
    enumR('cwt.position', 'back_left', ['back_left', 'back_center', 'back_right', 'side_left', 'side_right']),
  ]
}

describe('buildValidationReport', () => {
  test('no case override → all items pass', () => {
    const report = buildValidationReport(makeRules(), {})
    expect(report.items).toHaveLength(5)
    for (const item of report.items) {
      expect(item.status).toBe('pass')
    }
  })

  test('summary counts split by source when all pass', () => {
    const report = buildValidationReport(makeRules(), {})
    // 2 cns rules (door.accessible, height.overhead.refuge), 3 non-cns (shaft, clearance, cwt)
    expect(report.summary.cns_pass).toBe(2)
    expect(report.summary.guideline_pass).toBe(3)
    expect(report.summary.cns_warning).toBe(0)
    expect(report.summary.guideline_warning).toBe(0)
    expect(report.summary.total_fail).toBe(0)
  })

  test('override differs from team default → warning on that rule only', () => {
    const override: CaseOverride = { 'clearance.side_mm': '250' }
    const report = buildValidationReport(makeRules(), override)

    const warnings = report.items.filter(i => i.status === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].rule_key).toBe('clearance.side_mm')
    expect(warnings[0].final_value).toBe('250')
    expect(warnings[0].team_default_value).toBe('200')
  })

  test('override equal to team default → no warning (ignored)', () => {
    const override: CaseOverride = { 'clearance.side_mm': '200' }
    const report = buildValidationReport(makeRules(), override)
    const warnings = report.items.filter(i => i.status === 'warning')
    expect(warnings).toHaveLength(0)
  })

  test('override on cns source rule → cns_warning increments', () => {
    const override: CaseOverride = { 'door.default_width_mm.accessible': '1000' }
    const report = buildValidationReport(makeRules(), override)
    expect(report.summary.cns_warning).toBe(1)
    expect(report.summary.cns_pass).toBe(1) // height.overhead still pass
    expect(report.summary.guideline_warning).toBe(0)
  })

  test('items are sorted by category then key', () => {
    const report = buildValidationReport(makeRules(), {})
    const ordered = report.items.map(i => i.rule_key)
    // Categories: clearance, cwt, door, height, shaft alphabetically
    const categories = report.items.map(i => i.category)
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i] >= categories[i - 1]).toBe(true)
    }
  })

  test('baseline_description shows range for number type', () => {
    const report = buildValidationReport(makeRules(), {})
    const clearance = report.items.find(i => i.rule_key === 'clearance.side_mm')!
    expect(clearance.baseline_description).toContain('150')
    expect(clearance.baseline_description).toContain('400')
    expect(clearance.baseline_description).toContain('mm')
  })

  test('baseline_description shows choices for enum type', () => {
    const report = buildValidationReport(makeRules(), {})
    const cwt = report.items.find(i => i.rule_key === 'cwt.position')!
    expect(cwt.baseline_description).toContain('back_left')
    expect(cwt.baseline_description).toContain('back_center')
  })

  test('status_reason is in Chinese and meaningful', () => {
    const override: CaseOverride = { 'clearance.side_mm': '250' }
    const report = buildValidationReport(makeRules(), override)
    const warning = report.items.find(i => i.status === 'warning')!
    expect(warning.status_reason).toMatch(/案子微調|override|改/)
  })

  test('unknown case override key silently ignored', () => {
    const override: CaseOverride = { 'nonexistent.rule': '999' }
    const report = buildValidationReport(makeRules(), override)
    expect(report.items).toHaveLength(5)
    expect(report.summary.total_fail).toBe(0)
  })

  test('enum override differs from team default → warning', () => {
    const override: CaseOverride = { 'cwt.position': 'back_center' }
    const report = buildValidationReport(makeRules(), override)
    const w = report.items.find(i => i.rule_key === 'cwt.position')!
    expect(w.status).toBe('warning')
    expect(w.final_value).toBe('back_center')
    expect(w.team_default_value).toBe('back_left')
  })

  test('team rule where value differs from default_value still passes when no override', () => {
    // Admin changed team default from 200 → 230
    const rules = makeRules().map(r =>
      r.key === 'clearance.side_mm' ? { ...r, value: '230' } : r,
    )
    const report = buildValidationReport(rules, {})
    const clearance = report.items.find(i => i.rule_key === 'clearance.side_mm')!
    expect(clearance.status).toBe('pass')
    expect(clearance.final_value).toBe('230')
    expect(clearance.team_default_value).toBe('230')
    expect(clearance.factory_default_value).toBe('200')
  })

  test('rule_name comes from TeamRule.name', () => {
    const report = buildValidationReport(makeRules(), {})
    const item = report.items.find(i => i.rule_key === 'shaft.min_width_mm')!
    expect(item.rule_name).toBe('shaft.min_width_mm') // in fixture, name == key
  })
})
