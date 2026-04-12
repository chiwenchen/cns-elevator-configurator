/**
 * Layer 3 integration tests for rules CRUD handlers.
 *
 * Uses InMemoryRulesStore (no real D1) so tests run fast and deterministic.
 * A fresh store is constructed per test.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { InMemoryRulesStore } from '../config/load'
import {
  handleListRules,
  handleListDeletedRules,
  handlePatchRule,
  handleDeleteRule,
  handleRestoreRule,
  handleCommit,
  InvalidRulesBodyError,
  RuleNotFoundError,
  RuleMandatoryError,
  BaselineViolationError,
} from './rules'

let store: InMemoryRulesStore

beforeEach(() => {
  store = new InMemoryRulesStore()
})

describe('handleListRules', () => {
  test('returns 46 rules + 8 categories', async () => {
    const result = await handleListRules(store)
    expect(result.rules).toHaveLength(46)
    expect(result.categories).toHaveLength(8)
  })

  test('categories are sorted by sort_order', async () => {
    const result = await handleListRules(store)
    const orders = result.categories.map(c => c.sort_order)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]!)
    }
  })

  test('rules are sorted by category then key', async () => {
    const result = await handleListRules(store)
    for (let i = 1; i < result.rules.length; i++) {
      const prev = result.rules[i - 1]!
      const curr = result.rules[i]!
      if (prev.category !== curr.category) {
        expect(curr.category > prev.category).toBe(true)
      } else {
        expect(curr.key > prev.key).toBe(true)
      }
    }
  })
})

describe('handleListDeletedRules', () => {
  test('empty initially', async () => {
    const result = await handleListDeletedRules(store)
    expect(result.rules).toHaveLength(0)
  })

  test('shows deleted rules after softDeleteRule', async () => {
    await handleDeleteRule(store, 'cwt.position')
    const result = await handleListDeletedRules(store)
    expect(result.rules).toHaveLength(1)
    expect(result.rules[0]!.key).toBe('cwt.position')
  })
})

describe('handlePatchRule', () => {
  test('updates rule value with valid input', async () => {
    const result = await handlePatchRule(store, 'clearance.side_mm', { value: '250' })
    expect(result.rule.value).toBe('250')

    // Verify persistence
    const listed = await handleListRules(store)
    const clearance = listed.rules.find(r => r.key === 'clearance.side_mm')!
    expect(clearance.value).toBe('250')
  })

  test('rejects value below baseline_min', async () => {
    await expect(
      handlePatchRule(store, 'clearance.side_mm', { value: '50' }),
    ).rejects.toThrow(BaselineViolationError)
  })

  test('rejects value above baseline_max', async () => {
    await expect(
      handlePatchRule(store, 'clearance.side_mm', { value: '999' }),
    ).rejects.toThrow(BaselineViolationError)
  })

  test('rejects non-existent rule key', async () => {
    await expect(
      handlePatchRule(store, 'nonexistent.key', { value: '1' }),
    ).rejects.toThrow(RuleNotFoundError)
  })

  test('rejects invalid body shape', async () => {
    await expect(
      handlePatchRule(store, 'clearance.side_mm', { wrong: 'field' }),
    ).rejects.toThrow(InvalidRulesBodyError)
  })

  test('rejects enum value not in baseline_choices', async () => {
    await expect(
      handlePatchRule(store, 'cwt.position', { value: 'moon_base' }),
    ).rejects.toThrow(BaselineViolationError)
  })

  test('accepts enum value in baseline_choices', async () => {
    const result = await handlePatchRule(store, 'cwt.position', { value: 'back_center' })
    expect(result.rule.value).toBe('back_center')
  })

  test('audit log receives update entry', async () => {
    await handlePatchRule(store, 'clearance.side_mm', { value: '250' })
    const log = store._getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.action).toBe('update')
    expect(log[0]!.rule_key).toBe('clearance.side_mm')
    expect(log[0]!.old_value).toBe('200')
    expect(log[0]!.new_value).toBe('250')
    expect(log[0]!.source).toBe('user')
  })
})

describe('handleDeleteRule', () => {
  test('soft-deletes non-mandatory rule', async () => {
    const result = await handleDeleteRule(store, 'cwt.position')
    expect(result.rule.key).toBe('cwt.position')

    const active = await handleListRules(store)
    expect(active.rules.find(r => r.key === 'cwt.position')).toBeUndefined()
    const deleted = await handleListDeletedRules(store)
    expect(deleted.rules.find(r => r.key === 'cwt.position')).toBeDefined()
  })

  test('rejects mandatory rule with RuleMandatoryError', async () => {
    await expect(
      handleDeleteRule(store, 'clearance.side_mm'), // mandatory=1
    ).rejects.toThrow(RuleMandatoryError)
  })

  test('rejects non-existent rule', async () => {
    await expect(
      handleDeleteRule(store, 'nonexistent.key'),
    ).rejects.toThrow(RuleNotFoundError)
  })

  test('audit log receives delete entry', async () => {
    await handleDeleteRule(store, 'cwt.position')
    const log = store._getAuditLog()
    const deleteEntry = log.find(e => e.action === 'delete')
    expect(deleteEntry).toBeDefined()
    expect(deleteEntry!.rule_key).toBe('cwt.position')
  })
})

describe('handleRestoreRule', () => {
  test('restores a soft-deleted rule', async () => {
    await handleDeleteRule(store, 'cwt.position')
    const result = await handleRestoreRule(store, 'cwt.position')
    expect(result.rule.key).toBe('cwt.position')

    const active = await handleListRules(store)
    expect(active.rules.find(r => r.key === 'cwt.position')).toBeDefined()
    const deleted = await handleListDeletedRules(store)
    expect(deleted.rules).toHaveLength(0)
  })

  test('rejects rule that is not deleted', async () => {
    await expect(handleRestoreRule(store, 'cwt.position')).rejects.toThrow(
      RuleNotFoundError,
    )
  })
})

describe('handleCommit', () => {
  test('applies valid override and writes audit', async () => {
    const result = await handleCommit(store, {
      case_override: { 'clearance.side_mm': '250' },
    })
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0]!.key).toBe('clearance.side_mm')
    expect(result.applied[0]!.old_value).toBe('200')
    expect(result.applied[0]!.new_value).toBe('250')
    expect(result.skipped).toHaveLength(0)

    // Verify persistence
    const listed = await handleListRules(store)
    expect(listed.rules.find(r => r.key === 'clearance.side_mm')!.value).toBe('250')
  })

  test('skips unchanged values', async () => {
    const result = await handleCommit(store, {
      case_override: { 'clearance.side_mm': '200' }, // already 200
    })
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('unchanged')
  })

  test('skips baseline violations', async () => {
    const result = await handleCommit(store, {
      case_override: { 'clearance.side_mm': '50' }, // below min 150
    })
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('baseline_violation')
  })

  test('skips unknown keys', async () => {
    const result = await handleCommit(store, {
      case_override: { 'ghost.rule': '1' },
    })
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('unknown_key')
  })

  test('partial apply — mix of success and skipped', async () => {
    const result = await handleCommit(store, {
      case_override: {
        'clearance.side_mm': '250', // valid
        'clearance.back_mm': '50', // baseline violation
        'ghost.rule': '1', // unknown
        'clearance.front_mm': '150', // unchanged
      },
    })
    expect(result.applied).toHaveLength(1)
    expect(result.skipped).toHaveLength(3)
    const reasons = result.skipped.map(s => s.reason).sort()
    expect(reasons).toEqual(['baseline_violation', 'unchanged', 'unknown_key'])
  })

  test('rejects invalid body shape', async () => {
    await expect(
      handleCommit(store, { no: 'case_override' }),
    ).rejects.toThrow(InvalidRulesBodyError)
  })
})
