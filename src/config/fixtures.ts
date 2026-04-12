/**
 * Test fixture: default EffectiveConfig derived from seeds/generate-baseline.ts.
 *
 * This is NOT the runtime config path — production /api/solve reads from D1.
 * This is a test helper so solver + handler tests can inject a known config
 * without needing a real D1 connection.
 *
 * Since it routes through buildEffectiveConfig with the real generator output,
 * it automatically stays in sync with D1 seeds. If the generator adds/removes
 * rules, this fixture reflects it.
 */

import { buildBaselineRules, type RawRule } from '../../seeds/generate-baseline'
import { buildEffectiveConfig } from './effective'
import type { TeamRule, EffectiveConfig } from './types'

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

/** Build a fresh EffectiveConfig from the generator's baseline rules. */
export function defaultFixtureConfig(): EffectiveConfig {
  const raw = buildBaselineRules()
  const teamRules = raw.map(rawToTeamRule)
  return buildEffectiveConfig(teamRules, {})
}

/** Build a fixture config with a specific case override applied. */
export function fixtureConfigWithOverride(override: Record<string, string>): EffectiveConfig {
  const raw = buildBaselineRules()
  const teamRules = raw.map(rawToTeamRule)
  return buildEffectiveConfig(teamRules, override)
}
