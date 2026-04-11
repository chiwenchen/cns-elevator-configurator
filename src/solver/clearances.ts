/**
 * 坑道 clearance 與機房空間推算公式
 *
 * 這些是簡化版的推算邏輯，用來驅動 Mode A / Mode B solver。
 *
 * 真實數值應對照 CNS 15827-20 §5.2 / §5.4 / §5.6 的詳細要求。
 * Sprint 1 上線前需由資深設計師 review。
 */

import type { Usage } from './types'

/**
 * 坑道寬深相對於車廂的側向 clearance（mm, 單側）
 *
 * 估計基礎：
 * - 側向（左右）：導軌 + 安裝 clearance ≈ 150-200 mm 每側
 * - 後方（depth）：配重 + 導軌 ≈ 250-350 mm
 * - 前方（depth）：門 operator + sill 空間 ≈ 100-150 mm
 */
export interface ShaftClearance {
  side_each_mm: number      // 單側側向
  back_mm: number           // 後方（配重）
  front_mm: number          // 前方（門 operator）
}

const DEFAULT_CLEARANCE: ShaftClearance = {
  side_each_mm: 200,
  back_mm: 250,
  front_mm: 150,
}

export function getClearance(_usage: Usage): ShaftClearance {
  // v1 所有用途都用相同 clearance
  // v1.1 可依 usage 區分（貨梯前方 clearance 可以更小）
  return DEFAULT_CLEARANCE
}

/** 從車廂寬推算坑道寬 */
export function carWidthToShaftWidth(car_width_mm: number, usage: Usage): number {
  const c = getClearance(usage)
  return car_width_mm + c.side_each_mm * 2
}

/** 從車廂深推算坑道深 */
export function carDepthToShaftDepth(car_depth_mm: number, usage: Usage): number {
  const c = getClearance(usage)
  return car_depth_mm + c.back_mm + c.front_mm
}

/** 從坑道寬推算最大車廂寬 */
export function shaftWidthToMaxCarWidth(shaft_width_mm: number, usage: Usage): number {
  const c = getClearance(usage)
  return shaft_width_mm - c.side_each_mm * 2
}

/** 從坑道深推算最大車廂深 */
export function shaftDepthToMaxCarDepth(shaft_depth_mm: number, usage: Usage): number {
  const c = getClearance(usage)
  return shaft_depth_mm - c.back_mm - c.front_mm
}

/**
 * 速度等級 → 建議 overhead
 *
 * 簡化版：避險空間 (1000-2000) + 機械 (800-1500) + 緩衝 (500-1000) + 跳衝 (0.035v²)
 * 對應 CNS 15827-20 §5.2.5.7.1 (car top refuge)
 *
 * 實際 overhead 要依機房型式 (MR vs MRL) + 驅動型式 (traction vs hydraulic) 精算，
 * 這裡只是給 Mode B 推一個「合理的預設值」。
 */
export function minOverheadFromSpeed(speed_mpm: number): number {
  const v_mps = speed_mpm / 60
  const refuge = 2000 // 站立避險
  const bounce = 0.035 * v_mps * v_mps * 1000 // 跳衝（mm）
  const machine_and_buffer = 2000 // 機械 + 緩衝 + 車廂頂安全距離

  const raw = refuge + bounce + machine_and_buffer

  // 四捨五入到 100 mm，實務上 overhead 通常是 3800 / 4200 / 4600 這種整齊數字
  return Math.ceil(raw / 100) * 100
}

/**
 * 速度等級 → 建議 pit depth
 *
 * 簡化版：避險空間 (1000 蜷縮) + 緩衝 (400-800)
 * 對應 CNS 15827-20 §5.2.5.8.1 (pit refuge)
 */
export function minPitDepthFromSpeed(speed_mpm: number): number {
  const refuge = 1000 // 蜷縮避險
  const buffer = 500 // 緩衝

  // 高速需要更多 pit 讓緩衝器能完全壓縮
  const speed_bonus = speed_mpm > 150 ? 500 : speed_mpm > 90 ? 200 : 0

  const raw = refuge + buffer + speed_bonus
  return Math.ceil(raw / 100) * 100
}

/**
 * 用途 → 車廂寬 / 深 aspect ratio (W/D)
 *
 * 給定面積時用來切成寬與深。
 *
 * - passenger：略寬於深（典型 1400×1100）
 * - accessible：略深於寬（輪椅迴轉空間，典型 1100×1400，CNS 13627 最小）
 * - bed：深遠大於寬（典型 1100×2400 病床）
 * - freight：正方形
 */
export function carAspectRatio(usage: Usage): { w_ratio: number; d_ratio: number } {
  switch (usage) {
    case 'passenger':
      return { w_ratio: 1.15, d_ratio: 1.0 }
    case 'accessible':
      return { w_ratio: 1.0, d_ratio: 1.27 } // 1100 × 1400
    case 'bed':
      return { w_ratio: 1.0, d_ratio: 2.18 } // 1100 × 2400
    case 'freight':
      return { w_ratio: 1.0, d_ratio: 1.0 }
  }
}

/** 給定面積跟用途，推出一組 (car_width, car_depth) */
export function areaToCarDimensions(
  area_m2: number,
  usage: Usage
): { car_width_mm: number; car_depth_mm: number } {
  const { w_ratio, d_ratio } = carAspectRatio(usage)
  // area = width * depth, width/depth = w_ratio/d_ratio
  // → depth = sqrt(area * d_ratio / w_ratio)
  const area_mm2 = area_m2 * 1_000_000
  const depth_mm = Math.sqrt((area_mm2 * d_ratio) / w_ratio)
  const width_mm = depth_mm * (w_ratio / d_ratio)
  // 四捨五入到 50 mm
  return {
    car_width_mm: Math.round(width_mm / 50) * 50,
    car_depth_mm: Math.round(depth_mm / 50) * 50,
  }
}

/** 預設車廂高度：依用途 */
export function defaultCarHeight(usage: Usage): number {
  switch (usage) {
    case 'passenger':
    case 'accessible':
      return 2300
    case 'bed':
      return 2400
    case 'freight':
      return 2200
  }
}

/** 預設門寬：依用途 */
export function defaultDoorWidth(usage: Usage): number {
  switch (usage) {
    case 'accessible':
      return 900 // CNS 13627 無障礙最小 900
    case 'bed':
      return 1100 // 病床電梯門寬
    case 'passenger':
      return 800 // 客用標準
    case 'freight':
      return 1100 // 貨用通常較寬
  }
}

/** 預設樓層高 */
export const DEFAULT_FLOOR_HEIGHT_MM = 3000
