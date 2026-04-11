/**
 * Mode B Solver — 需求 → 空間
 *
 * 業務情境：
 *   客戶：「我要 500 kg 的電梯，坑道要預留多大？」
 *   業務 → 輸入到 solver → 拿到最小坑道規格 + DXF
 *
 * 解算流程：
 *   1. 驗證載重在合理範圍
 *   2. 查 ISO 8100-1 Table 6 → 對應最大允許車廂面積
 *   3. 依 usage aspect ratio → 推車廂寬 × 深
 *   4. 加 clearance → 最小坑道寬深
 *   5. 推算 overhead / pit 需求（依速度）
 *   6. 用停站數 × 預設樓高推算 total_height
 *   7. 組裝 ElevatorDesign
 */

import { maxAreaForLoad, ISO_8100_TABLE_6 } from './table'
import {
  carWidthToShaftWidth,
  carDepthToShaftDepth,
  areaToCarDimensions,
  defaultCarHeight,
  defaultDoorWidth,
  minOverheadFromSpeed,
  minPitDepthFromSpeed,
  DEFAULT_FLOOR_HEIGHT_MM,
} from './clearances'
import { NonStandardError } from './types'
import type { ElevatorRequirement, ElevatorDesign } from './types'

export function solveModeB(input: ElevatorRequirement): ElevatorDesign {
  // ---- Step 1: 合理性檢查 ----
  if (input.rated_load_kg < 100) {
    throw new NonStandardError(
      `額定載重 ${input.rated_load_kg} kg 低於 ISO 8100-1 最小 100 kg`,
      'load_below_min'
    )
  }
  const maxTableLoad =
    ISO_8100_TABLE_6[ISO_8100_TABLE_6.length - 1].rated_load_kg
  if (input.rated_load_kg > maxTableLoad + 2000) {
    throw new NonStandardError(
      `額定載重 ${input.rated_load_kg} kg 超過標準表格 + 延伸範圍`,
      'load_above_max'
    )
  }
  if (input.stops < 2) {
    throw new NonStandardError(
      `停站數 ${input.stops} 太少`,
      'too_few_stops'
    )
  }

  // ---- Step 2: 查 Table 6 → 最大允許面積 ----
  const max_area_m2 = maxAreaForLoad(input.rated_load_kg)

  // ---- Step 3: 推車廂寬深 ----
  const { car_width_mm, car_depth_mm } = areaToCarDimensions(
    max_area_m2,
    input.usage
  )

  // 確保 accessible 符合 CNS 13627 最小 1100 × 1400
  if (input.usage === 'accessible') {
    if (car_width_mm < 1100 || car_depth_mm < 1400) {
      throw new NonStandardError(
        `載重 ${input.rated_load_kg} kg 推出的無障礙車廂 ${car_width_mm}×${car_depth_mm} mm ` +
        `小於 CNS 13627 最小 1100×1400 mm`,
        'accessible_too_small',
        `提高載重到至少 675 kg (對應 1.75 m² ≈ 1100×1400)`
      )
    }
  }

  // 病床電梯確認 depth
  if (input.usage === 'bed' && car_depth_mm < 2400) {
    throw new NonStandardError(
      `載重 ${input.rated_load_kg} kg 推出的病床車廂深 ${car_depth_mm} mm ` +
      `小於病床電梯最小 2400 mm`,
      'bed_too_shallow',
      `提高載重到至少 1275 kg`
    )
  }

  // ---- Step 4: 加 clearance → 最小坑道寬深 ----
  const shaft_width_mm = carWidthToShaftWidth(car_width_mm, input.usage)
  const shaft_depth_mm = carDepthToShaftDepth(car_depth_mm, input.usage)

  // ---- Step 5: 推算 overhead / pit ----
  const rated_speed_mpm = input.rated_speed_mpm ?? 60
  const overhead_mm = minOverheadFromSpeed(rated_speed_mpm)
  const pit_depth_mm = minPitDepthFromSpeed(rated_speed_mpm)

  // ---- Step 6: 推算 total height ----
  const floor_height_mm = input.floor_height_mm ?? DEFAULT_FLOOR_HEIGHT_MM
  const total_height_mm = floor_height_mm * (input.stops - 1)

  // ---- Step 7: 組裝 ElevatorDesign ----
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
      height_mm: defaultCarHeight(input.usage),
      area_m2: Number(car_area_m2.toFixed(3)),
    },
    door: {
      width_mm: defaultDoorWidth(input.usage),
      type: car_width_mm >= 1400 ? 'center_opening' : 'side_opening',
    },
    rated_load_kg: input.rated_load_kg,
    rated_speed_mpm,
    machine_location: input.machine_location,
    solver_mode: 'B',
    generated_at: new Date().toISOString(),
  }
}
