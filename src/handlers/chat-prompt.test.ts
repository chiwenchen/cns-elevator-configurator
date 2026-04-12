import { describe, test, expect } from 'bun:test'
import { formatCompactRulesDump, buildDynamicContext, SYSTEM_PROMPT_VERSION } from './chat-prompt'
import type { TeamRule } from '../config/types'

const makeRule = (overrides: Partial<TeamRule> = {}): TeamRule => ({
  id: 1,
  key: 'clearance.side_mm',
  name: '車廂側向間隙',
  description: null,
  type: 'number',
  value: '200',
  default_value: '200',
  unit: 'mm',
  baseline_min: 150,
  baseline_max: 400,
  baseline_choices: null,
  category: 'clearance',
  mandatory: 1,
  source: 'engineering',
  ...overrides,
})

describe('formatCompactRulesDump', () => {
  test('formats a number rule as single-line compact string', () => {
    const rules = [makeRule()]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('RULES (key | type | value | min-max/choices | src | mand | name)')
    expect(dump).toContain('clearance.side_mm | num | 200 | 150-400 mm | eng | 1 | 車廂側向間隙')
  })

  test('formats an enum rule with choices', () => {
    const rules = [makeRule({
      key: 'cwt.position',
      name: '配重位置',
      type: 'enum',
      value: 'back_left',
      default_value: 'back_left',
      unit: null,
      baseline_min: null,
      baseline_max: null,
      baseline_choices: ['back_left', 'back_center', 'back_right', 'side_left', 'side_right'],
      mandatory: 0,
      source: 'engineering',
    })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('cwt.position | enum | back_left | [back_left,back_center,back_right,side_left,side_right] | eng | 0 | 配重位置')
  })

  test('formats CNS source as cns', () => {
    const rules = [makeRule({ source: 'cns' })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| cns |')
  })

  test('formats industry source as ind', () => {
    const rules = [makeRule({ source: 'industry' })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| ind |')
  })

  test('formats number rule with only min bound', () => {
    const rules = [makeRule({ baseline_min: 900, baseline_max: null, unit: 'mm' })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| 900- mm |')
  })

  test('formats number rule with no bounds', () => {
    const rules = [makeRule({ baseline_min: null, baseline_max: null, unit: null })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| - |')
  })
})

describe('buildDynamicContext', () => {
  test('assembles rules dump + case context + override state', () => {
    const rules = [makeRule()]
    const solverInput = { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' }
    const caseOverride = { 'clearance.side_mm': '250' }
    const chatHistory = [
      { role: 'user' as const, content: '側向間隙加大', timestamp: 1000 },
    ]
    const ctx = buildDynamicContext(rules, solverInput, caseOverride, chatHistory)
    expect(ctx).toContain('clearance.side_mm | num | 200')
    expect(ctx).toContain('CASE INPUT')
    expect(ctx).toContain('rated_load_kg')
    expect(ctx).toContain('CURRENT CASE OVERRIDE')
    expect(ctx).toContain('clearance.side_mm = 250')
  })

  test('shows empty override when none set', () => {
    const rules = [makeRule()]
    const ctx = buildDynamicContext(rules, { mode: 'A' }, {}, [])
    expect(ctx).toContain('(none)')
  })
})

describe('SYSTEM_PROMPT_VERSION', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT_VERSION).toBe('string')
    expect(SYSTEM_PROMPT_VERSION.length).toBeGreaterThan(0)
  })
})
