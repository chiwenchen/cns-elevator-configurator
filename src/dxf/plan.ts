/**
 * Plan view — drawn from EffectiveConfig (Milestone 1b+).
 *
 * All numeric values now come from config. No module-level geometry constants.
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, CwtPosition } from '../config/types'

interface RectXY {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface CwtPlacement {
  cwt: RectXY
  rails: [RectXY, RectXY]
}

/**
 * Compute CWT + rail rectangles in plan-view coordinate space.
 *
 * Coordinate system: Y up, back wall at Y=0, front wall at Y=shaft.depth_mm,
 * left wall at X=0, right wall at X=shaft.width_mm. Origin offset NOT applied
 * here — the caller adds ox/oy afterwards.
 *
 * Five positions:
 *   back_left / back_center / back_right — CWT along the back wall,
 *     rails flanking left/right of the CWT rectangle.
 *   side_left / side_right — CWT rotated 90° along the side wall,
 *     rails flanking above/below the CWT rectangle.
 */
export function computeCwtPlacement(
  shaft: { width_mm: number; depth_mm: number },
  cwtCfg: EffectiveConfig['cwt'],
  railCfg: EffectiveConfig['rail'],
  position: CwtPosition,
): CwtPlacement {
  const w = cwtCfg.width_mm
  const t = cwtCfg.thickness_mm
  const backOff = cwtCfg.back_offset_mm
  const leftOff = cwtCfg.left_offset_mm
  const railSize = railCfg.cwt_size_mm
  const railGap = railCfg.cwt_gap_mm

  if (position === 'back_left' || position === 'back_center' || position === 'back_right') {
    let x0: number
    if (position === 'back_left') {
      x0 = leftOff
    } else if (position === 'back_center') {
      x0 = (shaft.width_mm - w) / 2
    } else {
      x0 = shaft.width_mm - leftOff - w
    }
    const y0 = backOff
    const cwt: RectXY = { x0, y0, x1: x0 + w, y1: y0 + t }

    // Rails flank CWT along X axis (rail rectangles are squares of railSize)
    const railYMid = y0 + t / 2
    const railY0 = railYMid - railSize / 2
    const railY1 = railYMid + railSize / 2
    const leftRail: RectXY = {
      x0: x0 - railGap - railSize,
      y0: railY0,
      x1: x0 - railGap,
      y1: railY1,
    }
    const rightRail: RectXY = {
      x0: x0 + w + railGap,
      y0: railY0,
      x1: x0 + w + railGap + railSize,
      y1: railY1,
    }
    return { cwt, rails: [leftRail, rightRail] }
  }

  // Side positions: CWT is rotated 90° — width runs along Y axis, thickness
  // along X axis. Rails flank it above/below along Y axis.
  const y0 = (shaft.depth_mm - w) / 2
  const y1 = y0 + w
  let x0: number
  let x1: number
  if (position === 'side_left') {
    x0 = backOff
    x1 = backOff + t
  } else {
    // side_right — mirror of side_left
    x0 = shaft.width_mm - backOff - t
    x1 = shaft.width_mm - backOff
  }
  const cwt: RectXY = { x0, y0, x1, y1 }

  const railXMid = (x0 + x1) / 2
  const railX0 = railXMid - railSize / 2
  const railX1 = railXMid + railSize / 2
  const bottomRail: RectXY = {
    x0: railX0,
    y0: y0 - railGap - railSize,
    x1: railX1,
    y1: y0 - railGap,
  }
  const topRail: RectXY = {
    x0: railX0,
    y0: y1 + railGap,
    x1: railX1,
    y1: y1 + railGap + railSize,
  }
  return { cwt, rails: [bottomRail, topRail] }
}

