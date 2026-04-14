/**
 * Machine Room Plan — top-down view of the machine room floor.
 *
 * Only drawn when design.machine_location === 'MR'. The layout mirrors
 * industry standard (Mitsubishi MEUS / JFI) and includes all items
 * building contractors need for coordination:
 *
 *   - Traction machine + base (BY VENDOR)
 *   - Deflection sheave (BY VENDOR, 2:1 roping only)
 *   - Control panel (BY VENDOR)
 *   - Holes for hoisting ropes + wire duct (BY OTHERS)
 *   - MR entrance door (BY OTHERS)
 *   - Exhaust fan + power receiving box (BY OTHERS)
 */

import type { ElevatorDesign } from '../solver/types'

// --- MR sizing defaults (mm) ---
// MR extends slightly beyond the shaft to accommodate machine + maintenance.
const MR_OVERHANG_EACH_SIDE = 800
const MR_OVERHANG_FRONT = 600
const MR_OVERHANG_BACK = 400

// --- Fixed equipment footprints (mm, typical for mid-range passenger lift) ---
const MACHINE_W = 1600
const MACHINE_D = 600
const SHEAVE_R = 350
const CONTROL_PANEL_W = 600
const CONTROL_PANEL_D = 300
const ROPE_HOLE_W = 200
const ROPE_HOLE_D = 200
const DUCT_HOLE_W = 220
const DUCT_HOLE_D = 220
const MR_DOOR_W = 1200
const EXHAUST_FAN_R = 200
const POWER_BOX_W = 400
const POWER_BOX_D = 200

export interface MrPlanBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function drawLabelWithLeader(
  dw: any,
  labelX: number,
  labelY: number,
  targetX: number,
  targetY: number,
  text: string,
  align: 'left' | 'right' | 'center' = 'left',
  textH: number = 80,
): void {
  dw.drawText(labelX, labelY, textH, 0, text, align)
  dw.drawLine(labelX, labelY, targetX, targetY)
}

