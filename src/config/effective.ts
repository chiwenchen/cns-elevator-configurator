/**
 * Three-layer rule merger.
 *
 * Merges team default rules (from D1) with per-case overrides (from client),
 * validates every final value against its baseline constraints, and assembles
 * a strongly-typed EffectiveConfig for downstream consumers.
 *
 * Fails fast on any baseline violation. Silently ignores unknown override keys
 * (client may have stale localStorage referring to rules that were deleted).
 */

import type { TeamRule, CaseOverride, EffectiveConfig, CwtPosition, Usage, BufferType } from './types'

export class BaselineViolationError extends Error {
  constructor(
    public readonly ruleKey: string,
    public readonly attemptedValue: string,
    public readonly reason: string,
    public readonly baseline: { min?: number; max?: number; choices?: string[] },
  ) {
    super(`Baseline violation on ${ruleKey}: ${reason}`)
    this.name = 'BaselineViolationError'
  }
}

/**
 * Validate a candidate string value against a rule's baseline constraints.
 * Throws BaselineViolationError on failure.
 */
export function assertValueWithinBaseline(rule: TeamRule, value: string): void {
  if (rule.type === 'number') {
    const n = parseFloat(value)
    if (!Number.isFinite(n)) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `值 "${value}" 不是有效數字`,
        { min: rule.baseline_min ?? undefined, max: rule.baseline_max ?? undefined },
      )
    }
    if (rule.baseline_min !== null && n < rule.baseline_min) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `${n} 低於 baseline 下限 ${rule.baseline_min}${rule.unit || ''}`,
        { min: rule.baseline_min, max: rule.baseline_max ?? undefined },
      )
    }
    if (rule.baseline_max !== null && n > rule.baseline_max) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `${n} 超過 baseline 上限 ${rule.baseline_max}${rule.unit || ''}`,
        { min: rule.baseline_min ?? undefined, max: rule.baseline_max },
      )
    }
  } else if (rule.type === 'enum') {
    if (rule.baseline_choices && !rule.baseline_choices.includes(value)) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `"${value}" 不在允許選項 [${rule.baseline_choices.join(', ')}] 內`,
        { choices: rule.baseline_choices },
      )
    }
  }
}

/**
 * Merge three layers (baseline ranges already on each rule, team defaults in
 * rule.value, case override from client) and return a typed EffectiveConfig.
 */
export function buildEffectiveConfig(
  teamRules: TeamRule[],
  caseOverride: CaseOverride,
): EffectiveConfig {
  // Step 1: map team rules by key for O(1) lookup.
  const byKey = new Map<string, TeamRule>()
  for (const rule of teamRules) byKey.set(rule.key, rule)

  // Step 2: compute final value for every rule (override wins), validate baseline.
  const finalValues = new Map<string, string>()
  for (const rule of teamRules) {
    const override = caseOverride[rule.key]
    const final = override !== undefined ? override : rule.value
    assertValueWithinBaseline(rule, final)
    finalValues.set(rule.key, final)
  }

  // Step 3: parse into structured EffectiveConfig.
  return parseIntoStructuredConfig(finalValues)
}

// ---- Structural assembly ----

