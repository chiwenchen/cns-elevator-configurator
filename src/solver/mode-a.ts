/**
 * Mode A Solver — 空間 → 電梯
 *
 * 業務情境：
 *   客戶：「我這個機電房空了 2m × 2.2m × 18m 給電梯，你們能裝什麼？」
 *   業務 → 輸入到 solver → 拿到 ElevatorDesign + DXF
 *
 * 解算流程：
 *   1. 驗證輸入合理性（坑道不能太小）
 *   2. 從坑道寬深扣除 clearance → 最大車廂寬深
 *   3. 計算最大車廂面積
 *   4. 查 ISO 8100-1 Table 6 → 對應最大可裝載重（向下取整到標準等級）
 *   5. 推算 overhead / pit 需求（用輸入速度等級）
 *   6. 驗證 overhead / pit 是否滿足 CNS 15827-20 §5.2.5.x 硬約束
 *   7. 組裝 ElevatorDesign
 */

import { ISO_8100_TABLE_6 } from './table'
import {
  shaftWidthToMaxCarWidth,
  shaftDepthToMaxCarDepth,
  defaultCarHeight,
  defaultDoorWidth,
  minOverheadFromSpeed,
  minPitDepthFromSpeed,
} from './clearances'
import { NonStandardError } from './types'
import type { ShaftSpec, ElevatorDesign } from './types'

const MIN_SHAFT_WIDTH_MM = 1400
const MIN_SHAFT_DEPTH_MM = 1500

export function solveModeA(input: ShaftSpec): ElevatorDesign {
  // ---- Step 1: 合理性檢查 ----
  if (input.width_mm < MIN_SHAFT_WIDTH_MM) {
    throw new NonStandardError(
      `坑道寬 ${input.width_mm} mm 小於實用最小值 ${MIN_SHAFT_WIDTH_MM} mm`,
      'shaft_too_narrow',
      `建議坑道寬至少 ${MIN_SHAFT_WIDTH_MM} mm（可容納最小載重 180 kg 的車廂 + 結構 clearance）`
    )
  }
  if (input.depth_mm < MIN_SHAFT_DEPTH_MM) {
    throw new NonStandardError(
      `坑道深 ${input.depth_mm} mm 小於實用最小值 ${MIN_SHAFT_DEPTH_MM} mm`,
      'shaft_too_shallow',
      `建議坑道深至少 ${MIN_SHAFT_DEPTH_MM} mm`
    )
  }
  if (input.stops < 2) {
    throw new NonStandardError(
      `停站數 ${input.stops} 太少`,
      'too_few_stops',
      '電梯至少需要 2 個停靠層'
    )
  }

  // ---- Step 2: 從坑道扣 clearance → 最大車廂寬深 ----
  const max_car_width = shaftWidthToMaxCarWidth(input.width_mm, input.usage)
  const max_car_depth = shaftDepthToMaxCarDepth(input.depth_mm, input.usage)

  if (max_car_width < 700 || max_car_depth < 700) {
    throw new NonStandardError(
      `扣除 clearance 後車廂可用空間 ${max_car_width}×${max_car_depth} mm 太小`,
      'car_too_small_after_clearance'
    )
  }

  // ---- Step 3: 車廂面積 ----
  // 四捨五入到 50mm 讓數字乾淨
  const car_width_mm = Math.floor(max_car_width / 50) * 50
  const car_depth_mm = Math.floor(max_car_depth / 50) * 50
  const car_area_m2 = (car_width_mm * car_depth_mm) / 1_000_000

  // ---- Step 4: 查 ISO 8100-1 Table 6 找對應載重 ----
  // Mode A 的語意：「這個面積最多能裝多少 kg」→ 找表格中 area >= car_area 的最小 point
  // → 但實務上要「向下對齊到標準等級」，所以取 area <= car_area 的最大 point
  // (這樣產出的車廂不會超過表格允許的面積上限)
  let chosen_load = 0
  let chosen_max_area = 0
  for (const point of ISO_8100_TABLE_6) {
    if (point.max_car_area_m2 <= car_area_m2) {
      chosen_load = point.rated_load_kg
      chosen_max_area = point.max_car_area_m2
    } else {
      break
    }
  }

  if (chosen_load === 0) {
    throw new NonStandardError(
      `車廂面積 ${car_area_m2.toFixed(2)} m² 小於 Table 6 最小 0.37 m² (100 kg)`,
      'area_below_table_min'
    )
  }

  // ---- Step 5: 建議速度 + 推算 overhead / pit 需求 ----
  // Mode A 的速度不是使用者指定的，而是從 overhead 回推的
  // 使用者如果沒指定，預設 60 m/min
  const preferred_speed_mpm = input.preferred_speed_mpm ?? 60

  const required_overhead = minOverheadFromSpeed(preferred_speed_mpm)
  const required_pit = minPitDepthFromSpeed(preferred_speed_mpm)

  // ---- Step 6: 驗證使用者給的 overhead / pit 是否足夠 ----
  if (input.overhead_mm < required_overhead) {
    throw new NonStandardError(
      `頂部高度 ${input.overhead_mm} mm 不足` +
      ` (以 ${preferred_speed_mpm} m/min 推算需要至少 ${required_overhead} mm)`,
      'insufficient_overhead',
      `增加頂部高度到 ${required_overhead} mm 或調低速度`
    )
  }
  if (input.pit_depth_mm < required_pit) {
    throw new NonStandardError(
      `底坑深度 ${input.pit_depth_mm} mm 不足` +
      ` (以 ${preferred_speed_mpm} m/min 推算需要至少 ${required_pit} mm)`,
      'insufficient_pit_depth',
      `增加底坑深度到 ${required_pit} mm 或調低速度`
    )
  }

  // ---- Step 7: 組裝 ElevatorDesign ----
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
      height_mm: defaultCarHeight(input.usage),
      area_m2: Number(car_area_m2.toFixed(3)),
    },
    door: {
      width_mm: defaultDoorWidth(input.usage),
      type: car_width_mm >= 1400 ? 'center_opening' : 'side_opening',
    },
    rated_load_kg: chosen_load,
    rated_speed_mpm: preferred_speed_mpm,
    machine_location: 'MR', // Mode A 預設 MR，使用者之後可改
    solver_mode: 'A',
    generated_at: new Date().toISOString(),
  }
}
