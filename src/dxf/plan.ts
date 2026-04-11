/**
 * Plan view — 平面圖繪製
 *
 * 畫出車廂、配重、導軌、門扇、中心線與所有標註。
 * 座標系：Y 向上（CAD 慣例）。
 *
 * 佈局（從後 / 低 Y 到前 / 高 Y）：
 *   [back wall 0] → back_clearance → [car] → front_clearance → [door / sill = shaft.depth_mm]
 *
 * 配重預設放在「後方」（後牆與車廂之間），靠左偏移。
 * 車廂導軌放在車廂左右兩側正中。
 *
 * 顏色配置（ACI）：見 README。
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'

// 固定幾何常數 — 之後 v1.1 可視需要抽成 config
const CWT_THICKNESS_MM = 120        // 配重框厚度
const CWT_WIDTH_MM = 700            // 配重框寬度
const CWT_BACK_OFFSET_MM = 40       // 配重與後牆 gap
const CAR_RAIL_SIZE_MM = 90         // 導軌外接方塊邊長（T 型簡化）
const CAR_RAIL_GAP_MM = 30          // 導軌與車廂外側 gap
const CWT_RAIL_SIZE_MM = 70
const DOOR_FRAME_DEPTH_MM = 100     // 門套深度（門框厚度）
const DOOR_LEAF_THICKNESS_MM = 30   // 門扇厚度
const SILL_DEPTH_MM = 90            // 門檻深度（進入車廂側的寬度）

export function drawPlanView(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number }
): { bbox: { minX: number; minY: number; maxX: number; maxY: number } } {
  const { shaft, car, door } = design
  const ox = origin.x
  const oy = origin.y

  // ---- 1. 井道外框 (SHAFT) ----
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, oy, ox + shaft.width_mm, oy + shaft.depth_mm)

  // ---- 2. 車廂位置 — 橫向置中, 前方留 150 mm sill 空間 ----
  const carDx = Math.round((shaft.width_mm - car.width_mm) / 2)
  const frontGap = 150
  const carDy = shaft.depth_mm - car.depth_mm - frontGap
  const backGap = carDy  // = shaft.depth - car.depth - frontGap

  dw.setActiveLayer('CAR')
  dw.drawRect(
    ox + carDx,
    oy + carDy,
    ox + carDx + car.width_mm,
    oy + carDy + car.depth_mm
  )

  // ---- 3. 配重（CWT）— 放後方, 靠左 ----
  const cwtX0 = ox + 250
  const cwtY0 = oy + CWT_BACK_OFFSET_MM
  dw.setActiveLayer('CWT')
  dw.drawRect(
    cwtX0,
    cwtY0,
    cwtX0 + CWT_WIDTH_MM,
    cwtY0 + CWT_THICKNESS_MM
  )
  // CWT 導軌 — 配重兩側小方塊
  dw.setActiveLayer('RAIL_CWT')
  const cwtRailY = cwtY0 + CWT_THICKNESS_MM / 2 - CWT_RAIL_SIZE_MM / 2
  dw.drawRect(
    cwtX0 - CWT_RAIL_SIZE_MM - 20,
    cwtRailY,
    cwtX0 - 20,
    cwtRailY + CWT_RAIL_SIZE_MM
  )
  dw.drawRect(
    cwtX0 + CWT_WIDTH_MM + 20,
    cwtRailY,
    cwtX0 + CWT_WIDTH_MM + 20 + CWT_RAIL_SIZE_MM,
    cwtRailY + CWT_RAIL_SIZE_MM
  )

  // ---- 4. 車廂導軌（左右兩側中心）----
  dw.setActiveLayer('RAIL_CAR')
  const carCenterY = carDy + car.depth_mm / 2
  const carRailHalf = CAR_RAIL_SIZE_MM / 2
  // 左側
  const leftRailX1 = ox + carDx - CAR_RAIL_GAP_MM - CAR_RAIL_SIZE_MM
  dw.drawRect(
    leftRailX1,
    oy + carCenterY - carRailHalf,
    leftRailX1 + CAR_RAIL_SIZE_MM,
    oy + carCenterY + carRailHalf
  )
  // 右側
  const rightRailX1 = ox + carDx + car.width_mm + CAR_RAIL_GAP_MM
  dw.drawRect(
    rightRailX1,
    oy + carCenterY - carRailHalf,
    rightRailX1 + CAR_RAIL_SIZE_MM,
    oy + carCenterY + carRailHalf
  )

  // ---- 5. 門（門框 + 門扇 + 門檻）----
  dw.setActiveLayer('DOOR')
  const doorX0 = ox + (shaft.width_mm - door.width_mm) / 2
  const sillY = oy + shaft.depth_mm
  // 門框左右（側向 post）
  dw.drawRect(
    doorX0 - DOOR_FRAME_DEPTH_MM,
    sillY - SILL_DEPTH_MM,
    doorX0,
    sillY
  )
  dw.drawRect(
    doorX0 + door.width_mm,
    sillY - SILL_DEPTH_MM,
    doorX0 + door.width_mm + DOOR_FRAME_DEPTH_MM,
    sillY
  )
  // 門檻（sill）— 橫貫門口
  dw.drawLine(
    doorX0 - DOOR_FRAME_DEPTH_MM,
    sillY - SILL_DEPTH_MM,
    doorX0 + door.width_mm + DOOR_FRAME_DEPTH_MM,
    sillY - SILL_DEPTH_MM
  )
  // 門扇 — center-opening 雙扇
  if (door.type === 'center_opening') {
    const leafW = door.width_mm / 2
    // 左扇
    dw.drawRect(
      doorX0,
      sillY - DOOR_LEAF_THICKNESS_MM,
      doorX0 + leafW,
      sillY
    )
    // 右扇
    dw.drawRect(
      doorX0 + leafW,
      sillY - DOOR_LEAF_THICKNESS_MM,
      doorX0 + door.width_mm,
      sillY
    )
  } else {
    // side_opening — 單扇靠左
    dw.drawRect(
      doorX0,
      sillY - DOOR_LEAF_THICKNESS_MM,
      doorX0 + door.width_mm,
      sillY
    )
  }

  // ---- 6. 中心線（dashed, 穿過車廂）----
  dw.setActiveLayer('CENTER')
  const cx = ox + shaft.width_mm / 2
  dw.drawLine(cx, oy - 200, cx, oy + shaft.depth_mm + 200)
  dw.drawLine(ox - 200, oy + carCenterY, ox + shaft.width_mm + 200, oy + carCenterY)

  // ---- 7. 尺寸標註 ----
  dw.setActiveLayer('DIMS')
  const dimH = 120
  const dimOff = 350
  // 井道寬 (bottom)
  dw.drawText(
    ox + shaft.width_mm / 2,
    oy - dimOff,
    dimH,
    0,
    `W ${shaft.width_mm}`,
    'center'
  )
  // 井道深 (left, rotated)
  dw.drawText(
    ox - dimOff,
    oy + shaft.depth_mm / 2,
    dimH,
    90,
    `D ${shaft.depth_mm}`,
    'center'
  )
  // 車廂寬 (AA, 內部上方)
  dw.drawText(
    ox + carDx + car.width_mm / 2,
    oy + carDy + car.depth_mm - 180,
    90,
    0,
    `AA=${car.width_mm}`,
    'center'
  )
  // 車廂深 (BB, 內部左側, rotated)
  dw.drawText(
    ox + carDx + 180,
    oy + carDy + car.depth_mm / 2,
    90,
    90,
    `BB=${car.depth_mm}`,
    'center'
  )
  // 門開口 (JJ, door 下方)
  dw.drawText(
    ox + shaft.width_mm / 2,
    sillY + dimOff,
    110,
    0,
    `JJ=${door.width_mm}`,
    'center'
  )
  // 後方 clearance (配重區)
  dw.drawText(
    ox - dimOff,
    oy + backGap / 2,
    80,
    90,
    `${backGap}`,
    'center'
  )
  // 前方 clearance
  dw.drawText(
    ox - dimOff,
    oy + carDy + car.depth_mm + frontGap / 2,
    80,
    90,
    `${frontGap}`,
    'center'
  )
  // 側向 clearance (左)
  dw.drawText(
    ox + carDx / 2,
    oy - dimOff,
    80,
    0,
    `${carDx}`,
    'center'
  )
  // 側向 clearance (右)
  dw.drawText(
    ox + carDx + car.width_mm + (shaft.width_mm - carDx - car.width_mm) / 2,
    oy - dimOff,
    80,
    0,
    `${shaft.width_mm - carDx - car.width_mm}`,
    'center'
  )

  // 元件標籤（內嵌提示字）
  dw.setActiveLayer('TEXT')
  dw.drawText(cwtX0 + CWT_WIDTH_MM / 2, cwtY0 + CWT_THICKNESS_MM / 2, 70, 0, 'CWT', 'center')

  // PLAN VIEW 標題
  dw.drawText(
    ox + shaft.width_mm / 2,
    oy - dimOff - 600,
    180,
    0,
    'PLAN VIEW / 平面圖',
    'center'
  )

  return {
    bbox: {
      minX: ox - dimOff - 300,
      minY: oy - dimOff - 900,
      maxX: ox + shaft.width_mm + dimOff + 300,
      maxY: oy + shaft.depth_mm + dimOff + 300,
    },
  }
}
