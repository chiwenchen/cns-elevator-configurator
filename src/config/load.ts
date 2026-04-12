/**
 * Rules loading layer.
 *
 * Two implementations:
 *   D1RulesLoader     — production Worker, reads from CF D1 binding
 *   StaticRulesLoader — local Bun dev, reads from seeds/generate-baseline.ts
 *                       directly (no DB). Case override still works for
 *                       testing. Rules are loaded once at module init.
 *
 * Both return TeamRule[] which buildEffectiveConfig consumes.
 */

import type {
  TeamRule,
  CaseOverride,
  AuditSource,
  CommitResult,
} from './types'
import { RuleNotFoundError, RuleMandatoryError } from './types'
import { assertValueWithinBaseline, BaselineViolationError } from './effective'
import { buildBaselineRules, type RawRule } from '../../seeds/generate-baseline'

export interface RulesLoader {
  loadActiveRules(): Promise<TeamRule[]>
}

/**
 * Write-capable rules store. Used by rules CRUD handlers.
 */
export interface RulesStore extends RulesLoader {
  listDeleted(): Promise<TeamRule[]>
  updateRuleValue(key: string, value: string, source: AuditSource): Promise<TeamRule>
  softDeleteRule(key: string, source: AuditSource): Promise<TeamRule>
  restoreRule(key: string, source: AuditSource): Promise<TeamRule>
  commitCaseOverride(override: CaseOverride, source: AuditSource): Promise<CommitResult>
}

// ---- D1 loader (production Worker) ----

interface D1Database {
  prepare(query: string): {
    all<T = unknown>(): Promise<{ results: T[] }>
  }
}

interface RawRuleRow {
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

export class D1RulesLoader implements RulesLoader {
  constructor(private readonly db: D1Database) {}

  async loadActiveRules(): Promise<TeamRule[]> {
    const result = await this.db
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE deleted_at IS NULL
         ORDER BY category, key`,
      )
      .all<RawRuleRow>()

    return result.results.map(parseRuleRow)
  }
}

function parseRuleRow(row: RawRuleRow): TeamRule {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.type === 'number' ? 'number' : 'enum',
    value: row.value,
    default_value: row.default_value,
    unit: row.unit,
    baseline_min: row.baseline_min,
    baseline_max: row.baseline_max,
    baseline_choices: row.baseline_choices ? JSON.parse(row.baseline_choices) : null,
    category: row.category,
    mandatory: row.mandatory === 1 ? 1 : 0,
    source: row.source as 'cns' | 'industry' | 'engineering',
  }
}

// ---- Static loader (local Bun dev, tests) ----

export class StaticRulesLoader implements RulesLoader {
  async loadActiveRules(): Promise<TeamRule[]> {
    return buildBaselineRules().map(rawToTeamRule)
  }
}

function rawToTeamRule(raw: RawRule): TeamRule {
  return {
    id: 0,
    key: raw.key,
    name: raw.name,
    description: raw.description,
    type: raw.type,
    value: raw.value,
    default_value: raw.default_value,
    unit: raw.unit,
    baseline_min: raw.baseline_min,
    baseline_max: raw.baseline_max,
    baseline_choices: raw.baseline_choices,
    category: raw.category,
    mandatory: raw.mandatory,
    source: raw.source,
  }
}

// ---- D1 write-capable store ----

interface D1Statement {
  bind(...values: unknown[]): D1Statement
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { last_row_id: number } }>
}

interface D1DatabaseWithWrite {
  prepare(query: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown[]>
}

export class D1RulesStore extends D1RulesLoader implements RulesStore {
  constructor(private readonly writeDb: D1DatabaseWithWrite) {
    super(writeDb as unknown as D1Database)
  }

  async listDeleted(): Promise<TeamRule[]> {
    const result = await this.writeDb
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE deleted_at IS NOT NULL
         ORDER BY category, key`,
      )
      .all<RawRuleRow>()

    return result.results.map(parseRuleRow)
  }

  async updateRuleValue(
    key: string,
    value: string,
    source: AuditSource,
  ): Promise<TeamRule> {
    const rule = await this.findActiveRule(key)
    if (!rule) throw new RuleNotFoundError(key)

    assertValueWithinBaseline(rule, value)

    const now = Math.floor(Date.now() / 1000)
    await this.writeDb.batch([
      this.writeDb
        .prepare(`UPDATE rules SET value = ?, updated_at = ? WHERE key = ?`)
        .bind(value, now, key),
      this.writeDb
        .prepare(
          `INSERT INTO rule_audit
           (rule_id, rule_key, action, old_value, new_value, source, timestamp)
           VALUES (?, ?, 'update', ?, ?, ?, ?)`,
        )
        .bind(rule.id, rule.key, rule.value, value, source, now),
    ])

    return { ...rule, value }
  }

