/**
 * Clearance + formula helpers — pure math, no module-level constants.
 *
 * All numeric inputs come from EffectiveConfig now (via callers). This file
 * only contains the formula shapes (overhead = f(speed), pit = g(speed),
 * area → car dimensions given aspect ratio, etc.). The actual numbers live
 * in D1 rules and flow through buildEffectiveConfig.
 *
 * Prior to Milestone 1b this file held `DEFAULT_CLEARANCE`, `carAspectRatio`,
 * `defaultCarHeight`, etc. — all deleted in favor of reading from config.
 */

import type { Usage } from './types'
import type {
  EffectiveConfig,
  OverheadFormulaParams,
  PitFormulaParams,
} from '../config/types'

/** Car width clearance calculation: shaft_width - 2 * side_clearance = car_width. */
export function carWidthToShaftWidth(
  car_width_mm: number,
  config: EffectiveConfig,
): number {
  return car_width_mm + config.clearance.side_mm * 2
}

export function carDepthToShaftDepth(
  car_depth_mm: number,
  config: EffectiveConfig,
): number {
  return car_depth_mm + config.clearance.back_mm + config.clearance.front_mm
}

export function shaftWidthToMaxCarWidth(
  shaft_width_mm: number,
  config: EffectiveConfig,
): number {
  return shaft_width_mm - config.clearance.side_mm * 2
}

export function shaftDepthToMaxCarDepth(
  shaft_depth_mm: number,
  config: EffectiveConfig,
): number {
  return shaft_depth_mm - config.clearance.back_mm - config.clearance.front_mm
}

/**
 * Required overhead from speed — CNS 15827-20 §5.2.5.7.1 simplified form.
 * Formula: refuge + bounce_coef * v² * 1000 + machine_buffer
 * (v in m/s, result in mm, rounded up to 100 mm)
 */
export function minOverheadFromSpeed(
  speed_mpm: number,
  params: OverheadFormulaParams,
): number {
  const v_mps = speed_mpm / 60
  const bounce = params.bounce_coef * v_mps * v_mps * 1000
  const raw = params.refuge_mm + bounce + params.machine_buffer_mm
  return Math.ceil(raw / 100) * 100
}

/**
 * Required pit depth from speed — CNS 15827-20 §5.2.5.8.1 simplified form.
 */
export function minPitDepthFromSpeed(
  speed_mpm: number,
  params: PitFormulaParams,
): number {
  const speed_bonus =
    speed_mpm > 150
      ? params.speed_bonus_150mpm_mm
      : speed_mpm > 90
      ? params.speed_bonus_90mpm_mm
      : 0
  const raw = params.refuge_mm + params.buffer_mm + speed_bonus
  return Math.ceil(raw / 100) * 100
}

/**
 * Given car area and usage, recover (car_width_mm, car_depth_mm) using the
 * per-usage aspect ratio from config. Rounds to 50mm increments.
 */
export function areaToCarDimensions(
  area_m2: number,
  usage: Usage,
  config: EffectiveConfig,
): { car_width_mm: number; car_depth_mm: number } {
  const { w: w_ratio, d: d_ratio } = config.car.aspect_ratio[usage]
  // area = width * depth, width/depth = w_ratio/d_ratio
  // → depth = sqrt(area * d_ratio / w_ratio)
  const area_mm2 = area_m2 * 1_000_000
  const depth_mm = Math.sqrt((area_mm2 * d_ratio) / w_ratio)
  const width_mm = depth_mm * (w_ratio / d_ratio)
  return {
    car_width_mm: Math.round(width_mm / 50) * 50,
    car_depth_mm: Math.round(depth_mm / 50) * 50,
  }
}
