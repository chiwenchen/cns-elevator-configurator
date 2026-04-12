/**
 * Mode B Solver — 需求 → 空間
 */

import { maxAreaForLoad, ISO_8100_TABLE_6 } from './table'
import {
  carWidthToShaftWidth,
  carDepthToShaftDepth,
  areaToCarDimensions,
  minOverheadFromSpeed,
  minPitDepthFromSpeed,
} from './clearances'
import { NonStandardError } from './types'
import type { ElevatorRequirement, ElevatorDesign } from './types'
import type { EffectiveConfig } from '../config/types'

export function solveModeB(
  input: ElevatorRequirement,
  config: EffectiveConfig,
): ElevatorDesign {
  // ---- Step 1: input sanity ----
  if (input.rated_load_kg < 100) {
    throw new NonStandardError(
      `額定載重 ${input.rated_load_kg} kg 低於 ISO 8100-1 最小 100 kg`,
      'load_below_min',
    )
  }
  const maxTableLoad = ISO_8100_TABLE_6[ISO_8100_TABLE_6.length - 1].rated_load_kg
  if (input.rated_load_kg > maxTableLoad + 2000) {
    throw new NonStandardError(
      `額定載重 ${input.rated_load_kg} kg 超過標準表格 + 延伸範圍`,
      'load_above_max',
    )
  }
  if (input.stops < 2) {
    throw new NonStandardError(`停站數 ${input.stops} 太少`, 'too_few_stops')
  }

  // ---- Step 2: Table 6 → max allowed area ----
  const max_area_m2 = maxAreaForLoad(input.rated_load_kg)

  // ---- Step 3: Area → car dims via per-usage aspect ratio ----
  const { car_width_mm, car_depth_mm } = areaToCarDimensions(
    max_area_m2,
    input.usage,
    config,
  )

  // Accessible minimum (CNS 13627 → config.usage_constraints)
  if (input.usage === 'accessible') {
    if (
      car_width_mm < config.usage_constraints.accessible_min_car_width_mm ||
      car_depth_mm < config.usage_constraints.accessible_min_car_depth_mm
    ) {
      throw new NonStandardError(
        `載重 ${input.rated_load_kg} kg 推出的無障礙車廂 ${car_width_mm}×${car_depth_mm} mm ` +
          `小於 CNS 13627 最小 ${config.usage_constraints.accessible_min_car_width_mm}×${config.usage_constraints.accessible_min_car_depth_mm} mm`,
        'accessible_too_small',
        `提高載重到至少 675 kg (對應 1.75 m² ≈ 1100×1400)`,
      )
    }
  }

  // Bed elevator depth constraint
  if (
    input.usage === 'bed' &&
    car_depth_mm < config.usage_constraints.bed_min_car_depth_mm
  ) {
    throw new NonStandardError(
      `載重 ${input.rated_load_kg} kg 推出的病床車廂深 ${car_depth_mm} mm ` +
        `小於病床電梯最小 ${config.usage_constraints.bed_min_car_depth_mm} mm`,
      'bed_too_shallow',
      `提高載重到至少 1275 kg`,
    )
  }

  // ---- Step 4: Car → shaft via clearances ----
  const shaft_width_mm = carWidthToShaftWidth(car_width_mm, config)
  const shaft_depth_mm = carDepthToShaftDepth(car_depth_mm, config)

  // ---- Step 5: Overhead / pit ----
  const rated_speed_mpm = input.rated_speed_mpm ?? config.height.default_speed_mpm
  const overhead_mm = minOverheadFromSpeed(rated_speed_mpm, config.height.overhead)
  const pit_depth_mm = minPitDepthFromSpeed(rated_speed_mpm, config.height.pit)

  // ---- Step 6: Total height ----
  const floor_height_mm = input.floor_height_mm ?? config.height.floor_default_mm
  const total_height_mm = floor_height_mm * (input.stops - 1)

  // ---- Step 7: Assemble design ----
  const car_area_m2 = (car_width_mm * car_depth_mm) / 1_000_000

  return {
    shaft: {
      width_mm: shaft_width_mm,
      depth_mm: shaft_depth_mm,
      total_height_mm,
      overhead_mm,
      pit_depth_mm,
      stops: input.stops,
      usage: input.usage,
    },
    car: {
      width_mm: car_width_mm,
      depth_mm: car_depth_mm,
      height_mm: config.car.height_mm[input.usage],
      area_m2: Number(car_area_m2.toFixed(3)),
    },
    door: {
      width_mm: config.door.default_width_mm[input.usage],
      type:
        car_width_mm >= config.door.center_opening_min_car_width_mm
          ? 'center_opening'
          : 'side_opening',
    },
    rated_load_kg: input.rated_load_kg,
    rated_speed_mpm,
    machine_location: input.machine_location,
    solver_mode: 'B',
    generated_at: new Date().toISOString(),
  }
}