  async softDeleteRule(key: string, source: AuditSource): Promise<TeamRule> {
    const rule = await this.findActiveRule(key)
    if (!rule) throw new RuleNotFoundError(key)
    if (rule.mandatory === 1) throw new RuleMandatoryError(key)

    const now = Math.floor(Date.now() / 1000)
    await this.writeDb.batch([
      this.writeDb
        .prepare(`UPDATE rules SET deleted_at = ?, updated_at = ? WHERE key = ?`)
        .bind(now, now, key),
      this.writeDb
        .prepare(
          `INSERT INTO rule_audit
           (rule_id, rule_key, action, old_value, new_value, source, timestamp)
           VALUES (?, ?, 'delete', ?, NULL, ?, ?)`,
        )
        .bind(rule.id, rule.key, rule.value, source, now),
    ])

    return rule
  }

  async restoreRule(key: string, source: AuditSource): Promise<TeamRule> {
    const result = await this.writeDb
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE key = ? AND deleted_at IS NOT NULL`,
      )
      .bind(key)
      .all<RawRuleRow>()

    if (result.results.length === 0) throw new RuleNotFoundError(key)
    const rule = parseRuleRow(result.results[0]!)

    const now = Math.floor(Date.now() / 1000)
    await this.writeDb.batch([
      this.writeDb
        .prepare(`UPDATE rules SET deleted_at = NULL, updated_at = ? WHERE key = ?`)
        .bind(now, key),
      this.writeDb
        .prepare(
          `INSERT INTO rule_audit
           (rule_id, rule_key, action, old_value, new_value, source, timestamp)
           VALUES (?, ?, 'restore', NULL, ?, ?, ?)`,
        )
        .bind(rule.id, rule.key, rule.value, source, now),
    ])

    return rule
  }

  async commitCaseOverride(
    override: CaseOverride,
    source: AuditSource,
  ): Promise<CommitResult> {
    const rules = await this.loadActiveRules()
    const byKey = new Map(rules.map((r) => [r.key, r]))
    const applied: CommitResult['applied'] = []
    const skipped: CommitResult['skipped'] = []

    for (const [key, newValue] of Object.entries(override)) {
      const rule = byKey.get(key)
      if (!rule) {
        skipped.push({ key, reason: 'unknown_key' })
        continue
      }
      if (newValue === rule.value) {
        skipped.push({ key, reason: 'unchanged' })
        continue
      }
      try {
        assertValueWithinBaseline(rule, newValue)
      } catch (e) {
        if (e instanceof BaselineViolationError) {
          skipped.push({ key, reason: 'baseline_violation' })
          continue
        }
        throw e
      }

      const now = Math.floor(Date.now() / 1000)
      await this.writeDb.batch([
        this.writeDb
          .prepare(`UPDATE rules SET value = ?, updated_at = ? WHERE key = ?`)
          .bind(newValue, now, key),
        this.writeDb
          .prepare(
            `INSERT INTO rule_audit
             (rule_id, rule_key, action, old_value, new_value, source, timestamp)
             VALUES (?, ?, 'update', ?, ?, ?, ?)`,
          )
          .bind(rule.id, rule.key, rule.value, newValue, source, now),
      ])
      applied.push({
        key,
        old_value: rule.value,
        new_value: newValue,
        audit_id: 0, // D1 batch doesn't give us row IDs; acceptable for v1
      })
    }

    return { applied, skipped }
  }

  private async findActiveRule(key: string): Promise<TeamRule | null> {
    const result = await this.writeDb
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE key = ? AND deleted_at IS NULL`,
      )
      .bind(key)
      .all<RawRuleRow>()

    if (result.results.length === 0) return null
    return parseRuleRow(result.results[0]!)
  }
}

// ---- In-memory store (local Bun dev + tests) ----

interface InMemoryRule extends TeamRule {
  deleted_at: number | null
  updated_at: number
}

let nextAuditId = 1

/**
 * Mutable in-memory rules store. Seeded from seeds/generate-baseline.ts.
 * Used by src/demo/server.ts and Layer 3 handler tests.
 *
 * NOT a singleton — each instance has its own state. The demo server holds
 * one singleton; tests create fresh instances per test.
 */
