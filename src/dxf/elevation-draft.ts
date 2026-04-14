import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'

/**
 * Side section elevation (draft).
 *
 * Industry standard cut: perpendicular to the door, viewed from the left
 * side of the shaft. Horizontal axis runs along shaft DEPTH
 * (back wall on the left, front wall with door on the right). Vertical
 * axis is travel height.
 *
 * The key thing this view shows that a front view can't:
 *   - each floor's door opening profile (HH on the right wall)
 *   - CWT behind the car (when CWT is in a back position)
 *   - pit + overhead on the same axis as travel
 *   - ropes going up to the machine
 *
 * Draft keeps it minimal: shaft outline, car at 1F, 1F + top door openings,
 * CWT stub, zigzag break for middle floors, OH / PIT prominent dimensions.
 */
export function drawElevationDraft(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  config?: EffectiveConfig,
): void {
  const { shaft, car, door } = design
  const ox = origin.x
  const oy = origin.y

  // Horizontal axis = shaft depth. Back wall at ox, front wall (with door)
  // at ox + shaft.depth_mm.
  const sd = shaft.depth_mm

  // Layout constants
  const BREAK_HEADROOM = 600
  const BREAK_GAP = 1200
  const TOP_FLOOR_HEIGHT = 1500 // visible slice of the top floor above the zigzag break

  // --- Vertical coordinates ---
  // Car floor aligns with 1F landing floor when parked at 1F.
  const firstStopY = oy
  const shaftBottom = firstStopY - shaft.pit_depth_mm
  const carBottom = firstStopY
  const carTop = carBottom + car.height_mm
  const zigBot = carTop + BREAK_HEADROOM
  const zigTop = zigBot + BREAK_GAP
  const topFloorY = zigTop + TOP_FLOOR_HEIGHT
  const shaftTop = topFloorY + shaft.overhead_mm

  // --- Car depth-direction position (derived the same way as plan view) ---
  const frontGap = config?.clearance?.front_mm ?? 50
  const carInsetX = sd - car.depth_mm - frontGap // offset from back wall
  const carFrontX = carInsetX + car.depth_mm
  const backGap = carInsetX

  // --- Shaft outline (pit + overhead in one rectangle) ---
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, shaftBottom, ox + sd, shaftTop)
  // Floor lines
  dw.drawLine(ox, firstStopY, ox + sd, firstStopY)
  dw.drawLine(ox, topFloorY, ox + sd, topFloorY)

  // --- Zigzag break symbol (two lines, bottom and top of gap) ---
  const zigStep = sd / 6
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

  // --- Door openings at visible floors (on the right wall — front wall) ---
  // In a side section the door is a vertical gap in the front wall at each
  // floor, extending from floor level up to HH (door height).
  const hh = 2100 // standard door height; future: pull from config/design
  const wallThickness = 150 // visual wall thickness for the door jamb L-shape
  function drawDoorAt(floorY: number): void {
    dw.setActiveLayer('DOOR')
    // Sill (short horizontal)
    dw.drawLine(ox + sd - wallThickness, floorY, ox + sd, floorY)
    // Header (top of opening)
    dw.drawLine(ox + sd - wallThickness, floorY + hh, ox + sd, floorY + hh)
    // Jamb vertical (inner edge of wall at door)
    dw.drawLine(ox + sd - wallThickness, floorY, ox + sd - wallThickness, floorY + hh)
  }
  drawDoorAt(firstStopY)
  drawDoorAt(topFloorY)

  // --- 1F label ---
  dw.setActiveLayer('TEXT')
  dw.drawText(ox - 250, firstStopY, 140, 0, '1F', 'right')
  dw.drawText(
    ox - 250,
    topFloorY,
    140,
    0,
    `${shaft.stops}F`,
    'right',
  )

  // --- Car at 1F (in depth direction) ---
  dw.setActiveLayer('CAR')
  dw.drawRect(ox + carInsetX, carBottom, ox + carFrontX, carTop)

  // --- CWT stub (back position only; back wall is at left) ---
  // When the car is parked at 1F (lowest), the CWT is at its highest
  // position — they're rope-linked and move in opposition. Drawing CWT
  // at car height is geometrically impossible.
  const cwtPos = config?.cwt?.position
  const isBack = !cwtPos || cwtPos.startsWith('back_')
  if (isBack) {
    const cwtThickness = config?.cwt?.thickness_mm ?? 120
    const cwtBackOff = config?.cwt?.back_offset_mm ?? 30
    // CWT in overhead zone (car at 1F → CWT at top of travel).
    // Using true rule values — what you see is what gets calculated.
    const cwtTopY = shaftTop - 300
    const cwtBotY = Math.max(cwtTopY - car.height_mm, topFloorY + 100)
    dw.setActiveLayer('CWT')
    dw.drawRect(
      ox + cwtBackOff,
      cwtBotY,
      ox + cwtBackOff + cwtThickness,
      cwtTopY,
    )
  }

  // --- OH + PIT prominent dimensions (right side, beyond the door wall) ---
  dw.setActiveLayer('DIMS')
  const dimColX = ox + sd + 700
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

  // PIT: 1F → shaft floor
  dw.drawLine(ox + sd, firstStopY, dimColX + 200, firstStopY)
  dw.drawLine(ox + sd, shaftBottom, dimColX + 200, shaftBottom)
  dw.drawLine(dimColX + 100, shaftBottom, dimColX + 100, firstStopY)
  dw.drawLine(dimColX + 60, firstStopY - arrowOff, dimColX + 140, firstStopY)
  dw.drawLine(dimColX + 60, shaftBottom + arrowOff, dimColX + 140, shaftBottom)
  dw.drawText(
    dimColX + 250,
    (firstStopY + shaftBottom) / 2,
    dimTextH,
    0,
    `PIT = ${shaft.pit_depth_mm} mm`,
  )

  // --- HH (door height) dim on the right side near 1F door ---
  dw.drawText(
    ox + sd + 180,
    firstStopY + hh / 2,
    100,
    0,
    `HH = ${hh}`,
  )

  // --- Title + direction indicators ---
  dw.setActiveLayer('TEXT')
  dw.drawText(
    ox + sd / 2,
    shaftBottom - 400,
    180,
    0,
    'SIDE SECTION / 側面剖面',
    'center',
  )
  // Back / Front markers so the reader knows the orientation
  dw.drawText(ox + 100, shaftBottom - 200, 80, 0, '← BACK')
  dw.drawText(ox + sd - 100, shaftBottom - 200, 80, 0, 'FRONT →', 'right')

  // Door width not shown in draft side view, but reserve for future annotation.
  void door
}
