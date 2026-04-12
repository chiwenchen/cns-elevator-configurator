/**
 * Config system types — shared across rules loading, effective config building,
 * and solver/DXF consumption.
 *
 * No runtime logic lives here; see effective.ts, load.ts, fixtures.ts.
 */

import type { Usage, DoorType } from '../solver/types'

/** A row from the D1 `rules` table, parsed into typed form. */
export interface TeamRule {
  id: number
  key: string
  name: string
  description: string | null
  type: 'number' | 'enum'
  value: string
  default_value: string
  unit: string | null
  baseline_min: number | null
  baseline_max: number | null
  baseline_choices: string[] | null
  category: string
  mandatory: 0 | 1
  source: 'cns' | 'industry' | 'engineering'
}

/** Flat key → value map sent by client in /api/solve request body. */
export interface CaseOverride {
  [key: string]: string
}

/** Counterweight position choices (matches `cwt.position` enum rule). */
export type CwtPosition =
  | 'back_left'
  | 'back_center'
  | 'back_right'
  | 'side_left'
  | 'side_right'

/** Overhead formula parameters (CNS 15827-20 §5.2.5.7.1 derived). */
export interface OverheadFormulaParams {
  refuge_mm: number
  machine_buffer_mm: number
  bounce_coef: number
}

/** Pit depth formula parameters (CNS 15827-20 §5.2.5.8.1 derived). */
export interface PitFormulaParams {
  refuge_mm: number
  buffer_mm: number
  speed_bonus_90mpm_mm: number
  speed_bonus_150mpm_mm: number
}

/**
 * Parsed + structured EffectiveConfig. This is what the solver, DXF generator,
 * and validation report consume. Built from:
 *   baseline (DB rules) + team defaults (DB values) + per-case override (request body)
 * via buildEffectiveConfig in effective.ts.
 */
export interface EffectiveConfig {
  shaft: {
    min_width_mm: number
    min_depth_mm: number
  }
  clearance: {
    side_mm: number
    back_mm: number
    front_mm: number
  }
  car: {
    aspect_ratio: Record<Usage, { w: number; d: number }>
    height_mm: Record<Usage, number>
  }
  cwt: {
    position: CwtPosition
    width_mm: number
    thickness_mm: number
    back_offset_mm: number
    left_offset_mm: number
  }
  rail: {
    car_size_mm: number
    car_gap_mm: number
    cwt_size_mm: number
    cwt_gap_mm: number
  }
  door: {
    frame_depth_mm: number
    leaf_thickness_mm: number
    sill_depth_mm: number
    default_width_mm: Record<Usage, number>
    center_opening_min_car_width_mm: number
  }
  height: {
    floor_default_mm: number
    default_speed_mpm: number
    overhead: OverheadFormulaParams
    pit: PitFormulaParams
  }
  usage_constraints: {
    accessible_min_car_width_mm: number
    accessible_min_car_depth_mm: number
    bed_min_car_depth_mm: number
  }
}

/** Re-exports so downstream files don't have to double-import. */
export type { Usage, DoorType } from '../solver/types'

// ---- ValidationReport (Milestone 1c) ----

export type ValidationStatus = 'pass' | 'warning' | 'fail'

export interface ValidationItem {
  rule_key: string
  rule_name: string
  category: string
  source: 'cns' | 'industry' | 'engineering'
  mandatory: boolean
  final_value: string
  team_default_value: string
  factory_default_value: string
  baseline_description: string
  status: ValidationStatus
  status_reason: string
}

export interface ValidationReport {
  summary: {
    guideline_pass: number
    guideline_warning: number
    cns_pass: number
    cns_warning: number
    total_fail: number
  }
  items: ValidationItem[]
}