export function drawMachineRoomPlan(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
): MrPlanBBox {
  const { shaft } = design
  const ox = origin.x
  const oy = origin.y

  // MR floor outline: shaft plus overhangs on all four sides.
  const mrX0 = ox - MR_OVERHANG_EACH_SIDE
  const mrY0 = oy - MR_OVERHANG_BACK
  const mrX1 = ox + shaft.width_mm + MR_OVERHANG_EACH_SIDE
  const mrY1 = oy + shaft.depth_mm + MR_OVERHANG_FRONT
  const mrW = mrX1 - mrX0
  const mrD = mrY1 - mrY0

  // --- MR walls (thick outline) ---
  dw.setActiveLayer('WALL')
  dw.drawRect(mrX0, mrY0, mrX1, mrY1)

  // --- Shaft outline (dashed, represents the shaft directly below) ---
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, oy, ox + shaft.width_mm, oy + shaft.depth_mm)

  // --- Shaft centerline (Ç CAR) — matches plan view convention ---
  dw.setActiveLayer('CENTER')
  const cx = ox + shaft.width_mm / 2
  dw.drawLine(cx, mrY0 - 200, cx, mrY1 + 200)

  // --- Rope hole above shaft (centered over car) ---
  const ropeHoleX = cx - ROPE_HOLE_W / 2
  const ropeHoleY = oy + shaft.depth_mm / 2 - ROPE_HOLE_D / 2
  dw.setActiveLayer('NOTE')
  dw.drawRect(
    ropeHoleX,
    ropeHoleY,
    ropeHoleX + ROPE_HOLE_W,
    ropeHoleY + ROPE_HOLE_D,
  )

  // --- Traction machine (centered over rope hole, aligned front-to-back) ---
  const machineX = cx - MACHINE_W / 2
  const machineY = oy + shaft.depth_mm / 2 - MACHINE_D / 2
  dw.setActiveLayer('MACHINE')
  dw.drawRect(
    machineX,
    machineY,
    machineX + MACHINE_W,
    machineY + MACHINE_D,
  )

  // Deflection sheave — only for 2:1 roping (MR elevators with MRL-style routing)
  // For now we draw it on MR plans as a reference circle.
  const sheaveCx = cx + MACHINE_W / 2 - SHEAVE_R - 100
  const sheaveCy = machineY + MACHINE_D / 2
  dw.drawCircle(sheaveCx, sheaveCy, SHEAVE_R)

  // --- Control panel (left wall) ---
  const cpX = mrX0 + 400
  const cpY = mrY0 + mrD / 2 - CONTROL_PANEL_D / 2
  dw.setActiveLayer('MACHINE')
  dw.drawRect(cpX, cpY, cpX + CONTROL_PANEL_W, cpY + CONTROL_PANEL_D)

  // --- Duct hole (near control panel) ---
  const ductX = cpX + CONTROL_PANEL_W + 200
  const ductY = cpY + CONTROL_PANEL_D / 2 - DUCT_HOLE_D / 2
  dw.setActiveLayer('NOTE')
  dw.drawRect(ductX, ductY, ductX + DUCT_HOLE_W, ductY + DUCT_HOLE_D)

  // --- Power receiving box (right of control panel, on left wall) ---
  const powerX = mrX0 + 400
  const powerY = cpY + CONTROL_PANEL_D + 500
  dw.setActiveLayer('MACHINE')
  dw.drawRect(powerX, powerY, powerX + POWER_BOX_W, powerY + POWER_BOX_D)

  // --- Exhaust fan (back wall, small circle) ---
  const fanCx = mrX0 + mrW / 4
  const fanCy = mrY0 + 250
  dw.setActiveLayer('MACHINE')
  dw.drawCircle(fanCx, fanCy, EXHAUST_FAN_R)

  // --- MR entrance door (right side, with swing arrow) ---
  const doorCx = mrX1 - 400 - MR_DOOR_W / 2
  const doorY = mrY1
  dw.setActiveLayer('DOOR')
  // Draw the opening as a gap with two short perpendicular lines
  dw.drawLine(doorCx - MR_DOOR_W / 2, doorY, doorCx - MR_DOOR_W / 2, doorY - 80)
  dw.drawLine(doorCx + MR_DOOR_W / 2, doorY, doorCx + MR_DOOR_W / 2, doorY - 80)
  // Door leaf at 45° (swing open indication)
  dw.drawLine(
    doorCx - MR_DOOR_W / 2,
    doorY,
    doorCx - MR_DOOR_W / 2 + MR_DOOR_W * 0.7,
    doorY + MR_DOOR_W * 0.7,
  )

  // --- BY OTHERS / BY VENDOR callouts ---
  dw.setActiveLayer('NOTE')
  const calloutX = mrX1 + 500
  const lineH = 180
  let calloutY = mrY1 - 300
  const callouts: Array<[string, number, number]> = [
    [`HOIST BEAM 2000 kg (BY OTHERS)`, cx, mrY1 - 50],
    [`HOLE FOR HOISTING ROPES ${ROPE_HOLE_W}×${ROPE_HOLE_D} (BY OTHERS)`,
      ropeHoleX + ROPE_HOLE_W / 2,
      ropeHoleY + ROPE_HOLE_D / 2],
    [`TRACTION MACHINE (BY VENDOR)`, machineX + MACHINE_W / 2, machineY + MACHINE_D],
    [`CONTROL PANEL (BY VENDOR)`, cpX + CONTROL_PANEL_W / 2, cpY],
    [`HOLE FOR WIRE DUCT ${DUCT_HOLE_W}×${DUCT_HOLE_D} (BY OTHERS)`,
      ductX + DUCT_HOLE_W / 2,
      ductY + DUCT_HOLE_D / 2],
    [`POWER RECEIVING BOX (BY OTHERS)`, powerX + POWER_BOX_W / 2, powerY + POWER_BOX_D],
    [`EXHAUST FAN (BY OTHERS)`, fanCx, fanCy + EXHAUST_FAN_R],
    [`MR ENTRANCE ${MR_DOOR_W}W × 2100H (BY OTHERS)`, doorCx, doorY + 400],
  ]
  for (const [text, tx, ty] of callouts) {
    drawLabelWithLeader(dw, calloutX, calloutY, tx, ty, text, 'left', 75)
    calloutY -= lineH
  }

  // --- MR overall dimensions ---
  dw.setActiveLayer('DIMS')
  dw.drawText(
    (mrX0 + mrX1) / 2,
    mrY0 - 400,
    140,
    0,
    `MR W ${mrW}`,
    'center',
  )
  dw.drawText(
    mrX0 - 400,
    (mrY0 + mrY1) / 2,
    140,
    90,
    `MR D ${mrD}`,
    'center',
  )

  // --- Title ---
  dw.setActiveLayer('TEXT')
  dw.drawText(
    (mrX0 + mrX1) / 2,
    mrY0 - 800,
    180,
    0,
    'MACHINE ROOM PLAN / 機房平面圖',
    'center',
  )

  return {
    minX: mrX0 - 600,
    minY: mrY0 - 1100,
    maxX: mrX1 + 500,
    maxY: mrY1 + 600,
  }
}
