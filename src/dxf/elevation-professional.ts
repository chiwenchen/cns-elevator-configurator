/**
 * Professional side-section elevation.
 *
 * Industry-standard cut: perpendicular to the front wall (the door side),
 * viewed from the left side of the shaft. Horizontal axis runs along the
 * shaft DEPTH — back wall on the left at x=0, front wall (with door
 * openings at each floor) at x = shaft.depth_mm.
 *
 * Content (mirrors what JFI / Mitsubishi / Schindler side sections show):
 *   - Full shaft outline: pit → 1F → zigzag break → top floor → ceiling
 *   - Door opening profile at 1F, 2F, and top floor
 *   - Car at 1F (in the front half of the shaft, near the door wall)
 *   - CWT behind the car (back wall side) for back_* positions
 *   - Car + CWT buffers in pit; safety gear under the car
 *   - Traction machine + sheave + governor at the top
 *   - Suspension ropes (car → sheave → CWT)
 *   - Rail brackets at each floor
 *   - OH + PIT prominent dimensions
 *   - BY OTHERS / BY VENDOR callouts (hoist beam, embed plates, machine)
 */

import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, ProfessionalConfig, BufferType } from '../config/types'

function resolveBufferType(speed: number, override: BufferType): 'spring' | 'oil' {
  if (override !== 'auto') return override
  return speed <= 60 ? 'spring' : 'oil'
}

function drawSpringZigzag(
  dw: any,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const segments = 6
  const segH = h / segments
  const midX = x + w / 2
  const amplitude = w * 0.3
  for (let i = 0; i < segments; i++) {
    const y1 = y + i * segH
    const y2 = y + (i + 1) * segH
    const x1 = i % 2 === 0 ? midX - amplitude : midX + amplitude
    const x2 = i % 2 === 0 ? midX + amplitude : midX - amplitude
    dw.drawLine(x1, y1, x2, y2)
  }
}

