/**
 * Parametric DXF Writer — production 版本
 *
 * 接受 ElevatorDesign，產出含平面圖 + 側面圖 + 規格卡的 DXF 字串。
 *
 * Layers（ACI 顏色編號 — AutoCAD Color Index）：
 *   SHAFT     7  white/black  井道外牆（結構）
 *   WALL      8  dark gray    井道內壁
 *   CAR       1  red          車廂
 *   CWT       3  green        配重框
 *   RAIL_CAR  5  blue         車廂導軌
 *   RAIL_CWT  4  cyan         配重導軌
 *   DOOR      6  magenta      門扇 + 門框 + 門檻
 *   CENTER    1  red DASHED   中心線
 *   DIMS      2  yellow       尺寸線 + 標註文字
 *   TEXT      7  white        一般標籤
 *   STOP      3  green        停站水平線（elevation）
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import { drawPlanView } from './plan'

export function generateElevatorDXF(design: ElevatorDesign): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')

  dw.addLayer('SHAFT', Drawing.ACI.WHITE, 'CONTINUOUS')
  dw.addLayer('WALL', 8, 'CONTINUOUS')
  dw.addLayer('CAR', Drawing.ACI.RED, 'CONTINUOUS')
  dw.addLayer('CWT', Drawing.ACI.GREEN, 'CONTINUOUS')
  dw.addLayer('RAIL_CAR', Drawing.ACI.BLUE, 'CONTINUOUS')
  dw.addLayer('RAIL_CWT', Drawing.ACI.CYAN, 'CONTINUOUS')
  dw.addLayer('DOOR', Drawing.ACI.MAGENTA, 'CONTINUOUS')
  dw.addLayer('CENTER', Drawing.ACI.RED, 'DASHED')
  dw.addLayer('DIMS', Drawing.ACI.YELLOW, 'CONTINUOUS')
  dw.addLayer('TEXT', Drawing.ACI.WHITE, 'CONTINUOUS')
  dw.addLayer('STOP', Drawing.ACI.GREEN, 'CONTINUOUS')

  const { shaft, car, rated_load_kg, rated_speed_mpm, machine_location } = design

  // ---- PLAN VIEW ----
  drawPlanView(dw, design, { x: 0, y: 0 })

  // ---- ELEVATION VIEW (右側) ----
  const elevOX = shaft.width_mm + 4000
  const elevOY = 0
  drawElevationView(dw, design, { x: elevOX, y: elevOY })

  // ---- SPEC BLOCK (最右, 對齊 plan view 頂端) ----
  const specX = elevOX + shaft.width_mm + 3500
  const specY = shaft.depth_mm + 500
  const specLines = [
    'CNS ELEVATOR DRAFT',
    '',
    `mode:       ${design.solver_mode}`,
    `usage:      ${shaft.usage}`,
    `load:       ${rated_load_kg} kg`,
    `speed:      ${rated_speed_mpm} m/min`,
    `stops:      ${shaft.stops}`,
    `machine:    ${machine_location}`,
    '',
    `shaft:      ${shaft.width_mm} x ${shaft.depth_mm}`,
    `height:     ${shaft.total_height_mm} mm`,
    `overhead:   ${shaft.overhead_mm} mm`,
    `pit:        ${shaft.pit_depth_mm} mm`,
    '',
    `car:        ${car.width_mm} x ${car.depth_mm} x ${car.height_mm}`,
    `area:       ${car.area_m2} m2`,
    `door:       ${design.door.width_mm} mm (${design.door.type})`,
    '',
    `generated:  ${design.generated_at.slice(0, 19)}Z`,
    `status:     DRAFT - engineer review required`,
  ]
  dw.setActiveLayer('TEXT')
  const specLineH = 220
  for (let i = 0; i < specLines.length; i++) {
    dw.drawText(specX, specY - i * specLineH, 140, 0, specLines[i])
  }

  return dw.toDxfString()
}

/**
 * 極簡版 elevation — 只畫 pit + 1F + 車廂 + 中斷符號。
 * 不再畫頂樓、overhead、H 標註 — 讓 elevation 高度接近 plan view 高度，
 * 保持兩圖視覺平衡。
 */
function drawElevationView(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number }
): void {
  const { shaft, car } = design
  const ox = origin.x
  const oy = origin.y

  const BREAK_HEADROOM = 600        // 車廂頂到第一道 zigzag 的距離
  const BREAK_GAP = 1200            // 兩條 zigzag 之間間距
  const TOP_MARGIN = 300            // 上方外框到第二道 zigzag 的距離

  const firstStopY = oy
  const carBottom = firstStopY + 100
  const carTop = carBottom + car.height_mm

  const zigBot = carTop + BREAK_HEADROOM
  const zigTop = zigBot + BREAK_GAP

  const shaftBottom = firstStopY - shaft.pit_depth_mm
  const shaftTop = zigTop + TOP_MARGIN

  // 井道外框（只含可見範圍）
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, shaftBottom, ox + shaft.width_mm, shaftTop)
  dw.drawLine(ox, firstStopY, ox + shaft.width_mm, firstStopY)

  // 中斷符號（zigzag 上下各一條）
  const zigStep = shaft.width_mm / 6
  for (const y of [zigBot, zigTop]) {
    const pts: Array<[number, number]> = []
    for (let i = 0; i <= 6; i++) {
      const dx = i * zigStep
      const dy = i % 2 === 0 ? -80 : 80
      pts.push([ox + dx, y + dy])
    }
    for (let i = 0; i < pts.length - 1; i++) {
      dw.setActiveLayer('STOP')
      dw.drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    }
  }

  // 1F 標籤
  dw.setActiveLayer('TEXT')
  dw.drawText(ox - 250, firstStopY, 140, 0, '1F', 'right')

  // 車廂立面
  const carInsetX = (shaft.width_mm - car.width_mm) / 2
  dw.setActiveLayer('CAR')
  dw.drawRect(
    ox + carInsetX,
    carBottom,
    ox + carInsetX + car.width_mm,
    carTop
  )

  // 尺寸標註 — 只保留 PIT
  dw.setActiveLayer('DIMS')
  dw.drawText(
    ox + shaft.width_mm + 350,
    firstStopY - shaft.pit_depth_mm / 2,
    120,
    0,
    `PIT ${shaft.pit_depth_mm}`
  )

  dw.setActiveLayer('TEXT')
  dw.drawText(
    ox + shaft.width_mm / 2,
    shaftBottom - 400,
    180,
    0,
    'ELEVATION VIEW / 側面圖',
    'center'
  )
}
