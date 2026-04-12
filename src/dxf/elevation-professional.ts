/**
 * Professional elevation view — replaces draft elevation entirely.
 *
 * Draws full multi-floor rendering (no zigzag break) with:
 *   1.  Shaft outline (full height)
 *   2.  Multi-floor landings
 *   3.  Car at 1F
 *   4.  Buffers ×2 (spring / oil auto-select)
 *   5.  MRL traction machine + sheave
 *   6.  Overhead breakdown (3-segment)
 *   7.  Rail brackets
 *   8.  Safety gear + governor
 *   9.  Ropes + traveling cable
 *   10. PIT dimension
 *   11. Title
 */

import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, ProfessionalConfig, BufferType } from '../config/types'

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

  const floorHeight = config.height.floor_default_mm
  const stops = shaft.stops

  // Key vertical positions
  const pitBottom = oy
  const firstFloorY = oy + shaft.pit_depth_mm
  const topFloorY = firstFloorY + (stops - 1) * floorHeight
  const shaftTop = topFloorY + shaft.overhead_mm

  // Shaft visual width for elevation (use shaft width directly)
  const sw = shaft.width_mm

  // ---- 1. Shaft outline ----
  drawShaftOutline(dw, ox, pitBottom, sw, shaftTop)

  // ---- 2. Multi-floor landings ----
  drawLandings(dw, ox, firstFloorY, sw, stops, floorHeight)

  // ---- 3. Car at 1F ----
  drawCarAtFirstFloor(dw, ox, firstFloorY, sw, car)

  // ---- 4. Buffers ----
  drawBuffers(dw, ox, pitBottom, firstFloorY, sw, design.rated_speed_mpm, pro)

  // ---- 5. MRL traction machine ----
  drawMachine(dw, ox, shaftTop, sw, pro)

  // ---- 6. Overhead breakdown ----
  drawOverheadBreakdown(dw, ox, topFloorY, shaftTop, sw, config, design.rated_speed_mpm)

  // ---- 7. Rail brackets ----
  drawRailBrackets(dw, ox, pitBottom, shaftTop, sw, pro.rail_bracket_spacing_mm)

  // ---- 8. Safety gear + governor ----
  drawSafetyAndGovernor(dw, ox, firstFloorY, shaftTop, sw, car, pro)

  // ---- 9. Ropes + traveling cable ----
  drawRopesAndTC(dw, ox, firstFloorY, shaftTop, sw, car, pro)

  // ---- 10. PIT dimension ----
  drawPitDimension(dw, ox, pitBottom, firstFloorY, sw, shaft.pit_depth_mm)

  // ---- 11. Title ----
  dw.setActiveLayer('TEXT')
  dw.drawText(
    ox + sw / 2,
    pitBottom - 600,
    180,
    0,
    'ELEVATION VIEW / 側面圖 (PROFESSIONAL)',
    'center',
  )
}

// ---- Component helpers ----

function drawShaftOutline(
  dw: any,
  ox: number,
  pitBottom: number,
  sw: number,
  shaftTop: number,
): void {
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, pitBottom, ox + sw, shaftTop)
}

function drawLandings(
  dw: any,
  ox: number,
  firstFloorY: number,
  sw: number,
  stops: number,
  floorHeight: number,
): void {
  dw.setActiveLayer('LANDING')
  for (let i = 0; i < stops; i++) {
    const floorY = firstFloorY + i * floorHeight
    // Floor line
    dw.drawLine(ox, floorY, ox + sw, floorY)
    // Door opening indicator (short vertical line on left wall, 2100mm high)
    dw.drawLine(ox, floorY, ox, floorY + 2100)

    // Floor label
    dw.setActiveLayer('TEXT')
    dw.drawText(ox - 250, floorY, 120, 0, `${i + 1}F`)
    dw.setActiveLayer('LANDING')
  }
}

function drawCarAtFirstFloor(
  dw: any,
  ox: number,
  firstFloorY: number,
  sw: number,
  car: ElevatorDesign['car'],
): void {
  dw.setActiveLayer('CAR')
  const carW = sw * 0.5
  const carX = ox + (sw - carW) / 2
  dw.drawRect(carX, firstFloorY + 100, carX + carW, firstFloorY + 100 + car.height_mm)
}

function resolveBufferType(speed: number, override: BufferType): 'spring' | 'oil' {
  if (override !== 'auto') return override
  return speed <= 60 ? 'spring' : 'oil'
}

