/**
 * Spec table — 12 industry-standard fields shown as a two-column table.
 *
 * Fields chosen from the consensus of Mitsubishi MEUS + Schindler S330 +
 * KONE MonoSpace + JFI drawings. Ordered top-to-bottom as:
 *   Type, Capacity, Speed, Control, Power, Stops, Travel,
 *   Cab Size, Opening, Rope, Ratio, Guide Rail.
 */

import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'

export interface SpecTableRow {
  label: string
  value: string
}

const WIDTH_MM = 3000
const ROW_H = 180
const HEADER_H = 260
const LABEL_COL_FRAC = 0.4

const USAGE_LABELS: Record<string, string> = {
  passenger: 'Passenger Lift',
  freight: 'Freight Elevator',
  bed: 'Hospital / Bed Lift',
  accessible: 'Accessible Lift',
}

function formatLoad(kg: number): string {
  return `${kg} kg`
}

function formatSpeed(mpm: number): string {
  return `${mpm} m/min`
}

function formatTravel(design: ElevatorDesign): string {
  // Derive travel height from total height minus pit/overhead.
  const travel = design.shaft.total_height_mm - design.shaft.pit_depth_mm - design.shaft.overhead_mm
  return `${Math.max(0, Math.round(travel))} mm`
}

function formatOpening(design: ElevatorDesign): string {
  const type = design.door.type === 'center_opening' ? 'CO' : 'SO'
  return `${type} ${design.door.width_mm}`
}

function formatCabSize(design: ElevatorDesign): string {
  const { width_mm, depth_mm, height_mm } = design.car
  return `${width_mm} × ${depth_mm} × ${height_mm}`
}

export function buildSpecRows(
  design: ElevatorDesign,
  config: EffectiveConfig,
): SpecTableRow[] {
  const usageLabel = USAGE_LABELS[design.shaft.usage] ?? design.shaft.usage
  const carRail = `Car ${config.rail.car_size_mm} × ${config.rail.car_size_mm}`
  const cwtRail = `Cwt ${config.rail.cwt_size_mm} × ${config.rail.cwt_size_mm}`
  return [
    { label: 'Type',       value: usageLabel },
    { label: 'Capacity',   value: formatLoad(design.rated_load_kg) },
    { label: 'Speed',      value: formatSpeed(design.rated_speed_mpm) },
    { label: 'Control',    value: 'AC-VVVF' },
    { label: 'Power',      value: '3P 220V 60Hz' },
    { label: 'Stops',      value: `${design.shaft.stops}F / ${design.shaft.stops}S` },
    { label: 'Travel',     value: formatTravel(design) },
    { label: 'Cab Size',   value: formatCabSize(design) },
    { label: 'Opening',    value: formatOpening(design) },
    { label: 'Rope',       value: 'Ø10 × 4' },
    { label: 'Ratio',      value: design.machine_location === 'MRL' ? '2:1' : '1:1' },
    { label: 'Guide Rail', value: `${carRail}, ${cwtRail}` },
  ]
}

export function drawSpecBlock(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  config?: EffectiveConfig,
): void {
  const ox = origin.x
  const oy = origin.y

  // For legacy callers without a config, fall back to a minimal subset.
  const rows: SpecTableRow[] = config
    ? buildSpecRows(design, config)
    : buildFallbackRows(design)
  const totalHeight = HEADER_H + ROW_H * rows.length

  dw.setActiveLayer('SPEC')

  // Outer frame
  dw.drawRect(ox, oy, ox + WIDTH_MM, oy + totalHeight)

  // Header separator
  const headerBottom = oy + totalHeight - HEADER_H
  dw.drawLine(ox, headerBottom, ox + WIDTH_MM, headerBottom)

  // Column separator
  const colX = ox + WIDTH_MM * LABEL_COL_FRAC
  dw.drawLine(colX, oy, colX, headerBottom)

  // Row separators
  for (let i = 1; i < rows.length; i++) {
    const y = oy + ROW_H * i
    dw.drawLine(ox, y, ox + WIDTH_MM, y)
  }

  // Header text
  dw.setActiveLayer('TEXT')
  dw.drawText(
    ox + WIDTH_MM / 2,
    oy + totalHeight - HEADER_H / 2 - 45,
    150,
    0,
    'MAIN SPECIFICATION',
    'center',
  )

  // Row text
  const textH = 110
  const padX = 80
  const padY = 55
  for (let i = 0; i < rows.length; i++) {
    // Rows are drawn bottom-up; topmost row displays the first field.
    const rowIndex = rows.length - 1 - i
    const row = rows[rowIndex]
    const y = oy + ROW_H * i + padY
    dw.drawText(ox + padX, y, textH, 0, row.label)
    dw.drawText(colX + padX, y, textH, 0, row.value)
  }
}

function buildFallbackRows(design: ElevatorDesign): SpecTableRow[] {
  return [
    { label: 'Type',     value: USAGE_LABELS[design.shaft.usage] ?? design.shaft.usage },
    { label: 'Capacity', value: formatLoad(design.rated_load_kg) },
    { label: 'Speed',    value: formatSpeed(design.rated_speed_mpm) },
    { label: 'Stops',    value: `${design.shaft.stops}F` },
    { label: 'Travel',   value: formatTravel(design) },
    { label: 'Cab Size', value: formatCabSize(design) },
    { label: 'Opening',  value: formatOpening(design) },
  ]
}

export function specBlockBBox(rowCount: number = 12): { width: number; height: number } {
  return { width: WIDTH_MM, height: HEADER_H + ROW_H * rowCount }
}
