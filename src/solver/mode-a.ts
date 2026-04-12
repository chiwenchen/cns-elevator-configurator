/**
 * Mode A Solver — 空間 → 電梯
 *
 * 1. Validate shaft size against config.shaft min dimensions
 * 2. Derive max car dims from shaft - clearance (from config)
 * 3. Query ISO 8100-1 Table 6 for matching load
 * 4. Compute required overhead/pit from speed + config formula params
 * 5. Validate user-provided overhead/pit are sufficient
 * 6. Assemble ElevatorDesign
 */

import { ISO_8100_TABLE_6 } from './table'
import {
  shaftWidthToMaxCarWidth,
  shaftDepthToMaxCarDepth,
  minOverheadFromSpeed,
  minPitDepthFromSpeed,
} from './clearances'
import { NonStandardError } from './types'
import type { ShaftSpec, ElevatorDesign } from './types'
import type { EffectiveConfig } from '../config/types'

export function solveModeA(
  input: ShaftSpec,
  config: EffectiveConfig,
): ElevatorDesign {
  // ---- Step 1: shaft size sanity ----
  if (input.width_mm < config.shaft.min_width_mm) {
    throw new NonStandardError(
      `坑道寬 ${input.width_mm} mm 小於實用最小值 ${config.shaft.min_width_mm} mm`,
      'shaft_too_narrow',
      `建議坑道寬至少 ${config.shaft.min_width_mm} mm`,
    )
  }
  if (input.depth_mm < config.shaft.min_depth_mm) {
    throw new NonStandardError(
      `坑道深 ${input.depth_mm} mm 小於實用最小值 ${config.shaft.min_depth_mm} mm`,
      'shaft_too_shallow',
      `建議坑道深至少 ${config.shaft.min_depth_mm} mm`,
    )
  }
  if (input.stops < 2) {
    throw new NonStandardError(
      `停站數 ${input.stops} 太少`,
      'too_few_stops',
      '電梯至少需要 2 個停靠層',
    )
  }

  // ---- Step 2: shaft → max car dims via config clearances ----
  const max_car_width = shaftWidthToMaxCarWidth(input.width_mm, config)
  const max_car_depth = shaftDepthToMaxCarDepth(input.depth_mm, config)

  if (max_car_width < 700 || max_car_depth < 700) {
    throw new NonStandardError(
      `扣除 clearance 後車廂可用空間 ${max_car_width}×${max_car_depth} mm 太小`,
      'car_too_small_after_clearance',
    )
  }

  // ---- Step 3: Round to 50mm, compute area ----
  const car_width_mm = Math.floor(max_car_width / 50) * 50
  const car_depth_mm = Math.floor(max_car_depth / 50) * 50
  const car_area_m2 = (car_width_mm * car_depth_mm) / 1_000_000

  // ---- Step 4: Table 6 lookup for load ----
  let chosen_load = 0
  for (const point of ISO_8100_TABLE_6) {
    if (point.max_car_area_m2 <= car_area_m2) {
      chosen_load = point.rated_load_kg
    } else {
      break
    }
  }

  if (chosen_load === 0) {
    throw new NonStandardError(
      `車廂面積 ${car_area_m2.toFixed(2)} m² 小於 Table 6 最小 0.37 m² (100 kg)`,
      'area_below_table_min',
    )
  }

  // ---- Step 5: Required overhead/pit from speed ----
  const preferred_speed_mpm = input.preferred_speed_mpm ?? config.height.default_speed_mpm
  const required_overhead = minOverheadFromSpeed(preferred_speed_mpm, config.height.overhead)
  const required_pit = minPitDepthFromSpeed(preferred_speed_mpm, config.height.pit)

  // ---- Step 6: Validate overhead/pit ----
  if (input.overhead_mm < required_overhead) {
    throw new NonStandardError(
      `頂部高度 ${input.overhead_mm} mm 不足 (以 ${preferred_speed_mpm} m/min 推算需要至少 ${required_overhead} mm)`,
      'insufficient_overhead',
      `增加頂部高度到 ${required_overhead} mm 或調低速度`,
    )
  }
  if (input.pit_depth_mm < required_pit) {
    throw new NonStandardError(
      `底坑深度 ${input.pit_depth_mm} mm 不足 (以 ${preferred_speed_mpm} m/min 推算需要至少 ${required_pit} mm)`,
      'insufficient_pit_depth',
      `增加底坑深度到 ${required_pit} mm 或調低速度`,
    )
  }

  // ---- Step 7: Assemble ElevatorDesign ----
  return {
    shaft: {
      width_mm: input.width_mm,
      depth_mm: input.depth_mm,
      total_height_mm: input.total_height_mm,
      overhead_mm: input.overhead_mm,
      pit_depth_mm: input.pit_depth_mm,
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
    rated_load_kg: chosen_load,
    rated_speed_mpm: preferred_speed_mpm,
    machine_location: 'MR',
    solver_mode: 'A',
    generated_at: new Date().toISOString(),
  }
}
