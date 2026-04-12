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

import type { TeamRule } from './types'
import { buildBaselineRules, type RawRule } from '../../seeds/generate-baseline'

export interface RulesLoader {
  loadActiveRules(): Promise<TeamRule[]>
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
