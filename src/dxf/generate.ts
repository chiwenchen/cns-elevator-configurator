/**
 * Parametric DXF Writer — production 版本
 *
 * 由 spikes/spike-4-dxf-writer/generate.ts 的 POC 提升而來。
 * 接受 ElevatorDesign，產出含平面圖 + 側面圖 + 規格卡的 DXF 字串。
 *
 * 純函式，無 side effects，可單元測試。
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'

/**
 * 從 ElevatorDesign 產生 DXF 字串（平面 + 側面 + 規格卡）
 */
export function generateElevatorDXF(design: ElevatorDesign): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')

  dw.addLayer('SHAFT', Drawing.ACI.WHITE, 'CONTINUOUS')
  dw.addLayer('CAR', Drawing.ACI.YELLOW, 'CONTINUOUS')
  dw.addLayer('DOOR', Drawing.ACI.CYAN, 'CONTINUOUS')
  dw.addLayer('STOP', Drawing.ACI.GREEN, 'CONTINUOUS')
  dw.addLayer('DIMS', Drawing.ACI.MAGENTA, 'CONTINUOUS')
  dw.addLayer('TEXT', Drawing.ACI.WHITE, 'CONTINUOUS')

  const { shaft, car, door, rated_load_kg, rated_speed_mpm, machine_location } = design

  // ---- PLAN VIEW ----
  const planOX = 0
  const planOY = 0

  dw.setActiveLayer('SHAFT')
  dw.drawRect(planOX, planOY, planOX + shaft.width_mm, planOY + shaft.depth_mm)

  const carDx = (shaft.width_mm - car.width_mm) / 2
  const carDy = shaft.depth_mm - car.depth_mm - 150

  dw.setActiveLayer('CAR')
  dw.drawRect(
    planOX + carDx,
    planOY + carDy,
    planOX + carDx + car.width_mm,
    planOY + carDy + car.depth_mm
  )

  const doorX0 = planOX + (shaft.width_mm - door.width_mm) / 2
  const doorY = planOY + shaft.depth_mm
  dw.setActiveLayer('DOOR')
  dw.drawLine(doorX0, doorY - 100, doorX0, doorY + 100)
  dw.drawLine(
    doorX0 + door.width_mm,
    doorY - 100,
    doorX0 + door.width_mm,
    doorY + 100
  )
  dw.drawLine(doorX0, doorY, doorX0 + door.width_mm, doorY)

  // Plan dimensions
  dw.setActiveLayer('DIMS')
  const dimOff = 250
  dw.drawText(
    planOX + shaft.width_mm / 2,
    planOY - dimOff,
    120,
    0,
    `W ${shaft.width_mm}`,
    'center'
  )
  dw.drawText(
    planOX - dimOff,
    planOY + shaft.depth_mm / 2,
    120,
    90,
    `D ${shaft.depth_mm}`,
    'center'
  )
  dw.drawText(
    planOX + shaft.width_mm / 2,
    planOY + carDy + car.depth_mm / 2,
    90,
    0,
    `car ${car.width_mm}x${car.depth_mm}`,
    'center'
  )
  dw.drawText(
    planOX + shaft.width_mm / 2,
    doorY + dimOff,
    100,
    0,
    `door ${door.width_mm}`,
    'center'
  )

  dw.setActiveLayer('TEXT')
  dw.drawText(
    planOX + shaft.width_mm / 2,
    planOY - dimOff - 400,
    180,
    0,
    'PLAN VIEW / 平面圖',
    'center'
  )

  // ---- ELEVATION VIEW ----
  const elevOX = shaft.width_mm + 3500
  const elevOY = 0

  const shaftBottom = elevOY - shaft.pit_depth_mm
  const shaftTop = elevOY + shaft.total_height_mm + shaft.overhead_mm

  dw.setActiveLayer('SHAFT')
  dw.drawRect(elevOX, shaftBottom, elevOX + shaft.width_mm, shaftTop)

  dw.drawLine(elevOX, elevOY, elevOX + shaft.width_mm, elevOY)

  dw.setActiveLayer('STOP')
  const stopSpacing = shaft.total_height_mm / (shaft.stops - 1)
  for (let i = 0; i < shaft.stops; i++) {
    const y = elevOY + i * stopSpacing
    dw.drawLine(elevOX, y, elevOX + shaft.width_mm, y)
    dw.setActiveLayer('TEXT')
    dw.drawText(elevOX - 250, y, 100, 0, `${i + 1}F`, 'right')
    dw.setActiveLayer('STOP')
  }

  const carInsetX = (shaft.width_mm - car.width_mm) / 2
  dw.setActiveLayer('CAR')
  dw.drawRect(
    elevOX + carInsetX,
    elevOY + 100,
    elevOX + carInsetX + car.width_mm,
    elevOY + 100 + car.height_mm
  )

  dw.setActiveLayer('DIMS')
  dw.drawText(
    elevOX + shaft.width_mm + 350,
    elevOY + shaft.total_height_mm + shaft.overhead_mm / 2,
    120,
    0,
    `OH ${shaft.overhead_mm}`
  )
  dw.drawText(
    elevOX + shaft.width_mm + 350,
    elevOY - shaft.pit_depth_mm / 2,
    120,
    0,
    `PIT ${shaft.pit_depth_mm}`
  )
  dw.drawText(
    elevOX + shaft.width_mm + 1400,
    elevOY + (shaftTop - shaftBottom) / 2 + shaftBottom,
    140,
    90,
    `H ${shaft.total_height_mm + shaft.overhead_mm + shaft.pit_depth_mm}`,
    'center'
  )

  dw.setActiveLayer('TEXT')
  dw.drawText(
    elevOX + shaft.width_mm / 2,
    shaftBottom - 400,
    180,
    0,
    'ELEVATION VIEW / 側面圖',
    'center'
  )

  // ---- SPEC BLOCK ----
  const specX = elevOX + shaft.width_mm + 3500
  const specY = shaftTop
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
    `door:       ${door.width_mm} mm (${door.type})`,
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