function parseIntoStructuredConfig(values: Map<string, string>): EffectiveConfig {
  const num = (key: string): number => {
    const v = values.get(key)
    if (v === undefined) throw new Error(`Missing rule: ${key}`)
    return parseFloat(v)
  }
  const str = (key: string): string => {
    const v = values.get(key)
    if (v === undefined) throw new Error(`Missing rule: ${key}`)
    return v
  }

  const usages: Usage[] = ['passenger', 'accessible', 'bed', 'freight']

  const buildAspectRatio = () => {
    const out = {} as Record<Usage, { w: number; d: number }>
    for (const u of usages) {
      out[u] = {
        w: num(`car.aspect_ratio.${u}.w`),
        d: num(`car.aspect_ratio.${u}.d`),
      }
    }
    return out
  }

  const buildCarHeight = () => {
    const out = {} as Record<Usage, number>
    for (const u of usages) out[u] = num(`car.height_mm.${u}`)
    return out
  }

  const buildDoorWidth = () => {
    const out = {} as Record<Usage, number>
    for (const u of usages) out[u] = num(`door.default_width_mm.${u}`)
    return out
  }

  return {
    shaft: {
      min_width_mm: num('shaft.min_width_mm'),
      min_depth_mm: num('shaft.min_depth_mm'),
    },
    clearance: {
      side_mm: num('clearance.side_mm'),
      back_mm: num('clearance.back_mm'),
      front_mm: num('clearance.front_mm'),
    },
    car: {
      aspect_ratio: buildAspectRatio(),
      height_mm: buildCarHeight(),
    },
    cwt: {
      position: str('cwt.position') as CwtPosition,
      width_mm: num('cwt.width_mm'),
      thickness_mm: num('cwt.thickness_mm'),
      back_offset_mm: num('cwt.back_offset_mm'),
      left_offset_mm: num('cwt.left_offset_mm'),
    },
    rail: {
      car_size_mm: num('rail.car.size_mm'),
      car_gap_mm: num('rail.car.gap_mm'),
      cwt_size_mm: num('rail.cwt.size_mm'),
      cwt_gap_mm: num('rail.cwt.gap_mm'),
    },
    door: {
      frame_depth_mm: num('door.frame_depth_mm'),
      leaf_thickness_mm: num('door.leaf_thickness_mm'),
      sill_depth_mm: num('door.sill_depth_mm'),
      default_width_mm: buildDoorWidth(),
      center_opening_min_car_width_mm: num('door.type_switch.center_opening_min_car_width_mm'),
    },
    height: {
      floor_default_mm: num('height.floor_default_mm'),
      default_speed_mpm: num('height.default_speed_mpm'),
      overhead: {
        refuge_mm: num('height.overhead.refuge_mm'),
        machine_buffer_mm: num('height.overhead.machine_buffer_mm'),
        bounce_coef: num('height.overhead.bounce_coef'),
      },
      pit: {
        refuge_mm: num('height.pit.refuge_mm'),
        buffer_mm: num('height.pit.buffer_mm'),
        speed_bonus_90mpm_mm: num('height.pit.speed_bonus_90mpm_mm'),
        speed_bonus_150mpm_mm: num('height.pit.speed_bonus_150mpm_mm'),
      },
    },
    usage_constraints: {
      accessible_min_car_width_mm: num('usage.accessible.min_car_width_mm'),
      accessible_min_car_depth_mm: num('usage.accessible.min_car_depth_mm'),
      bed_min_car_depth_mm: num('usage.bed.min_car_depth_mm'),
    },
    professional: values.has('pro.sling_offset_mm') ? {
      sling_offset_mm: num('pro.sling_offset_mm'),
      sling_thickness_mm: num('pro.sling_thickness_mm'),
      guide_shoe_width_mm: num('pro.guide_shoe_width_mm'),
      guide_shoe_depth_mm: num('pro.guide_shoe_depth_mm'),
      wall_thickness_mm: num('pro.wall_thickness_mm'),
      buffer_type: str('pro.buffer_type') as BufferType,
      buffer_width_mm: num('pro.buffer_width_mm'),
      buffer_height_spring_mm: num('pro.buffer_height_spring_mm'),
      buffer_height_oil_mm: num('pro.buffer_height_oil_mm'),
      machine_width_mm: num('pro.machine_width_mm'),
      machine_height_mm: num('pro.machine_height_mm'),
      sheave_diameter_mm: num('pro.sheave_diameter_mm'),
      safety_gear_width_mm: num('pro.safety_gear_width_mm'),
      safety_gear_height_mm: num('pro.safety_gear_height_mm'),
      governor_diameter_mm: num('pro.governor_diameter_mm'),
      rail_bracket_spacing_mm: num('pro.rail_bracket_spacing_mm'),
    } : undefined,
  }
}
