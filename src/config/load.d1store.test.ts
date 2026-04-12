/**
 * Tests for D1RulesStore — the production D1-backed write store.
 *
 * Uses a fake D1 binding that records prepared SQL and bind values,
 * and serves row results from an in-memory map keyed by rule key.
 *
 * These tests assert the SQL shape (UPDATE / INSERT audit) and the
 * error paths that only D1RulesStore exercises (InMemoryRulesStore
 * has its own tests via the handler integration layer).
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { D1RulesStore } from './load'
import {
  RuleNotFoundError,
  RuleMandatoryError,
} from './types'

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
  deleted_at: number | null
}

function makeRow(partial: Partial<FakeRow> & { key: string; value: string }): FakeRow {
  const base: FakeRow = {
    id: 1,
    key: partial.key,
    name: partial.key,
    description: null,
    type: 'number',
    value: partial.value,
    default_value: partial.value,
    unit: 'mm',
    baseline_min: 0,
    baseline_max: 1000,
    baseline_choices: null,
    category: 'clearance',
    mandatory: 0,
    source: 'industry',
    deleted_at: null,
  }
  return { ...base, ...partial }
}

/**
 * Fake D1 database that understands the specific SQL statements
 * D1RulesStore issues. This is intentionally minimal — enough to
 * exercise the happy + error paths.
 */
class FakeD1 {
  rows: FakeRow[]
  audit: Array<{
    rule_id: number
    rule_key: string
    action: string
    old_value: string | null
    new_value: string | null
    source: string
    timestamp: number
  }> = []

  constructor(rows: FakeRow[]) {
    this.rows = rows
  }

  prepare(query: string) {
    // Store a closure over query; the bind()/all()/run() interplay
    // defers result selection until execution.
    const db = this
    let bindings: unknown[] = []
    const stmt = {
      bind(...values: unknown[]) {
        bindings = values
        return stmt
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        return { results: db.runSelect(query, bindings) as T[] }
      },
      async run(): Promise<{ meta: { last_row_id: number } }> {
        db.runMutation(query, bindings)
        return { meta: { last_row_id: 0 } }
      },
      _query: query,
      _getBindings: () => bindings,
    }
    return stmt as unknown as {
      bind(...values: unknown[]): typeof stmt
      all<T = unknown>(): Promise<{ results: T[] }>
      run(): Promise<{ meta: { last_row_id: number } }>
    }
  }

  async batch(statements: Array<{ _query: string; _getBindings: () => unknown[] }>) {
    for (const s of statements) {
      this.runMutation(s._query, s._getBindings())
    }
    return []
  }

  private runSelect(query: string, bindings: unknown[]): unknown[] {
    // loadActiveRules: WHERE deleted_at IS NULL
    if (query.includes('WHERE deleted_at IS NULL')) {
      return this.rows.filter((r) => r.deleted_at === null)
    }
    // listDeleted: WHERE deleted_at IS NOT NULL
    if (query.includes('WHERE deleted_at IS NOT NULL')) {
      return this.rows.filter((r) => r.deleted_at !== null)
    }
    // findActiveRule / restoreRule lookup: WHERE key = ? AND deleted_at IS NULL/NOT NULL
    if (query.includes('WHERE key = ? AND deleted_at IS NOT NULL')) {
      const key = bindings[0] as string
      return this.rows.filter((r) => r.key === key && r.deleted_at !== null)
    }
    if (query.includes('WHERE key = ? AND deleted_at IS NULL')) {
      const key = bindings[0] as string
      return this.rows.filter((r) => r.key === key && r.deleted_at === null)
    }
    return []
  }