export class InMemoryRulesStore implements RulesStore {
  private rules: Map<string, InMemoryRule>
  private auditLog: Array<{
    id: number
    rule_id: number
    rule_key: string
    action: 'create' | 'update' | 'delete' | 'restore'
    old_value: string | null
    new_value: string | null
    source: AuditSource
    timestamp: number
  }> = []

  constructor() {
    this.rules = new Map()
    const raw = buildBaselineRules()
    let idCounter = 1
    for (const r of raw) {
      const now = Math.floor(Date.now() / 1000)
      this.rules.set(r.key, {
        ...rawToTeamRule(r),
        id: idCounter++,
        deleted_at: null,
        updated_at: now,
      })
    }
  }

  async loadActiveRules(): Promise<TeamRule[]> {
    return Array.from(this.rules.values())
      .filter((r) => r.deleted_at === null)
      .sort((a, b) => {
        if (a.category !== b.category) return a.category < b.category ? -1 : 1
        return a.key < b.key ? -1 : 1
      })
      .map(stripInternalFields)
  }

  async listDeleted(): Promise<TeamRule[]> {
    return Array.from(this.rules.values())
      .filter((r) => r.deleted_at !== null)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map(stripInternalFields)
  }

  async updateRuleValue(
    key: string,
    value: string,
    source: AuditSource,
  ): Promise<TeamRule> {
    const rule = this.rules.get(key)
    if (!rule || rule.deleted_at !== null) throw new RuleNotFoundError(key)
    assertValueWithinBaseline(rule, value)

    const now = Math.floor(Date.now() / 1000)
    const oldValue = rule.value
    rule.value = value
    rule.updated_at = now
    this.auditLog.push({
      id: nextAuditId++,
      rule_id: rule.id,
      rule_key: key,
      action: 'update',
      old_value: oldValue,
      new_value: value,
      source,
      timestamp: now,
    })
    return stripInternalFields(rule)
  }

  async softDeleteRule(key: string, source: AuditSource): Promise<TeamRule> {
    const rule = this.rules.get(key)
    if (!rule || rule.deleted_at !== null) throw new RuleNotFoundError(key)
    if (rule.mandatory === 1) throw new RuleMandatoryError(key)

    const now = Math.floor(Date.now() / 1000)
    rule.deleted_at = now
    rule.updated_at = now
    this.auditLog.push({
      id: nextAuditId++,
      rule_id: rule.id,
      rule_key: key,
      action: 'delete',
      old_value: rule.value,
      new_value: null,
      source,
      timestamp: now,
    })
    return stripInternalFields(rule)
  }

  async restoreRule(key: string, source: AuditSource): Promise<TeamRule> {
    const rule = this.rules.get(key)
    if (!rule || rule.deleted_at === null) throw new RuleNotFoundError(key)

    const now = Math.floor(Date.now() / 1000)
    rule.deleted_at = null
    rule.updated_at = now
    this.auditLog.push({
      id: nextAuditId++,
      rule_id: rule.id,
      rule_key: key,
      action: 'restore',
      old_value: null,
      new_value: rule.value,
      source,
      timestamp: now,
    })
    return stripInternalFields(rule)
  }

  async commitCaseOverride(
    override: CaseOverride,
    source: AuditSource,
  ): Promise<CommitResult> {
    const applied: CommitResult['applied'] = []
    const skipped: CommitResult['skipped'] = []

    for (const [key, newValue] of Object.entries(override)) {
      const rule = this.rules.get(key)
      if (!rule || rule.deleted_at !== null) {
        skipped.push({ key, reason: 'unknown_key' })
        continue
      }
      if (newValue === rule.value) {
        skipped.push({ key, reason: 'unchanged' })
        continue
      }
      try {
        assertValueWithinBaseline(rule, newValue)
      } catch (e) {
        if (e instanceof BaselineViolationError) {
          skipped.push({ key, reason: 'baseline_violation' })
          continue
        }
        throw e
      }

      const now = Math.floor(Date.now() / 1000)
      const oldValue = rule.value
      rule.value = newValue
      rule.updated_at = now
      const auditId = nextAuditId++
      this.auditLog.push({
        id: auditId,
        rule_id: rule.id,
        rule_key: key,
        action: 'update',
        old_value: oldValue,
        new_value: newValue,
        source,
        timestamp: now,
      })
      applied.push({ key, old_value: oldValue, new_value: newValue, audit_id: auditId })
    }

    return { applied, skipped }
  }

  /** Test helper: expose audit log for assertions */
  _getAuditLog() {
    return [...this.auditLog]
  }
}

function stripInternalFields(rule: InMemoryRule): TeamRule {
  const { deleted_at, updated_at, ...publicFields } = rule
  return publicFields
}
