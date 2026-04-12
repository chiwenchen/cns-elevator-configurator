/**
 * Plan view — drawn from EffectiveConfig (Milestone 1b+).
 *
 * All numeric values now come from config. No module-level geometry constants.
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'

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

  // ---- 3. CWT ----
  const cwtX0 = ox + cwtCfg.left_offset_mm
  const cwtY0 = oy + cwtCfg.back_offset_mm
  dw.setActiveLayer('CWT')
  dw.drawRect(
    cwtX0,
    cwtY0,
    cwtX0 + cwtCfg.width_mm,
    cwtY0 + cwtCfg.thickness_mm,
  )
  // CWT rails
  dw.setActiveLayer('RAIL_CWT')
  const cwtRailY = cwtY0 + cwtCfg.thickness_mm / 2 - railCfg.cwt_size_mm / 2
  dw.drawRect(
    cwtX0 - railCfg.cwt_size_mm - railCfg.cwt_gap_mm,
    cwtRailY,
    cwtX0 - railCfg.cwt_gap_mm,
    cwtRailY + railCfg.cwt_size_mm,
  )
  dw.drawRect(
    cwtX0 + cwtCfg.width_mm + railCfg.cwt_gap_mm,
    cwtRailY,
    cwtX0 + cwtCfg.width_mm + railCfg.cwt_gap_mm + railCfg.cwt_size_mm,
    cwtRailY + railCfg.cwt_size_mm,
  )

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

  // ---- 6. Center lines ----
  dw.setActiveLayer('CENTER')
  const cx = ox + shaft.width_mm / 2
  dw.drawLine(cx, oy - 200, cx, oy + shaft.depth_mm + 200)
  dw.drawLine(ox - 200, oy + carCenterY, ox + shaft.width_mm + 200, oy + carCenterY)

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

  // Component labels
  dw.setActiveLayer('TEXT')
  dw.drawText(
    cwtX0 + cwtCfg.width_mm / 2,
    cwtY0 + cwtCfg.thickness_mm / 2,
    70,
    0,
    'CWT',
    'center',
  )

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
