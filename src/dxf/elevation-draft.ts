import type { ElevatorDesign } from '../solver/types'

/**
 * 極簡版 elevation — 只畫 pit + 1F + 車廂 + 中斷符號。
 * 不再畫頂樓、overhead、H 標註 — 讓 elevation 高度接近 plan view 高度，
 * 保持兩圖視覺平衡。
 */
export function drawElevationDraft(
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

  // ---- OH / PIT 尺寸（業務最在意的兩個數字）----
  // Drawn prominently on the right side with dimension extension lines.
  dw.setActiveLayer('DIMS')
  const dimColX = ox + shaft.width_mm + 700
  const dimTextH = 180
  const dimArrowOff = 40

  // OH (Overhead): top floor → shaft ceiling.
  // Visible top of shaft = shaftTop. Top floor is hidden by zigzag break,
  // so we use shaftTop and shaftTop-ohVal as a labeled region (synthetic).
  const ohValue = shaft.overhead_mm
  const ohTopY = shaftTop
  const ohBotY = shaftTop - 800 // purely visual anchor within visible region
  // Extension lines
  dw.drawLine(ox + shaft.width_mm, ohTopY, dimColX + 200, ohTopY)
  dw.drawLine(ox + shaft.width_mm, ohBotY, dimColX + 200, ohBotY)
  // Dim line
  dw.drawLine(dimColX + 100, ohBotY, dimColX + 100, ohTopY)
  // Arrow ticks
  dw.drawLine(dimColX + 60, ohTopY - dimArrowOff, dimColX + 140, ohTopY)
  dw.drawLine(dimColX + 60, ohBotY + dimArrowOff, dimColX + 140, ohBotY)
  dw.drawText(
    dimColX + 250,
    (ohTopY + ohBotY) / 2,
    dimTextH,
    0,
    `OH = ${ohValue} mm`,
  )

  // PIT: 1F → shaft floor.
  const pitValue = shaft.pit_depth_mm
  dw.drawLine(ox + shaft.width_mm, firstStopY, dimColX + 200, firstStopY)
  dw.drawLine(ox + shaft.width_mm, shaftBottom, dimColX + 200, shaftBottom)
  dw.drawLine(dimColX + 100, shaftBottom, dimColX + 100, firstStopY)
  dw.drawLine(dimColX + 60, firstStopY - dimArrowOff, dimColX + 140, firstStopY)
  dw.drawLine(dimColX + 60, shaftBottom + dimArrowOff, dimColX + 140, shaftBottom)
  dw.drawText(
    dimColX + 250,
    (firstStopY + shaftBottom) / 2,
    dimTextH,
    0,
    `PIT = ${pitValue} mm`,
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
