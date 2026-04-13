/**
 * EN 81-20:2020 / ISO 8100-1:2019 Table 6
 * 額定載重 vs 最大可用車廂面積
 *
 * 資料來源：elevatorworld.com 整理自 EN 81-20:2020 Table 6 /
 * ISO 8100-1:2019 Table 6（兩個標準的這張表內容一致）。
 *
 * 台灣 CNS 15827-20 直接引用 ISO 8100-1，預期數值完全一致。
 * 但在 production 上線前需由資深設計師對照 CNS 15827-20 原文 Table 6 逐行核對。
 *
 * 表格語意：
 * - 每一列「額定載重 Q (kg) ↔ 最大可用面積 A (m²) ↔ 額定乘客數 P」
 * - 所有電梯的車廂有效面積不得超過其額定載重對應的最大面積（防超載）
 * - 落在表格之間的載重用**線性內插**
 * - 2500 kg 以上每增加 100 kg 加 0.16 m²
 * - 乘客計算假設每人 75 kg（0.21 m²/人 的最小面積另有規定）
 *
 * 使用場景：
 * - Mode A (shaft → design)：從推算出的車廂面積，找出對應的「最小允許額定載重」
 * - Mode B (requirement → design)：從額定載重，找出「最大允許車廂面積」，
 *   然後用 usage aspect ratio 推成 car_width × car_depth
 */

interface LoadAreaPoint {
  rated_load_kg: number
  max_car_area_m2: number
  rated_passengers: number
}

export const ISO_8100_TABLE_6: ReadonlyArray<LoadAreaPoint> = [
  { rated_load_kg: 100, max_car_area_m2: 0.37, rated_passengers: 1 },
  { rated_load_kg: 180, max_car_area_m2: 0.58, rated_passengers: 2 },
  { rated_load_kg: 225, max_car_area_m2: 0.70, rated_passengers: 3 },
  { rated_load_kg: 300, max_car_area_m2: 0.90, rated_passengers: 4 },
  { rated_load_kg: 375, max_car_area_m2: 1.10, rated_passengers: 5 },
  { rated_load_kg: 400, max_car_area_m2: 1.17, rated_passengers: 5 },
  { rated_load_kg: 450, max_car_area_m2: 1.30, rated_passengers: 6 },
  { rated_load_kg: 525, max_car_area_m2: 1.45, rated_passengers: 7 },
  { rated_load_kg: 600, max_car_area_m2: 1.60, rated_passengers: 8 },
  { rated_load_kg: 630, max_car_area_m2: 1.66, rated_passengers: 8 },
  { rated_load_kg: 675, max_car_area_m2: 1.75, rated_passengers: 9 },
  { rated_load_kg: 750, max_car_area_m2: 1.90, rated_passengers: 10 },
  { rated_load_kg: 800, max_car_area_m2: 2.00, rated_passengers: 10 },
  { rated_load_kg: 825, max_car_area_m2: 2.05, rated_passengers: 11 },
  { rated_load_kg: 900, max_car_area_m2: 2.20, rated_passengers: 12 },
  { rated_load_kg: 975, max_car_area_m2: 2.35, rated_passengers: 13 },
  { rated_load_kg: 1000, max_car_area_m2: 2.40, rated_passengers: 13 },
  { rated_load_kg: 1050, max_car_area_m2: 2.50, rated_passengers: 14 },
  { rated_load_kg: 1125, max_car_area_m2: 2.65, rated_passengers: 15 },
  { rated_load_kg: 1200, max_car_area_m2: 2.80, rated_passengers: 16 },
  { rated_load_kg: 1250, max_car_area_m2: 2.90, rated_passengers: 16 },
  { rated_load_kg: 1275, max_car_area_m2: 2.95, rated_passengers: 17 },
  { rated_load_kg: 1350, max_car_area_m2: 3.10, rated_passengers: 18 },
  { rated_load_kg: 1425, max_car_area_m2: 3.25, rated_passengers: 19 },
  { rated_load_kg: 1500, max_car_area_m2: 3.40, rated_passengers: 20 },
  { rated_load_kg: 1600, max_car_area_m2: 3.56, rated_passengers: 21 },
  { rated_load_kg: 2000, max_car_area_m2: 4.20, rated_passengers: 26 },
  { rated_load_kg: 2500, max_car_area_m2: 5.00, rated_passengers: 33 },
]