  private runMutation(query: string, bindings: unknown[]): void {
    if (query.startsWith('UPDATE rules SET value = ?')) {
      const [value, _updatedAt, key] = bindings as [string, number, string]
      const row = this.rows.find((r) => r.key === key)
      if (row) row.value = value
      return
    }
    if (query.startsWith('UPDATE rules SET deleted_at = ?, updated_at = ?')) {
      const [deletedAt, _updatedAt, key] = bindings as [number, number, string]
      const row = this.rows.find((r) => r.key === key)
      if (row) row.deleted_at = deletedAt
      return
    }
    if (query.startsWith('UPDATE rules SET deleted_at = NULL')) {
      const [_updatedAt, key] = bindings as [number, string]
      const row = this.rows.find((r) => r.key === key)
      if (row) row.deleted_at = null
      return
    }
    if (query.startsWith('INSERT INTO rule_audit')) {
      // The SQL varies per action:
      //   update:  VALUES (?, ?, 'update', ?, ?, ?, ?)   — 6 binds
      //   delete:  VALUES (?, ?, 'delete', ?, NULL, ?, ?) — 5 binds (new_value hardcoded NULL)
      //   restore: VALUES (?, ?, 'restore', NULL, ?, ?, ?) — 5 binds (old_value hardcoded NULL)
      const match = query.match(/'(update|delete|restore|create)'/)
      const action = match ? match[1]! : 'unknown'
      let rule_id: number, rule_key: string
      let old_value: string | null, new_value: string | null
      let source: string, timestamp: number
      if (action === 'update') {
        ;[rule_id, rule_key, old_value, new_value, source, timestamp] =
          bindings as [number, string, string, string, string, number]
      } else if (action === 'delete') {
        ;[rule_id, rule_key, old_value, source, timestamp] = bindings as [
          number,
          string,
          string,
          string,
          number,
        ]
        new_value = null
      } else if (action === 'restore') {
        ;[rule_id, rule_key, new_value, source, timestamp] = bindings as [
          number,
          string,
          string,
          string,
          number,
        ]
        old_value = null
      } else {
        return
      }
      this.audit.push({
        rule_id,
        rule_key,
        action,
        old_value,
        new_value,
        source,
        timestamp,
      })
      return
    }
  }
}

let db: FakeD1
let store: D1RulesStore

beforeEach(() => {
  db = new FakeD1([
    makeRow({ key: 'clearance.side_mm', value: '200', id: 1, mandatory: 1 }),
    makeRow({
      key: 'cwt.position',
      value: 'back_center',
      id: 2,
      mandatory: 0,
      type: 'enum',
      baseline_min: null,
      baseline_max: null,
      baseline_choices: JSON.stringify(['back_left', 'back_center', 'back_right']),
      category: 'cwt',
    }),
    makeRow({
      key: 'clearance.front_mm',
      value: '150',
      id: 3,
      mandatory: 0,
      baseline_min: 100,
      baseline_max: 300,
    }),
  ])
  store = new D1RulesStore(db as unknown as ConstructorParameters<typeof D1RulesStore>[0])
})

describe('D1RulesStore.loadActiveRules', () => {
  test('returns all rows with deleted_at IS NULL', async () => {
    const rules = await store.loadActiveRules()
    expect(rules).toHaveLength(3)
    expect(rules.map((r) => r.key)).toEqual([
      'clearance.side_mm',
      'cwt.position',
      'clearance.front_mm',
    ])
  })

  test('hides soft-deleted rows', async () => {
    db.rows[2]!.deleted_at = 100 // soft-delete clearance.front_mm
    const rules = await store.loadActiveRules()
    expect(rules).toHaveLength(2)
    expect(rules.find((r) => r.key === 'clearance.front_mm')).toBeUndefined()
  })
})

describe('D1RulesStore.listDeleted', () => {
  test('empty when none deleted', async () => {
    const deleted = await store.listDeleted()
    expect(deleted).toHaveLength(0)
  })

  test('returns soft-deleted rows only', async () => {
    db.rows[1]!.deleted_at = 123
    const deleted = await store.listDeleted()
    expect(deleted).toHaveLength(1)
    expect(deleted[0]!.key).toBe('cwt.position')
  })
})