function drawBuffers(
  dw: any,
  ox: number,
  pitBottom: number,
  firstFloorY: number,
  sw: number,
  speed: number,
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('BUFFER')

  const bufferType = resolveBufferType(speed, pro.buffer_type)
  const bufferH =
    bufferType === 'spring' ? pro.buffer_height_spring_mm : pro.buffer_height_oil_mm
  const bufferW = pro.buffer_width_mm

  // Car buffer — centered
  const carBufX = ox + sw / 2 - bufferW / 2
  dw.drawRect(carBufX, pitBottom, carBufX + bufferW, pitBottom + bufferH)

  // CWT buffer — at 75% width
  const cwtBufX = ox + sw * 0.75 - bufferW / 2
  dw.drawRect(cwtBufX, pitBottom, cwtBufX + bufferW, pitBottom + bufferH)

  if (bufferType === 'spring') {
    // Draw zigzag inside both buffer rects
    drawSpringZigzag(dw, carBufX, pitBottom, bufferW, bufferH)
    drawSpringZigzag(dw, cwtBufX, pitBottom, bufferW, bufferH)
  } else {
    // Solid fill + "OIL" text
    dw.setActiveLayer('TEXT')
    dw.drawText(carBufX + bufferW / 2, pitBottom + bufferH / 2, 60, 0, 'OIL', 'center')
    dw.drawText(cwtBufX + bufferW / 2, pitBottom + bufferH / 2, 60, 0, 'OIL', 'center')
  }
}