export function drawPlanView(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  config: EffectiveConfig,
): { bbox: { minX: number; minY: number; maxX: number; maxY: number } } {
  const { shaft, car, door } = design
  const ox = origin.x
  const oy = origin.y

  const cwtCfg = config.cwt
  const railCfg = config.rail
  const doorCfg = config.door
  const frontGap = config.clearance.front_mm

  // ---- 1. Shaft outline ----
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, oy, ox + shaft.width_mm, oy + shaft.depth_mm)

  // ---- 2. Car position ----
  const carDx = Math.round((shaft.width_mm - car.width_mm) / 2)
  const carDy = shaft.depth_mm - car.depth_mm - frontGap
  const backGap = carDy

  dw.setActiveLayer('CAR')
  dw.drawRect(
    ox + carDx,
    oy + carDy,
    ox + carDx + car.width_mm,
    oy + carDy + car.depth_mm,
  )

  // ---- 3. CWT + CWT rails (position-aware) ----
  const placement = computeCwtPlacement(
    { width_mm: shaft.width_mm, depth_mm: shaft.depth_mm },
    cwtCfg,
    railCfg,
    config.cwt.position,
  )
  dw.setActiveLayer('CWT')
  dw.drawRect(
    ox + placement.cwt.x0,
    oy + placement.cwt.y0,
    ox + placement.cwt.x1,
    oy + placement.cwt.y1,
  )
  dw.setActiveLayer('RAIL_CWT')
  for (const rail of placement.rails) {
    dw.drawRect(ox + rail.x0, oy + rail.y0, ox + rail.x1, oy + rail.y1)
  }

  // ---- 4. Car rails ----
  dw.setActiveLayer('RAIL_CAR')
  const carCenterY = carDy + car.depth_mm / 2
  const carRailHalf = railCfg.car_size_mm / 2
  const leftRailX1 = ox + carDx - railCfg.car_gap_mm - railCfg.car_size_mm
  dw.drawRect(
    leftRailX1,
    oy + carCenterY - carRailHalf,
    leftRailX1 + railCfg.car_size_mm,
    oy + carCenterY + carRailHalf,
  )
  const rightRailX1 = ox + carDx + car.width_mm + railCfg.car_gap_mm
  dw.drawRect(
    rightRailX1,
    oy + carCenterY - carRailHalf,
    rightRailX1 + railCfg.car_size_mm,
    oy + carCenterY + carRailHalf,
  )

  // ---- 5. Door + frame + sill ----
  dw.setActiveLayer('DOOR')
  const doorX0 = ox + (shaft.width_mm - door.width_mm) / 2
  const sillY = oy + shaft.depth_mm
  // Frame posts
  dw.drawRect(
    doorX0 - doorCfg.frame_depth_mm,
    sillY - doorCfg.sill_depth_mm,
    doorX0,
    sillY,
  )
  dw.drawRect(
    doorX0 + door.width_mm,
    sillY - doorCfg.sill_depth_mm,
    doorX0 + door.width_mm + doorCfg.frame_depth_mm,
    sillY,
  )
  // Sill line
  dw.drawLine(
    doorX0 - doorCfg.frame_depth_mm,
    sillY - doorCfg.sill_depth_mm,
    doorX0 + door.width_mm + doorCfg.frame_depth_mm,
    sillY - doorCfg.sill_depth_mm,
  )
  // Leaves
  if (door.type === 'center_opening') {
    const leafW = door.width_mm / 2
    dw.drawRect(
      doorX0,
      sillY - doorCfg.leaf_thickness_mm,
      doorX0 + leafW,
      sillY,
    )
    dw.drawRect(
      doorX0 + leafW,
      sillY - doorCfg.leaf_thickness_mm,
      doorX0 + door.width_mm,
      sillY,
    )
  } else {
    dw.drawRect(
      doorX0,
      sillY - doorCfg.leaf_thickness_mm,
      doorX0 + door.width_mm,
      sillY,
    )
  }

  // ---- 6. Center lines (industry standard: C CAR + C CWT) ----
  dw.setActiveLayer('CENTER')
  // C CAR vertical — car centerline runs front-to-back through shaft
  const cx = ox + shaft.width_mm / 2
  dw.drawLine(cx, oy - 400, cx, oy + shaft.depth_mm + 400)
  // Horizontal through car center (depth axis)
  dw.drawLine(ox - 400, oy + carCenterY, ox + shaft.width_mm + 400, oy + carCenterY)

  // C CWT — centerline through the counterweight rectangle
  const cwtCx = ox + (placement.cwt.x0 + placement.cwt.x1) / 2
  const cwtCy = oy + (placement.cwt.y0 + placement.cwt.y1) / 2
  // Draw short cross at CWT center (both axes), stopping near shaft walls
  dw.drawLine(
    Math.max(ox - 400, cwtCx - 800),
    cwtCy,
    Math.min(ox + shaft.width_mm + 400, cwtCx + 800),
    cwtCy,
  )
  dw.drawLine(
    cwtCx,
    Math.max(oy - 400, cwtCy - 600),
    cwtCx,
    Math.min(oy + shaft.depth_mm + 400, cwtCy + 600),
  )

  // Centerline labels — Ç (C with bar) is the standard drafting mark.
  dw.setActiveLayer('TEXT')
  dw.drawText(cx, oy + shaft.depth_mm + 450, 90, 0, 'Ç CAR', 'center')
  dw.drawText(
    cwtCx + 150,
    cwtCy + 650,
    70,
    0,
    'Ç CWT',
    'left',
  )

  // ---- 7. Dimensions ----
  dw.setActiveLayer('DIMS')
  const dimH = 120
  const dimOff = 350
  dw.drawText(ox + shaft.width_mm / 2, oy - dimOff, dimH, 0, `W ${shaft.width_mm}`, 'center')
  dw.drawText(ox - dimOff, oy + shaft.depth_mm / 2, dimH, 90, `D ${shaft.depth_mm}`, 'center')
  dw.drawText(
    ox + carDx + car.width_mm / 2,
    oy + carDy + car.depth_mm - 180,
    90,
    0,
    `AA=${car.width_mm}`,
    'center',
  )
  dw.drawText(
    ox + carDx + 180,
    oy + carDy + car.depth_mm / 2,
    90,
    90,
    `BB=${car.depth_mm}`,
    'center',
  )
  dw.drawText(
    ox + shaft.width_mm / 2,
    sillY + dimOff,
    110,
    0,
    `JJ=${door.width_mm}`,
    'center',
  )
  dw.drawText(ox - dimOff, oy + backGap / 2, 80, 90, `${backGap}`, 'center')
  dw.drawText(
    ox - dimOff,
    oy + carDy + car.depth_mm + frontGap / 2,
    80,
    90,
    `${frontGap}`,
    'center',
  )
  dw.drawText(ox + carDx / 2, oy - dimOff, 80, 0, `${carDx}`, 'center')
  dw.drawText(
    ox + carDx + car.width_mm + (shaft.width_mm - carDx - car.width_mm) / 2,
    oy - dimOff,
    80,
    0,
    `${shaft.width_mm - carDx - car.width_mm}`,
    'center',
  )

  // Component labels — centered on actual CWT placement
  dw.setActiveLayer('TEXT')
  const cwtLabelX = ox + (placement.cwt.x0 + placement.cwt.x1) / 2
  const cwtLabelY = oy + (placement.cwt.y0 + placement.cwt.y1) / 2
  dw.drawText(cwtLabelX, cwtLabelY, 70, 0, 'CWT', 'center')

  // Title
  dw.drawText(
    ox + shaft.width_mm / 2,
    oy - dimOff - 600,
    180,
    0,
    'PLAN VIEW / 平面圖',
    'center',
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
