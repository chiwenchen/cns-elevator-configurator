/**
 * Professional plan view — draws additional engineering components
 * ON TOP of the draft plan view.
 *
 * Components:
 *   1. Wall thickness (outer rectangle)
 *   2. Car sling/frame (4 beams)
 *   3. Guide shoes ×4
 *   4. Landing door (mirror of car door)
 *   5. Rope position marks
 *   6. Traveling cable mark
 */

import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, ProfessionalConfig } from '../config/types'

export function drawPlanProfessional(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  pro: ProfessionalConfig,
  config: EffectiveConfig,
): void {
  const { shaft, car, door } = design
  const ox = origin.x
  const oy = origin.y

  const carDx = ox + (shaft.width_mm - car.width_mm) / 2
  const carDy = oy + config.clearance.back_mm

  // ---- 1. Wall thickness ----
  drawWallThickness(dw, ox, oy, shaft, pro.wall_thickness_mm)

  // ---- 2. Car sling/frame ----
  drawCarSling(dw, carDx, carDy, car, pro)

  // ---- 3. Guide shoes ×4 ----
  drawGuideShoes(dw, carDx, carDy, car, config, pro)

  // ---- 4. Landing door ----
  drawLandingDoor(dw, ox, oy, shaft, door, config)

  // ---- 5. Rope position marks ----
  drawRopeMarks(dw, carDx, carDy, car, design.rated_load_kg, pro)

  // ---- 6. Traveling cable mark ----
  drawTravelingCable(dw, carDx, carDy, car, pro)
}

// ---- Component helpers ----

function drawWallThickness(
  dw: any,
  ox: number,
  oy: number,
  shaft: ElevatorDesign['shaft'],
  wallThickness: number,
): void {
  dw.setActiveLayer('WALL')
  dw.drawRect(
    ox - wallThickness,
    oy - wallThickness,
    ox + shaft.width_mm + wallThickness,
    oy + shaft.depth_mm + wallThickness,
  )
}

function drawCarSling(
  dw: any,
  carDx: number,
  carDy: number,
  car: ElevatorDesign['car'],
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('SLING')

  const off = pro.sling_offset_mm
  const t = pro.sling_thickness_mm

  const slingLeft = carDx - off
  const slingRight = carDx + car.width_mm + off
  const slingBottom = carDy - off
  const slingTop = carDy + car.depth_mm + off

  // Crosshead (top beam)
  dw.drawRect(slingLeft, slingTop - t, slingRight, slingTop)
  // Bolster (bottom beam)
  dw.drawRect(slingLeft, slingBottom, slingRight, slingBottom + t)
  // Left stile
  dw.drawRect(slingLeft, slingBottom, slingLeft + t, slingTop)
  // Right stile
  dw.drawRect(slingRight - t, slingBottom, slingRight, slingTop)
}

function drawGuideShoes(
  dw: any,
  carDx: number,
  carDy: number,
  car: ElevatorDesign['car'],
  config: EffectiveConfig,
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('SLING')

  const off = pro.sling_offset_mm
  const shoeW = pro.guide_shoe_width_mm
  const shoeD = pro.guide_shoe_depth_mm

  // Rail X positions (from plan.ts logic)
  const railXLeft =
    carDx - config.rail.car_gap_mm - config.rail.car_size_mm + config.rail.car_size_mm / 2
  const railXRight =
    carDx + car.width_mm + config.rail.car_gap_mm + config.rail.car_size_mm / 2

  // Sling Y positions
  const crossheadY = carDy + car.depth_mm + off
  const bolsterY = carDy - off

  // Guide shoes centered on rail X, at crosshead (top 2) and bolster (bottom 2)
  const shoePositions = [
    { cx: railXLeft, cy: crossheadY },
    { cx: railXRight, cy: crossheadY },
    { cx: railXLeft, cy: bolsterY },
    { cx: railXRight, cy: bolsterY },
  ]

  for (const pos of shoePositions) {
    dw.drawRect(
      pos.cx - shoeW / 2,
      pos.cy - shoeD / 2,
      pos.cx + shoeW / 2,
      pos.cy + shoeD / 2,
    )
  }

  // Schematic label
  dw.setActiveLayer('TEXT')
  dw.drawText(railXRight + shoeW / 2 + 50, crossheadY, 60, 0, '示意')
}

function drawLandingDoor(
  dw: any,
  ox: number,
  oy: number,
  shaft: ElevatorDesign['shaft'],
  door: ElevatorDesign['door'],
  config: EffectiveConfig,
): void {
  dw.setActiveLayer('LANDING')

  const doorCfg = config.door
  const doorX0 = ox + (shaft.width_mm - door.width_mm) / 2
  const outerWallY = oy + shaft.depth_mm

  // Frame posts (mirrored on outer side)
  dw.drawRect(
    doorX0 - doorCfg.frame_depth_mm,
    outerWallY,
    doorX0,
    outerWallY + doorCfg.sill_depth_mm,
  )
  dw.drawRect(
    doorX0 + door.width_mm,
    outerWallY,
    doorX0 + door.width_mm + doorCfg.frame_depth_mm,
    outerWallY + doorCfg.sill_depth_mm,
  )

  // Sill line
  dw.drawLine(
    doorX0 - doorCfg.frame_depth_mm,
    outerWallY + doorCfg.sill_depth_mm,
    doorX0 + door.width_mm + doorCfg.frame_depth_mm,
    outerWallY + doorCfg.sill_depth_mm,
  )

  // Leaves (mirror)
  if (door.type === 'center_opening') {
    const leafW = door.width_mm / 2
    dw.drawRect(doorX0, outerWallY, doorX0 + leafW, outerWallY + doorCfg.leaf_thickness_mm)
    dw.drawRect(
      doorX0 + leafW,
      outerWallY,
      doorX0 + door.width_mm,
      outerWallY + doorCfg.leaf_thickness_mm,
    )
  } else {
    dw.drawRect(doorX0, outerWallY, doorX0 + door.width_mm, outerWallY + doorCfg.leaf_thickness_mm)
  }
}

function drawRopeMarks(
  dw: any,
  carDx: number,
  carDy: number,
  car: ElevatorDesign['car'],
  ratedLoadKg: number,
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('ROPE')

  const ropeCount = ratedLoadKg <= 1000 ? 3 : 4
  const crossheadY = carDy + car.depth_mm + pro.sling_offset_mm
  const ropeY = crossheadY + 30 // slightly above crosshead
  const carCenterX = carDx + car.width_mm / 2
  const spacing = 30

  // Center the rope group
  const groupWidth = (ropeCount - 1) * spacing
  const startX = carCenterX - groupWidth / 2

  for (let i = 0; i < ropeCount; i++) {
    dw.drawCircle(startX + i * spacing, ropeY, 5) // Ø10mm symbol → radius 5
  }
}

function drawTravelingCable(
  dw: any,
  carDx: number,
  carDy: number,
  car: ElevatorDesign['car'],
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('ROPE')

  const slingLeft = carDx - pro.sling_offset_mm
  const midY = carDy + car.depth_mm / 2

  dw.drawCircle(slingLeft - 30, midY, 7.5) // Ø15mm → radius 7.5

  dw.setActiveLayer('TEXT')
  dw.drawText(slingLeft - 30, midY - 20, 50, 0, 'TC')
  dw.drawText(slingLeft - 30, midY - 80, 40, 0, '示意')
}
