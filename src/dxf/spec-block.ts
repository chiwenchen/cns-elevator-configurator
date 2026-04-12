import type { ElevatorDesign } from '../solver/types'

/**
 * Draws the spec block (design parameter text table) at the given origin.
 */
export function drawSpecBlock(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number }
): void {
  const { shaft, car, rated_load_kg, rated_speed_mpm, machine_location } = design
  const { x: specX, y: specY } = origin

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
}
