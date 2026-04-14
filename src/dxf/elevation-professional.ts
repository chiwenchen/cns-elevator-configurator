/**
 * Professional elevation view — uses same zigzag compression as draft,
 * but adds professional components in the visible regions:
 *
 * Bottom zone (pit → 1F → car top):
 *   - Buffers in pit
 *   - Safety gear below car
 *   - Car at 1F
 *   - 1F + 2F landing lines
 *
 * Top zone (above zigzag break):
 *   - MRL traction machine + sheave
 *   - Governor wheel
 *   - Overhead breakdown (3-segment)
 *   - Top floor label
 *
 * Both zones:
 *   - Ropes (car → sheave → CWT)
 *   - Traveling cable path
 *   - Rail brackets
 *   - Wall thickness indicators
 *
 * The zigzag break represents omitted middle floors.
 * This keeps the elevation height proportional to plan view.
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
  const sw = shaft.width_mm

  // ── Vertical layout (same coordinate system as draft) ──
  // 1F is at oy, pit extends downward, everything above is upward
  const firstFloorY = oy
  const pitBottom = firstFloorY - shaft.pit_depth_mm
  const carBottom = firstFloorY + 100
  const carTop = carBottom + car.height_mm

  // Top zone: overhead region rendered above zigzag
  const BREAK_HEADROOM = 600
  const BREAK_GAP = 1200
  const TOP_ZONE_HEIGHT = 2000  // enough room for machine + overhead labels

  const zigBot = carTop + BREAK_HEADROOM
  const zigTop = zigBot + BREAK_GAP
  const topZoneBottom = zigTop
  const shaftVisualTop = zigTop + TOP_ZONE_HEIGHT

  // Real overhead values (for annotation only — not affecting layout)
  const floorHeight = config.height.floor_default_mm
  const topFloorY_real = firstFloorY + (shaft.stops - 1) * floorHeight
  const oh = config.height.overhead

  // ── 1. Shaft outline (visible range only) ──
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, pitBottom, ox + sw, shaftVisualTop)
  // 1F line
  dw.drawLine(ox, firstFloorY, ox + sw, firstFloorY)

  // ── 2. Zigzag break symbols ──
  const zigStep = sw / 6
  for (const baseY of [zigBot, zigTop]) {
    dw.setActiveLayer('STOP')
    for (let i = 0; i < 6; i++) {
      const x1 = ox + i * zigStep
      const x2 = ox + (i + 1) * zigStep
      const y1 = baseY + (i % 2 === 0 ? -80 : 80)
      const y2 = baseY + (i % 2 === 0 ? 80 : -80)
      dw.drawLine(x1, y1, x2, y2)
    }
  }

  // ── 3. Floor labels (1F, 2F visible; top floor in top zone) ──
  dw.setActiveLayer('TEXT')
  dw.drawText(ox - 250, firstFloorY, 140, 0, '1F', 'right')
  // 2F line (if > 1 stop)
  if (shaft.stops > 1) {
    const secondFloorY = firstFloorY + floorHeight
    // Only draw 2F if it's below the zigzag break
    if (secondFloorY < zigBot) {
      dw.setActiveLayer('LANDING')
      dw.drawLine(ox, secondFloorY, ox + sw, secondFloorY)
      dw.drawLine(ox, secondFloorY, ox, secondFloorY + 2100)
      dw.setActiveLayer('TEXT')
      dw.drawText(ox - 250, secondFloorY, 140, 0, '2F', 'right')
    }
  }
  // Top floor label in top zone
  dw.setActiveLayer('TEXT')
  dw.drawText(ox - 250, topZoneBottom + 100, 140, 0, `${shaft.stops}F`, 'right')
  dw.setActiveLayer('LANDING')
  dw.drawLine(ox, topZoneBottom + 100, ox + sw, topZoneBottom + 100)

  // 1F landing door indicator
  dw.setActiveLayer('LANDING')
  dw.drawLine(ox, firstFloorY, ox, firstFloorY + 2100)

  // ── 4. Car at 1F ──
  const carInsetX = (sw - car.width_mm) / 2
  dw.setActiveLayer('CAR')
  dw.drawRect(ox + carInsetX, carBottom, ox + carInsetX + car.width_mm, carTop)

  // ── 5. Buffers in pit ──
  dw.setActiveLayer('BUFFER')
  const bufferType = resolveBufferType(design.rated_speed_mpm, pro.buffer_type)
  const bufferH = bufferType === 'spring' ? pro.buffer_height_spring_mm : pro.buffer_height_oil_mm
  const bufferW = pro.buffer_width_mm

  // Car buffer (centered)
  const carBufX = ox + sw / 2 - bufferW / 2
  dw.drawRect(carBufX, pitBottom, carBufX + bufferW, pitBottom + bufferH)
  // CWT buffer (at 75% width)
  const cwtBufX = ox + sw * 0.75 - bufferW / 2
  dw.drawRect(cwtBufX, pitBottom, cwtBufX + bufferW, pitBottom + bufferH)

  if (bufferType === 'spring') {
    drawSpringZigzag(dw, carBufX, pitBottom, bufferW, bufferH)
    drawSpringZigzag(dw, cwtBufX, pitBottom, bufferW, bufferH)
  } else {
    dw.setActiveLayer('TEXT')
    dw.drawText(carBufX + bufferW / 2, pitBottom + bufferH / 2, 60, 0, 'OIL', 'center')
    dw.drawText(cwtBufX + bufferW / 2, pitBottom + bufferH / 2, 60, 0, 'OIL', 'center')
  }

  // ── 6. Safety gear below car ──
  dw.setActiveLayer('SAFETY')
  const sgW = pro.safety_gear_width_mm
  const sgH = pro.safety_gear_height_mm
  const carDrawX = ox + carInsetX
  const carDrawW = car.width_mm
  const sgY = carBottom - sgH

  // Left safety gear
  dw.drawRect(carDrawX, sgY, carDrawX + sgW, sgY + sgH)
  // Right safety gear
  dw.drawRect(carDrawX + carDrawW - sgW, sgY, carDrawX + carDrawW, sgY + sgH)

  // ── 7. MRL Machine in top zone ──
  dw.setActiveLayer('MACHINE')
  const machX = ox + sw - pro.machine_width_mm - 50
  const machY = shaftVisualTop - pro.machine_height_mm - 100
  dw.drawRect(machX, machY, machX + pro.machine_width_mm, machY + pro.machine_height_mm)
  // Sheave circle
  const sheaveR = pro.sheave_diameter_mm / 2
  const sheaveCx = machX + pro.machine_width_mm / 2
  const sheaveCy = machY + pro.machine_height_mm / 2
  dw.drawCircle(sheaveCx, sheaveCy, sheaveR)
  dw.setActiveLayer('NOTE')
  dw.drawText(
    machX + pro.machine_width_mm / 2,
    machY - 100,
    80,
    0,
    'TRACTION MACHINE (BY VENDOR)',
    'center',
  )

  // ── HOIST BEAM callout (top of shaft) ──
  const hoistBeamY = shaftVisualTop - 150
  dw.setActiveLayer('NOTE')
  dw.drawText(
    ox - 200,
    hoistBeamY,
    90,
    0,
    'HOIST BEAM (BY OTHERS)',
    'right',
  )
  // Leader line from label to shaft top-left corner
  dw.drawLine(ox - 180, hoistBeamY, ox - 20, hoistBeamY)
  dw.drawLine(ox - 20, hoistBeamY, ox, shaftVisualTop)

  // ── EMBED PLATES callout (one representative, referring to all brackets) ──
  const embedY = (pitBottom + zigBot) / 2
  dw.drawText(
    ox - 200,
    embedY,
    90,
    0,
    'EMBED PLATES (BY OTHERS)',
    'right',
  )
  dw.drawLine(ox - 180, embedY, ox - 20, embedY)
  dw.drawLine(ox - 20, embedY, ox, embedY)

  // ── 8. Governor in top zone ──
  dw.setActiveLayer('SAFETY')
  const govR = pro.governor_diameter_mm / 2
  const govCx = ox + 150
  const govCy = shaftVisualTop - govR - 80
  dw.drawCircle(govCx, govCy, govR)
  dw.setActiveLayer('TEXT')
  dw.drawText(govCx + govR + 30, govCy, 60, 0, 'GOV (示意)')

  // Governor rope (dashed, from gov down through zigzag to safety gear)
  // Only draw in visible zones (bottom: sgY to zigBot, top: zigTop to govCy)
  dw.setActiveLayer('SAFETY')
  const dashLen = 100
  const gapLen = 60
  // Bottom segment: safety gear to zigzag
  let curY = sgY + sgH / 2
  while (curY < zigBot - 100) {
    const endY = Math.min(curY + dashLen, zigBot - 100)
    dw.drawLine(govCx, curY, govCx, endY)
    curY = endY + gapLen
  }
  // Top segment: zigzag to governor
  curY = zigTop + 100
  while (curY < govCy - govR) {
    const endY = Math.min(curY + dashLen, govCy - govR)
    dw.drawLine(govCx, curY, govCx, endY)
    curY = endY + gapLen
  }

  // ── 9. Suspension ropes ──
  dw.setActiveLayer('ROPE')
  const ropeCarX1 = ox + carInsetX + carDrawW * 0.4
  const ropeCarX2 = ox + carInsetX + carDrawW * 0.6
  const cwtRopeX = ox + sw * 0.75

  // Bottom zone: car top → zigzag (vertical)
  dw.drawLine(ropeCarX1, carTop, ropeCarX1, zigBot - 100)
  dw.drawLine(ropeCarX2, carTop, ropeCarX2, zigBot - 100)
  // CWT side bottom zone (vertical)
  dw.drawLine(cwtRopeX - 10, zigBot - 100, cwtRopeX - 10, carTop)
  dw.drawLine(cwtRopeX + 10, zigBot - 100, cwtRopeX + 10, carTop)

  // Top zone: vertical from zigzag up to sheave height, then jog to sheave
  const ropeTopBase = zigTop + 100
  // Car side: vertical up, then short angle to sheave
  dw.drawLine(ropeCarX1, ropeTopBase, ropeCarX1, sheaveCy - sheaveR)
  dw.drawLine(ropeCarX2, ropeTopBase, ropeCarX2, sheaveCy - sheaveR)
  // Over the sheave (short connecting lines)
  dw.drawLine(ropeCarX1, sheaveCy - sheaveR, sheaveCx - 10, sheaveCy)
  dw.drawLine(ropeCarX2, sheaveCy - sheaveR, sheaveCx + 10, sheaveCy)
  // CWT side: sheave down vertical
  dw.drawLine(sheaveCx - 10, sheaveCy, cwtRopeX - 10, sheaveCy - sheaveR)
  dw.drawLine(sheaveCx + 10, sheaveCy, cwtRopeX + 10, sheaveCy - sheaveR)
  dw.drawLine(cwtRopeX - 10, sheaveCy - sheaveR, cwtRopeX - 10, ropeTopBase)
  dw.drawLine(cwtRopeX + 10, sheaveCy - sheaveR, cwtRopeX + 10, ropeTopBase)

  // Traveling cable
  const tcX = ox + carInsetX + 30
  const tcMidY = firstFloorY - 200
  dw.drawLine(tcX, carBottom, tcX, tcMidY)
  dw.drawLine(tcX, tcMidY, ox, tcMidY)
  dw.drawLine(ox, tcMidY, ox, firstFloorY + 500)
  dw.setActiveLayer('TEXT')
  dw.drawText(tcX + 50, tcMidY, 60, 0, 'TC (示意)')

  // ── 10. Rail brackets (visible zones only) ──
  dw.setActiveLayer('WALL')
  const bracketSpacing = pro.rail_bracket_spacing_mm
  const triSize = 80
  // Bottom zone brackets
  for (let y = pitBottom + bracketSpacing; y < zigBot - 200; y += bracketSpacing) {
    dw.drawLine(ox, y - triSize / 2, ox + triSize, y)
    dw.drawLine(ox + triSize, y, ox, y + triSize / 2)
    dw.drawLine(ox, y + triSize / 2, ox, y - triSize / 2)
    dw.drawLine(ox + sw, y - triSize / 2, ox + sw - triSize, y)
    dw.drawLine(ox + sw - triSize, y, ox + sw, y + triSize / 2)
    dw.drawLine(ox + sw, y + triSize / 2, ox + sw, y - triSize / 2)
  }
  // Top zone brackets
  for (let y = zigTop + 200; y < shaftVisualTop - 200; y += bracketSpacing) {
    dw.drawLine(ox, y - triSize / 2, ox + triSize, y)
    dw.drawLine(ox + triSize, y, ox, y + triSize / 2)
    dw.drawLine(ox, y + triSize / 2, ox, y - triSize / 2)
    dw.drawLine(ox + sw, y - triSize / 2, ox + sw - triSize, y)
    dw.drawLine(ox + sw - triSize, y, ox + sw, y + triSize / 2)
    dw.drawLine(ox + sw, y + triSize / 2, ox + sw, y - triSize / 2)
  }

  // ── 11. Overhead breakdown (annotation to the right) ──
  dw.setActiveLayer('DIMS')
  const annotX = ox + sw + 500
  const v_mps = design.rated_speed_mpm / 60
  const refugeVal = oh.refuge_mm
  const bounceVal = Math.round(oh.bounce_coef * v_mps * v_mps * 1000)
  const machBufVal = oh.machine_buffer_mm

  // Annotations in top zone (approximate positions)
  const ohBaseY = topZoneBottom + 200
  dw.drawLine(annotX - 50, ohBaseY, annotX + 50, ohBaseY)
  const ohSeg1 = ohBaseY + refugeVal * (TOP_ZONE_HEIGHT - 400) / shaft.overhead_mm
  dw.drawLine(annotX - 50, ohSeg1, annotX + 50, ohSeg1)
  dw.drawLine(annotX, ohBaseY, annotX, ohSeg1)
  dw.drawText(annotX + 80, (ohBaseY + ohSeg1) / 2, 80, 0, `避難 ${refugeVal}`)

  const ohSeg2 = ohSeg1 + bounceVal * (TOP_ZONE_HEIGHT - 400) / shaft.overhead_mm
  dw.drawLine(annotX - 50, ohSeg2, annotX + 50, ohSeg2)
  dw.drawLine(annotX, ohSeg1, annotX, ohSeg2)
  dw.drawText(annotX + 80, (ohSeg1 + ohSeg2) / 2, 80, 0, `彈跳 ${bounceVal}`)

  const ohSeg3 = shaftVisualTop - 100
  dw.drawLine(annotX - 50, ohSeg3, annotX + 50, ohSeg3)
  dw.drawLine(annotX, ohSeg2, annotX, ohSeg3)
  dw.drawText(annotX + 80, (ohSeg2 + ohSeg3) / 2, 80, 0, `機器 ${machBufVal}`)

  // ── 12. OH + PIT prominent totals (industry standard, second column) ──
  // Building architects need these two numbers more than anything else.
  const dimCol2X = annotX + 1200
  const dimTextH = 180
  const arrowOff = 40
  // OH: top floor plane → shaft ceiling (use top zone region for visual anchor)
  dw.drawLine(annotX, ohBaseY, dimCol2X + 200, ohBaseY)
  dw.drawLine(annotX, ohSeg3, dimCol2X + 200, ohSeg3)
  dw.drawLine(dimCol2X + 100, ohBaseY, dimCol2X + 100, ohSeg3)
  dw.drawLine(dimCol2X + 60, ohBaseY + arrowOff, dimCol2X + 140, ohBaseY)
  dw.drawLine(dimCol2X + 60, ohSeg3 - arrowOff, dimCol2X + 140, ohSeg3)
  dw.drawText(
    dimCol2X + 250,
    (ohBaseY + ohSeg3) / 2,
    dimTextH,
    0,
    `OH = ${shaft.overhead_mm} mm`,
  )
  // PIT: 1F → pit bottom
  dw.drawLine(ox + sw, firstFloorY, dimCol2X + 200, firstFloorY)
  dw.drawLine(ox + sw, pitBottom, dimCol2X + 200, pitBottom)
  dw.drawLine(dimCol2X + 100, pitBottom, dimCol2X + 100, firstFloorY)
  dw.drawLine(dimCol2X + 60, firstFloorY - arrowOff, dimCol2X + 140, firstFloorY)
  dw.drawLine(dimCol2X + 60, pitBottom + arrowOff, dimCol2X + 140, pitBottom)
  dw.drawText(
    dimCol2X + 250,
    (firstFloorY + pitBottom) / 2,
    dimTextH,
    0,
    `PIT = ${shaft.pit_depth_mm} mm`,
  )

  // ── 13. Title ──
  dw.setActiveLayer('TEXT')
  dw.drawText(ox + sw / 2, pitBottom - 600, 180, 0, 'ELEVATION VIEW / 側面圖 (PROFESSIONAL)', 'center')
}