function drawSpringZigzag(
  dw: any,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Zigzag line inside the buffer rectangle
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

function drawMachine(
  dw: any,
  ox: number,
  shaftTop: number,
  sw: number,
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('MACHINE')

  // Machine rectangle at shaft top-right
  const machX = ox + sw - pro.machine_width_mm - 50
  const machY = shaftTop - pro.machine_height_mm - 50
  dw.drawRect(machX, machY, machX + pro.machine_width_mm, machY + pro.machine_height_mm)

  // Sheave circle
  const sheaveR = pro.sheave_diameter_mm / 2
  const sheaveCx = machX + pro.machine_width_mm / 2
  const sheaveCy = machY + pro.machine_height_mm / 2
  dw.drawCircle(sheaveCx, sheaveCy, sheaveR)

  // Label
  dw.setActiveLayer('TEXT')
  dw.drawText(machX + pro.machine_width_mm / 2, machY - 80, 60, 0, 'MACHINE (示意)', 'center')
}

function drawOverheadBreakdown(
  dw: any,
  ox: number,
  topFloorY: number,
  shaftTop: number,
  sw: number,
  config: EffectiveConfig,
  speed: number,
): void {
  dw.setActiveLayer('DIMS')

  const oh = config.height.overhead
  const refuge = oh.refuge_mm
  const bounce = Math.round(oh.bounce_coef * speed * speed * 1000)
  const machineBuf = oh.machine_buffer_mm

  const annotX = ox + sw + 500
  const seg1Top = topFloorY + refuge
  const seg2Top = seg1Top + bounce
  // seg3Top should be shaftTop

  // Tick marks and labels
  // Segment 1: refuge
  dw.drawLine(annotX - 50, topFloorY, annotX + 50, topFloorY)
  dw.drawLine(annotX - 50, seg1Top, annotX + 50, seg1Top)
  dw.drawLine(annotX, topFloorY, annotX, seg1Top)
  dw.drawText(annotX + 80, (topFloorY + seg1Top) / 2, 80, 0, `refuge ${refuge}`)

  // Segment 2: bounce
  dw.drawLine(annotX - 50, seg2Top, annotX + 50, seg2Top)
  dw.drawLine(annotX, seg1Top, annotX, seg2Top)
  dw.drawText(annotX + 80, (seg1Top + seg2Top) / 2, 80, 0, `bounce ${bounce}`)

  // Segment 3: machine buffer
  dw.drawLine(annotX - 50, shaftTop, annotX + 50, shaftTop)
  dw.drawLine(annotX, seg2Top, annotX, shaftTop)
  dw.drawText(annotX + 80, (seg2Top + shaftTop) / 2, 80, 0, `machine_buf ${machineBuf}`)
}

function drawRailBrackets(
  dw: any,
  ox: number,
  pitBottom: number,
  shaftTop: number,
  sw: number,
  spacing: number,
): void {
  dw.setActiveLayer('WALL')

  const triSize = 80
  let y = pitBottom + spacing

  while (y < shaftTop) {
    // Left wall bracket (triangle pointing right)
    dw.drawLine(ox, y - triSize / 2, ox + triSize, y)
    dw.drawLine(ox + triSize, y, ox, y + triSize / 2)
    dw.drawLine(ox, y + triSize / 2, ox, y - triSize / 2)

    // Right wall bracket (triangle pointing left)
    dw.drawLine(ox + sw, y - triSize / 2, ox + sw - triSize, y)
    dw.drawLine(ox + sw - triSize, y, ox + sw, y + triSize / 2)
    dw.drawLine(ox + sw, y + triSize / 2, ox + sw, y - triSize / 2)

    y += spacing
  }
}

function drawSafetyAndGovernor(
  dw: any,
  ox: number,
  firstFloorY: number,
  shaftTop: number,
  sw: number,
  car: ElevatorDesign['car'],
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('SAFETY')

  const carW = sw * 0.5
  const carX = ox + (sw - carW) / 2

  // Safety gear blocks at car sling bottom (2 rectangles)
  const sgW = pro.safety_gear_width_mm
  const sgH = pro.safety_gear_height_mm
  const sgY = firstFloorY + 100 - sgH // just below car bottom

  // Left safety gear
  dw.drawRect(carX, sgY, carX + sgW, sgY + sgH)
  // Right safety gear
  dw.drawRect(carX + carW - sgW, sgY, carX + carW, sgY + sgH)

  // Governor wheel at shaft top
  const govR = pro.governor_diameter_mm / 2
  const govCx = ox + 150 // near left wall
  const govCy = shaftTop - govR - 50
  dw.drawCircle(govCx, govCy, govR)

  // Dashed governor rope (vertical line from governor to safety gear)
  // Draw as series of short segments to simulate dashed
  const ropeX = govCx
  const ropeTop = govCy - govR
  const ropeBottom = sgY + sgH / 2
  const dashLen = 100
  const gapLen = 60
  let curY = ropeBottom

  while (curY < ropeTop) {
    const endY = Math.min(curY + dashLen, ropeTop)
    dw.drawLine(ropeX, curY, ropeX, endY)
    curY = endY + gapLen
  }

  // Labels
  dw.setActiveLayer('TEXT')
  dw.drawText(govCx + govR + 30, govCy, 60, 0, 'GOV (示意)')
}

function drawRopesAndTC(
  dw: any,
  ox: number,
  firstFloorY: number,
  shaftTop: number,
  sw: number,
  car: ElevatorDesign['car'],
  pro: ProfessionalConfig,
): void {
  dw.setActiveLayer('ROPE')

  const carW = sw * 0.5
  const carX = ox + (sw - carW) / 2
  const carTop = firstFloorY + 100 + car.height_mm

  // Sheave position (same as machine center)
  const sheaveX = ox + sw - pro.machine_width_mm / 2 - 50
  const sheaveY = shaftTop - pro.machine_height_mm / 2 - 50

  // CWT position (at 75% width, approximate)
  const cwtX = ox + sw * 0.75

  // Suspension rope left line: car top → sheave → CWT
  const ropeCarX1 = carX + carW * 0.4
  const ropeCarX2 = carX + carW * 0.6

  // Rope 1
  dw.drawLine(ropeCarX1, carTop, sheaveX - 10, sheaveY)
  dw.drawLine(sheaveX - 10, sheaveY, cwtX - 10, carTop)
  // Rope 2
  dw.drawLine(ropeCarX2, carTop, sheaveX + 10, sheaveY)
  dw.drawLine(sheaveX + 10, sheaveY, cwtX + 10, carTop)

  // Traveling cable: car bottom → U-curve down → wall
  const carBottom = firstFloorY + 100
  const tcX = carX + 30
  const tcMidY = firstFloorY - 200 // U-curve dip
  dw.drawLine(tcX, carBottom, tcX, tcMidY)
  dw.drawLine(tcX, tcMidY, ox, tcMidY)
  dw.drawLine(ox, tcMidY, ox, firstFloorY + 500)

  // Label
  dw.setActiveLayer('TEXT')
  dw.drawText(tcX + 50, tcMidY, 60, 0, 'TC (示意)')
}

function drawPitDimension(
  dw: any,
  ox: number,
  pitBottom: number,
  firstFloorY: number,
  sw: number,
  pitDepth: number,
): void {
  dw.setActiveLayer('DIMS')
  dw.drawText(
    ox + sw + 350,
    (pitBottom + firstFloorY) / 2,
    120,
    0,
    `PIT ${pitDepth}`,
  )
}