export function drawElevationProfessional(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  pro: ProfessionalConfig,
  config: EffectiveConfig,
): void {
  const { shaft, car } = design
  const ox = origin.x
  const oy = origin.y
  const sd = shaft.depth_mm

  // --- Vertical layout (1F at oy, pit below, overhead + floors above) ---
  // When the car is parked at 1F, its floor is level with the 1F landing
  // floor. No offset above firstFloorY.
  const firstFloorY = oy
  const pitBottom = firstFloorY - shaft.pit_depth_mm
  const carBottom = firstFloorY
  const carTop = carBottom + car.height_mm

  const BREAK_HEADROOM = 600
  const BREAK_GAP = 1200
  const TOP_FLOOR_HEIGHT = 1500  // visible slice of top floor above the break

  const zigBot = carTop + BREAK_HEADROOM
  const zigTop = zigBot + BREAK_GAP
  const topFloorY = zigTop + TOP_FLOOR_HEIGHT
  const shaftTop = topFloorY + shaft.overhead_mm

  // --- Car depth-direction placement (mirror of plan view logic) ---
  const frontGap = config.clearance.front_mm
  const carInsetX = sd - car.depth_mm - frontGap  // gap from back wall to car back
  const carFrontX = carInsetX + car.depth_mm      // car's front-wall-facing edge

  // Door / wall constants
  const hh = 2100
  const wallThickness = 150
  const sheaveR = pro.sheave_diameter_mm / 2

  // ── 1. Shaft outline ──
  // The zigzag break hides all middle floors. We only render the lowest
  // floor (1F) and the top floor. LANDING layer is used for the 1F landing
  // sill to distinguish it from floor lines.
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, pitBottom, ox + sd, shaftTop)
  dw.drawLine(ox, firstFloorY, ox + sd, firstFloorY)
  dw.drawLine(ox, topFloorY, ox + sd, topFloorY)
  // Emphasize the 1F landing sill on LANDING layer (distinct color/weight).
  dw.setActiveLayer('LANDING')
  dw.drawLine(ox + sd - wallThickness, firstFloorY, ox + sd, firstFloorY)

  // ── 2. Zigzag break symbols ──
  const zigStep = sd / 6
  dw.setActiveLayer('STOP')
  for (const baseY of [zigBot, zigTop]) {
    for (let i = 0; i < 6; i++) {
      const x1 = ox + i * zigStep
      const x2 = ox + (i + 1) * zigStep
      const y1 = baseY + (i % 2 === 0 ? -80 : 80)
      const y2 = baseY + (i % 2 === 0 ? 80 : -80)
      dw.drawLine(x1, y1, x2, y2)
    }
  }

  // ── 3. Door openings on the right (front) wall at every visible floor ──
  function drawDoorAt(floorY: number): void {
    dw.setActiveLayer('DOOR')
    dw.drawLine(ox + sd - wallThickness, floorY, ox + sd, floorY)
    dw.drawLine(ox + sd - wallThickness, floorY + hh, ox + sd, floorY + hh)
    dw.drawLine(ox + sd - wallThickness, floorY, ox + sd - wallThickness, floorY + hh)
    // HH dim per floor (small)
    dw.setActiveLayer('DIMS')
    dw.drawText(ox + sd + 80, floorY + hh / 2, 70, 0, `HH ${hh}`)
  }
  drawDoorAt(firstFloorY)
  drawDoorAt(topFloorY)

  // ── 4. Floor labels ──
  dw.setActiveLayer('TEXT')
  dw.drawText(ox - 250, firstFloorY, 140, 0, '1F', 'right')
  dw.drawText(ox - 250, topFloorY, 140, 0, `${shaft.stops}F`, 'right')

  // ── 5. Car at 1F ──
  dw.setActiveLayer('CAR')
  dw.drawRect(ox + carInsetX, carBottom, ox + carFrontX, carTop)

  // ── 6. CWT (back position — drawn in the OVERHEAD zone) ──
  // When the car sits at 1F (lowest), the CWT is at its highest position —
  // above the top floor, inside the OH (overhead) zone. This avoids the
  // zigzag break entirely and reflects real rope-linked geometry.
  //
  // Dimensions come from rules as-is (no display-only inflation), so what
  // is shown matches what will be calculated/built.
  const cwtPos = config.cwt.position
  const isBack = cwtPos.startsWith('back_')
  const cwtThickness = config.cwt.thickness_mm
  const cwtBackOff = config.cwt.back_offset_mm
  const cwtX0 = ox + cwtBackOff
  const cwtX1 = cwtX0 + cwtThickness
  // CWT top sits just below the machine, CWT bottom sits above top floor
  // (CWT never descends below the top floor when car is at 1F).
  const cwtTop = shaftTop - 300
  const cwtBottom = Math.max(cwtTop - car.height_mm, topFloorY + 100)
  const cwtCentreX = (cwtX0 + cwtX1) / 2
  if (isBack) {
    dw.setActiveLayer('CWT')
    dw.drawRect(cwtX0, cwtBottom, cwtX1, cwtTop)
  }

  // ── 7. Buffers in pit ──
  dw.setActiveLayer('BUFFER')
  const bufferType = resolveBufferType(design.rated_speed_mpm, pro.buffer_type)
  const bufferH = bufferType === 'spring' ? pro.buffer_height_spring_mm : pro.buffer_height_oil_mm
  const bufferW = pro.buffer_width_mm

  // Car buffer centered under the car's depth range
  const carBufX = ox + carInsetX + car.depth_mm / 2 - bufferW / 2
  dw.drawRect(carBufX, pitBottom, carBufX + bufferW, pitBottom + bufferH)
  // CWT buffer at back (if CWT is in back position)
  const cwtBufX = isBack ? cwtCentreX - bufferW / 2 : ox + 100
  dw.drawRect(cwtBufX, pitBottom, cwtBufX + bufferW, pitBottom + bufferH)

  if (bufferType === 'spring') {
    drawSpringZigzag(dw, carBufX, pitBottom, bufferW, bufferH)
    drawSpringZigzag(dw, cwtBufX, pitBottom, bufferW, bufferH)
  } else {
    dw.setActiveLayer('TEXT')
    dw.drawText(carBufX + bufferW / 2, pitBottom + bufferH / 2, 60, 0, 'OIL', 'center')
    dw.drawText(cwtBufX + bufferW / 2, pitBottom + bufferH / 2, 60, 0, 'OIL', 'center')
  }

  // ── 8. Safety gear under the car ──
  dw.setActiveLayer('SAFETY')
  const sgW = pro.safety_gear_width_mm
  const sgH = pro.safety_gear_height_mm
  const sgY = carBottom - sgH
  // One at each edge of the car's depth footprint
  dw.drawRect(ox + carInsetX, sgY, ox + carInsetX + sgW, sgY + sgH)
  dw.drawRect(ox + carFrontX - sgW, sgY, ox + carFrontX, sgY + sgH)

  // ── 9. Traction machine in the overhead region ──
  // Position the machine so its sheave sits between the car and CWT rope
  // lines. That way both sides can hang vertically from the sheave.
  dw.setActiveLayer('MACHINE')
  const machW = pro.machine_width_mm
  const machH = pro.machine_height_mm
  const carCentreX = ox + carInsetX + car.depth_mm / 2
  const sheaveCx = (carCentreX + cwtCentreX) / 2
  const sheaveCy = shaftTop - machH / 2 - 150
  const machX = sheaveCx - machW / 2
  const machY = sheaveCy - machH / 2
  dw.drawRect(machX, machY, machX + machW, machY + machH)
  dw.drawCircle(sheaveCx, sheaveCy, sheaveR)

  dw.setActiveLayer('NOTE')
  dw.drawText(
    machX + machW / 2,
    machY - 100,
    80,
    0,
    'TRACTION MACHINE (BY VENDOR)',
    'center',
  )

  // ── 10. Governor (small wheel in the overhead) ──
  dw.setActiveLayer('SAFETY')
  const govR = pro.governor_diameter_mm / 2
  const govCx = ox + sd - 300
  const govCy = shaftTop - govR - 150
  dw.drawCircle(govCx, govCy, govR)
  dw.setActiveLayer('TEXT')
  dw.drawText(govCx - govR - 30, govCy, 60, 0, 'GOV', 'right')

  // ── 11. Suspension ropes ──
  // Car at 1F (bottom), CWT in top zone. Ropes hang vertically:
  //   Car side: carTop → up through zigzag break → sheave top
  //   CWT side: sheave top → down to cwtTop (no zigzag needed; CWT is
  //             already in the top zone)
  // Short rope segment spans the top of the sheave connecting both sides.
  dw.setActiveLayer('ROPE')
  const ropeOff = 25  // half-distance between the two rope lines
  // Car side — vertical through bottom zone, gap, vertical through top zone
  dw.drawLine(carCentreX - ropeOff, carTop, carCentreX - ropeOff, zigBot - 100)
  dw.drawLine(carCentreX + ropeOff, carTop, carCentreX + ropeOff, zigBot - 100)
  dw.drawLine(carCentreX - ropeOff, zigTop + 100, carCentreX - ropeOff, sheaveCy + sheaveR)
  dw.drawLine(carCentreX + ropeOff, zigTop + 100, carCentreX + ropeOff, sheaveCy + sheaveR)
  // CWT side — vertical from cwtTop up to sheave (both in top zone)
  dw.drawLine(cwtCentreX - ropeOff, cwtTop, cwtCentreX - ropeOff, sheaveCy + sheaveR)
  dw.drawLine(cwtCentreX + ropeOff, cwtTop, cwtCentreX + ropeOff, sheaveCy + sheaveR)
  // Over the sheave — short horizontal spans between car-side and CWT-side
  dw.drawLine(carCentreX - ropeOff, sheaveCy + sheaveR, cwtCentreX - ropeOff, sheaveCy + sheaveR)
  dw.drawLine(carCentreX + ropeOff, sheaveCy + sheaveR, cwtCentreX + ropeOff, sheaveCy + sheaveR)

  // ── 12. Traveling cable ──
  const tcX = ox + carInsetX + 40
  const tcMidY = firstFloorY - 200
  dw.drawLine(tcX, carBottom, tcX, tcMidY)
  dw.drawLine(tcX, tcMidY, ox, tcMidY)
  dw.drawLine(ox, tcMidY, ox, firstFloorY + 500)
  dw.setActiveLayer('TEXT')
  dw.drawText(tcX + 60, tcMidY, 60, 0, 'TC')

  // ── 13. Rail brackets (visible zones only) ──
  dw.setActiveLayer('WALL')
  const bracketSpacing = pro.rail_bracket_spacing_mm
  const triSize = 80
  function drawBracketsInRange(fromY: number, toY: number): void {
    for (let y = fromY; y < toY; y += bracketSpacing) {
      // Back wall bracket
      dw.drawLine(ox, y - triSize / 2, ox + triSize, y)
      dw.drawLine(ox + triSize, y, ox, y + triSize / 2)
      dw.drawLine(ox, y + triSize / 2, ox, y - triSize / 2)
      // Front wall bracket (just inside the door wall)
      dw.drawLine(ox + sd, y - triSize / 2, ox + sd - triSize, y)
      dw.drawLine(ox + sd - triSize, y, ox + sd, y + triSize / 2)
      dw.drawLine(ox + sd, y + triSize / 2, ox + sd, y - triSize / 2)
    }
  }
  drawBracketsInRange(pitBottom + bracketSpacing, zigBot - 200)
  drawBracketsInRange(zigTop + 200, shaftTop - 200)

  // ── 14. OH + PIT prominent dimensions (right side, past the door wall) ──
  dw.setActiveLayer('DIMS')
  const dimColX = ox + sd + 900
  const dimTextH = 180
  const arrowOff = 40

  // OH: top floor → shaft ceiling
  dw.drawLine(ox + sd, topFloorY, dimColX + 200, topFloorY)
  dw.drawLine(ox + sd, shaftTop, dimColX + 200, shaftTop)
  dw.drawLine(dimColX + 100, topFloorY, dimColX + 100, shaftTop)
  dw.drawLine(dimColX + 60, topFloorY + arrowOff, dimColX + 140, topFloorY)
  dw.drawLine(dimColX + 60, shaftTop - arrowOff, dimColX + 140, shaftTop)
  dw.drawText(
    dimColX + 250,
    (topFloorY + shaftTop) / 2,
    dimTextH,
    0,
    `OH = ${shaft.overhead_mm} mm`,
  )

  // PIT: 1F → pit bottom
  dw.drawLine(ox + sd, firstFloorY, dimColX + 200, firstFloorY)
  dw.drawLine(ox + sd, pitBottom, dimColX + 200, pitBottom)
  dw.drawLine(dimColX + 100, pitBottom, dimColX + 100, firstFloorY)
  dw.drawLine(dimColX + 60, firstFloorY - arrowOff, dimColX + 140, firstFloorY)
  dw.drawLine(dimColX + 60, pitBottom + arrowOff, dimColX + 140, pitBottom)
  dw.drawText(
    dimColX + 250,
    (firstFloorY + pitBottom) / 2,
    dimTextH,
    0,
    `PIT = ${shaft.pit_depth_mm} mm`,
  )

  // ── 15. BY OTHERS / BY VENDOR callouts ──
  dw.setActiveLayer('NOTE')
  // HOIST BEAM at the very top (building contractor responsibility)
  const hoistBeamY = shaftTop - 100
  dw.drawText(
    ox - 250,
    hoistBeamY,
    90,
    0,
    'HOIST BEAM (BY OTHERS)',
    'right',
  )
  dw.drawLine(ox - 220, hoistBeamY, ox - 20, hoistBeamY)
  dw.drawLine(ox - 20, hoistBeamY, ox, shaftTop)

  // EMBED PLATES at rail brackets
  const embedY = (pitBottom + zigBot) / 2
  dw.drawText(
    ox - 250,
    embedY,
    90,
    0,
    'EMBED PLATES (BY OTHERS)',
    'right',
  )
  dw.drawLine(ox - 220, embedY, ox - 20, embedY)
  dw.drawLine(ox - 20, embedY, ox, embedY)

  // ── 16. Back / Front orientation markers ──
  dw.setActiveLayer('TEXT')
  dw.drawText(ox + 100, pitBottom - 200, 80, 0, '← BACK')
  dw.drawText(ox + sd - 100, pitBottom - 200, 80, 0, 'FRONT →', 'right')

  // ── 17. Title ──
  dw.drawText(
    ox + sd / 2,
    pitBottom - 600,
    180,
    0,
    'SIDE SECTION / 側面剖面 (PROFESSIONAL)',
    'center',
  )
}
