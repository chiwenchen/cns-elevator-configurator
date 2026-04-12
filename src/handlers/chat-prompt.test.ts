import { describe, test, expect } from 'bun:test'
import { formatCompactRulesDump, buildDynamicContext, buildSystemPrompt, SYSTEM_PROMPT_VERSION } from './chat-prompt'
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
    expect(dump).toContain('clearance.side_mm | num | 200 | 150-400mm | eng | 1 | 車廂側向間隙')
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
    expect(dump).toContain('| 900-mm |')
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
    const ctx = buildDynamicContext(rules, solverInput, caseOverride)
    expect(ctx).toContain('clearance.side_mm | num | 200')
    expect(ctx).toContain('CASE INPUT')
    expect(ctx).toContain('rated_load_kg')
    expect(ctx).toContain('CURRENT CASE OVERRIDE')
    expect(ctx).toContain('clearance.side_mm = 250')
  })

  test('shows empty override when none set', () => {
    const rules = [makeRule()]
    const ctx = buildDynamicContext(rules, { mode: 'A' }, {})
    expect(ctx).toContain('(none)')
  })
})

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt()

  test('contains role definition', () => {
    expect(prompt).toContain('角色')
  })

  test('contains limitations section', () => {
    expect(prompt).toContain('限制')
    expect(prompt).toContain('不可提議超出 baseline 範圍')
  })

  test('contains rule schema columns', () => {
    expect(prompt).toContain('規則 schema 欄位說明')
    expect(prompt).toContain('key')
    expect(prompt).toContain('type')
    expect(prompt).toContain('value')
    expect(prompt).toContain('src')
    expect(prompt).toContain('mand')
  })

  test('contains safety tiers (cns/industry/engineering)', () => {
    expect(prompt).toContain('安全層級')
    expect(prompt).toContain('cns')
    expect(prompt).toContain('ind')
    expect(prompt).toContain('eng')
  })

  test('contains mandatory explanation', () => {
    expect(prompt).toContain('必要')
  })

  test('contains actions (4 tools)', () => {
    expect(prompt).toContain('動作')
    expect(prompt).toContain('propose_update')
    expect(prompt).toContain('propose_soft_delete')
    expect(prompt).toContain('ask_clarification')
    expect(prompt).toContain('out_of_scope')
  })

  test('contains limitations', () => {
    expect(prompt).toContain('不可提議超出 baseline 範圍')
    expect(prompt).toContain('不可提議刪除 mandatory=1')
    expect(prompt).toContain('不可建立新的規則 key')
  })

  test('instructs to use Chinese rule names, not keys', () => {
    expect(prompt).toContain('中文名稱')
    expect(prompt).toContain('name 欄位')
  })

  test('specifies Traditional Chinese as response language', () => {
    expect(prompt).toContain('繁體中文')
  })

  test('embeds SYSTEM_PROMPT_VERSION', () => {
    expect(prompt).toContain(SYSTEM_PROMPT_VERSION)
  })
})

describe('SYSTEM_PROMPT_VERSION', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT_VERSION).toBe('string')
    expect(SYSTEM_PROMPT_VERSION.length).toBeGreaterThan(0)
  })
})