/** 超過 2500 kg 時每 100 kg 增加的面積 */
const EXTENSION_AREA_PER_100KG = 0.16

/**
 * 給定車廂有效面積，回傳允許的**最小額定載重**（kg）。
 *
 * 語意：表格是「給定載重，最大允許面積」。反向使用時：給定一個面積，
 * 這個面積不能超過某個載重對應的最大面積，所以我們要找到「最小的 Q」
 * 使得這個面積合法 → 即找到表格中 area[i] >= requested_area 的最小 i。
 *
 * 若 area 超過 2500 kg 的 5.00 m²，用延伸公式推算。
 */
export function minLoadForArea(area_m2: number): number {
  if (area_m2 <= 0) {
    throw new Error(`Invalid area: ${area_m2} m²`)
  }

  // Special case: 表格最小值 0.37 m² → 100 kg。面積比這還小是非法輸入。
  if (area_m2 < ISO_8100_TABLE_6[0].max_car_area_m2) {
    return ISO_8100_TABLE_6[0].rated_load_kg
  }

  // 找第一個 max_car_area_m2 >= area_m2 的 entry
  for (const point of ISO_8100_TABLE_6) {
    if (point.max_car_area_m2 >= area_m2) {
      return point.rated_load_kg
    }
  }

  // 超出表格最大值 5.00 m² / 2500 kg — 用延伸公式
  const last = ISO_8100_TABLE_6[ISO_8100_TABLE_6.length - 1]
  const extra_area = area_m2 - last.max_car_area_m2
  // 避免浮點誤差：round to 9 decimals before ceil
  const ratio = Math.round((extra_area / EXTENSION_AREA_PER_100KG) * 1e9) / 1e9
  const extra_load_100kg_units = Math.ceil(ratio)
  return last.rated_load_kg + extra_load_100kg_units * 100
}

/**
 * 給定額定載重，回傳**最大允許車廂面積**（m²）。
 * 表格直接查詢，不在表格上的點做線性內插。
 */
export function maxAreaForLoad(load_kg: number): number {
  if (load_kg <= 0) {
    throw new Error(`Invalid load: ${load_kg} kg`)
  }

  // 低於表格最小值 100 kg
  if (load_kg < ISO_8100_TABLE_6[0].rated_load_kg) {
    throw new Error(
      `Load ${load_kg} kg below minimum (100 kg in ISO 8100-1 Table 6)`
    )
  }

  // 精確命中表格
  for (const point of ISO_8100_TABLE_6) {
    if (point.rated_load_kg === load_kg) {
      return point.max_car_area_m2
    }
  }

  // 超出表格最大值
  const last = ISO_8100_TABLE_6[ISO_8100_TABLE_6.length - 1]
  if (load_kg > last.rated_load_kg) {
    const extra_kg = load_kg - last.rated_load_kg
    const extra_area = (extra_kg / 100) * EXTENSION_AREA_PER_100KG
    return Number((last.max_car_area_m2 + extra_area).toFixed(3))
  }

  // 在表格中間 — 線性內插
  for (let i = 0; i < ISO_8100_TABLE_6.length - 1; i++) {
    const lower = ISO_8100_TABLE_6[i]
    const upper = ISO_8100_TABLE_6[i + 1]
    if (load_kg > lower.rated_load_kg && load_kg < upper.rated_load_kg) {
      const ratio =
        (load_kg - lower.rated_load_kg) /
        (upper.rated_load_kg - lower.rated_load_kg)
      const area =
        lower.max_car_area_m2 +
        ratio * (upper.max_car_area_m2 - lower.max_car_area_m2)
      return Number(area.toFixed(3))
    }
  }

  // 不應該到這裡
  throw new Error(`Unable to look up load ${load_kg} kg in Table 6`)
}

/**
 * 給定 rated load 回傳最多乘客數（依 ISO 8100-1 Table 6）
 */
export function maxPassengersForLoad(load_kg: number): number {
  for (const point of ISO_8100_TABLE_6) {
    if (point.rated_load_kg === load_kg) {
      return point.rated_passengers
    }
  }
  // 不在表格上，用 75 kg/人 推算
  return Math.floor(load_kg / 75)
}