describe('D1RulesStore.updateRuleValue', () => {
  test('updates value + writes audit row', async () => {
    const updated = await store.updateRuleValue('clearance.front_mm', '250', 'user')
    expect(updated.value).toBe('250')
    expect(db.rows.find((r) => r.key === 'clearance.front_mm')!.value).toBe('250')
    const audit = db.audit.find((a) => a.rule_key === 'clearance.front_mm')
    expect(audit).toBeDefined()
    expect(audit!.action).toBe('update')
    expect(audit!.old_value).toBe('150')
    expect(audit!.new_value).toBe('250')
    expect(audit!.source).toBe('user')
  })

  test('throws RuleNotFoundError for unknown key', async () => {
    await expect(store.updateRuleValue('nope.key', '1', 'user')).rejects.toBeInstanceOf(
      RuleNotFoundError,
    )
  })

  test('throws RuleNotFoundError for soft-deleted rule', async () => {
    db.rows[2]!.deleted_at = 99
    await expect(
      store.updateRuleValue('clearance.front_mm', '250', 'user'),
    ).rejects.toBeInstanceOf(RuleNotFoundError)
  })

  test('throws on baseline violation', async () => {
    await expect(
      store.updateRuleValue('clearance.front_mm', '50', 'user'),
    ).rejects.toThrow(/baseline/i)
  })
})

describe('D1RulesStore.softDeleteRule', () => {
  test('marks row deleted + writes audit row', async () => {
    const rule = await store.softDeleteRule('cwt.position', 'user')
    expect(rule.key).toBe('cwt.position')
    expect(db.rows.find((r) => r.key === 'cwt.position')!.deleted_at).not.toBeNull()
    const audit = db.audit.find((a) => a.rule_key === 'cwt.position')
    expect(audit).toBeDefined()
    expect(audit!.action).toBe('delete')
    expect(audit!.new_value).toBeNull()
  })

  test('throws RuleMandatoryError for mandatory rule', async () => {
    await expect(store.softDeleteRule('clearance.side_mm', 'user')).rejects.toBeInstanceOf(
      RuleMandatoryError,
    )
  })

  test('throws RuleNotFoundError for unknown key', async () => {
    await expect(store.softDeleteRule('nope.key', 'user')).rejects.toBeInstanceOf(
      RuleNotFoundError,
    )
  })
})

describe('D1RulesStore.restoreRule', () => {
  test('clears deleted_at + writes audit row', async () => {
    db.rows[1]!.deleted_at = 999
    const restored = await store.restoreRule('cwt.position', 'user')
    expect(restored.key).toBe('cwt.position')
    expect(db.rows.find((r) => r.key === 'cwt.position')!.deleted_at).toBeNull()
    const audit = db.audit.find((a) => a.rule_key === 'cwt.position')
    expect(audit).toBeDefined()
    expect(audit!.action).toBe('restore')
  })

  test('throws RuleNotFoundError when no deleted row exists', async () => {
    await expect(store.restoreRule('cwt.position', 'user')).rejects.toBeInstanceOf(
      RuleNotFoundError,
    )
  })
})

describe('D1RulesStore.commitCaseOverride', () => {
  test('applies valid overrides, skips unknown/unchanged/violation', async () => {
    const result = await store.commitCaseOverride(
      {
        'clearance.front_mm': '250', // applied
        'clearance.side_mm': '200', // unchanged (current value is 200)
        'nope.key': 'x', // unknown_key
        'cwt.position': 'back_center', // unchanged
      },
      'user',
    )
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0]!.key).toBe('clearance.front_mm')
    expect(result.applied[0]!.old_value).toBe('150')
    expect(result.applied[0]!.new_value).toBe('250')
    expect(result.skipped).toHaveLength(3)
    const reasons = result.skipped.map((s) => s.reason).sort()
    expect(reasons).toEqual(['unchanged', 'unchanged', 'unknown_key'])
  })

  test('skips baseline_violation without throwing', async () => {
    const result = await store.commitCaseOverride(
      { 'clearance.front_mm': '50' }, // below baseline_min=100
      'user',
    )
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('baseline_violation')
  })

  test('empty override → both arrays empty', async () => {
    const result = await store.commitCaseOverride({}, 'user')
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })
})
