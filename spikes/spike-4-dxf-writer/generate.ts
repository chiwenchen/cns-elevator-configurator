/**
 * Spike 4 — Parametric DXF Writer POC
 *
 * 驗證：給定一組電梯設計參數，能不能用 TypeScript 程式化地產出
 * 一份**可行性草稿 DXF**，含平面圖 + 側面圖 + 關鍵尺寸標示，而且這份
 * DXF 能被原本的 dxf-parser (Spike 1) 讀回來、算出正確的坑道尺寸。
 *
 * 這個 spike 是真實需求的核心驗證 — 如果這一步不 work，整個 MVP 的
 * 輸出形式（DXF 草稿）就要重新評估。
 *
 * 執行：
 *   bun spikes/spike-4-dxf-writer/generate.ts
 *
 * 產出：
 *   ~/cns-data/spike4-generated.dxf
 */

// @ts-ignore
import Drawing from 'dxf-writer'
// @ts-ignore
import DxfParser from 'dxf-parser'
import { homedir } from 'os'
import { join } from 'path'

// ---- Design input ----

type ElevatorDesign = {
  /** Shaft inner dimensions (mm) */
  shaft_width_mm: number
  shaft_depth_mm: number
  shaft_total_height_mm: number

  /** CNS 15827-20 hard constraints (mm) */
  overhead_mm: number
  pit_depth_mm: number

  /** Car dimensions (mm) */
  car_width_mm: number
  car_depth_mm: number
  car_height_mm: number

  /** Door (mm) */
  door_width_mm: number

  /** Trip */
  stops: number

  /** Usage: drives CNS validation + label */
  usage: 'passenger' | 'freight' | 'bed' | 'accessible'

  /** Rated load (kg) — displayed on drawing */
  rated_load_kg: number
  /** Rated speed (m/min) — displayed on drawing */
  rated_speed_mpm: number
}

// ---- Spike 4 input: a plausible standard passenger elevator ----

const design: ElevatorDesign = {
  shaft_width_mm: 2000,
  shaft_depth_mm: 2200,
  shaft_total_height_mm: 18000, // 6 floors × 3m
  overhead_mm: 4200,
  pit_depth_mm: 1600,

  car_width_mm: 1400,
  car_depth_mm: 1350,
  car_height_mm: 2300,

  door_width_mm: 900,

  stops: 6,
  usage: 'passenger',
  rated_load_kg: 750,
  rated_speed_mpm: 60,
}

// ---- Helpers ----

const sideClearance = (shaft: number, car: number) => (shaft - car) / 2

// ---- Generate ----

function generate(d: ElevatorDesign): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')

  // Layer palette — match CAD conventions
  dw.addLayer('SHAFT', Drawing.ACI.WHITE, 'CONTINUOUS')
  dw.addLayer('CAR', Drawing.ACI.YELLOW, 'CONTINUOUS')
  dw.addLayer('DOOR', Drawing.ACI.CYAN, 'CONTINUOUS')
  dw.addLayer('STOP', Drawing.ACI.GREEN, 'CONTINUOUS')
  dw.addLayer('DIMS', Drawing.ACI.MAGENTA, 'CONTINUOUS')
  dw.addLayer('TEXT', Drawing.ACI.WHITE, 'CONTINUOUS')

  // ---- PLAN VIEW (top-down, placed at origin) ----
  // Origin of plan view: (0, 0) = back-left corner of shaft
  const planOX = 0
  const planOY = 0

  // Shaft outer rectangle
  dw.setActiveLayer('SHAFT')
  dw.drawRect(
    planOX,
    planOY,
    planOX + d.shaft_width_mm,
    planOY + d.shaft_depth_mm
  )

  // Car rectangle — centered in X, biased toward door side (+Y = front)
  const carDx = sideClearance(d.shaft_width_mm, d.car_width_mm)
  // For plan view we put car at back (depth-wise), leaving space for door approach
  const carDy = d.shaft_depth_mm - d.car_depth_mm - 150 // 150mm front clearance
  dw.setActiveLayer('CAR')
  dw.drawRect(
    planOX + carDx,
    planOY + carDy,
    planOX + carDx + d.car_width_mm,
    planOY + carDy + d.car_depth_mm
  )

  // Door opening on front wall (Y = planOY + shaft_depth)
  const doorX0 = planOX + (d.shaft_width_mm - d.door_width_mm) / 2
  const doorY = planOY + d.shaft_depth_mm
  dw.setActiveLayer('DOOR')
  // Door jambs (two short perpendicular lines)
  dw.drawLine(doorX0, doorY - 100, doorX0, doorY + 100)
  dw.drawLine(
    doorX0 + d.door_width_mm,
    doorY - 100,
    doorX0 + d.door_width_mm,
    doorY + 100
  )
  // Door opening indicator (dashed open line across the gap)
  dw.drawLine(doorX0, doorY, doorX0 + d.door_width_mm, doorY)

  // Plan view dimensions
  dw.setActiveLayer('DIMS')
  const dimOff = 250
  // Width dim (below shaft)
  dw.drawText(
    planOX + d.shaft_width_mm / 2,
    planOY - dimOff,
    120,
    0,
    `W ${d.shaft_width_mm}`,
    'center'
  )
  // Depth dim (left of shaft)
  dw.drawText(
    planOX - dimOff,
    planOY + d.shaft_depth_mm / 2,
    120,
    90,
    `D ${d.shaft_depth_mm}`,
    'center'
  )
  // Car inner dims (inside car)
  dw.drawText(
    planOX + d.shaft_width_mm / 2,
    planOY + carDy + d.car_depth_mm / 2,
    90,
    0,
    `car ${d.car_width_mm}x${d.car_depth_mm}`,
    'center'
  )
  // Door dim (below door)
  dw.drawText(
    planOX + d.shaft_width_mm / 2,
    doorY + dimOff,
    100,
    0,
    `door ${d.door_width_mm}`,
    'center'
  )

  // Plan view title
  dw.setActiveLayer('TEXT')
  dw.drawText(
    planOX + d.shaft_width_mm / 2,
    planOY - dimOff - 400,
    180,
    0,
    'PLAN VIEW (平面圖)',
    'center'
  )

  // ---- ELEVATION VIEW (side view, placed to the right of plan) ----
  // Origin: (x = plan shaft right + 3000 gap, y = 0 = ground level / lowest floor)
  const elevOX = d.shaft_width_mm + 3500
  const elevOY = 0

  // Shaft total height outline: from pit bottom to overhead top
  const shaftBottom = elevOY - d.pit_depth_mm
  const shaftTop = elevOY + d.shaft_total_height_mm + d.overhead_mm
  dw.setActiveLayer('SHAFT')
  dw.drawRect(
    elevOX,
    shaftBottom,
    elevOX + d.shaft_width_mm,
    shaftTop
  )

  // Ground-floor line + pit area
  dw.drawLine(elevOX, elevOY, elevOX + d.shaft_width_mm, elevOY)

  // Stop levels
  dw.setActiveLayer('STOP')
  const stopSpacing = d.shaft_total_height_mm / (d.stops - 1)
  for (let i = 0; i < d.stops; i++) {
    const y = elevOY + i * stopSpacing
    dw.drawLine(elevOX, y, elevOX + d.shaft_width_mm, y)
    dw.setActiveLayer('TEXT')
    dw.drawText(elevOX - 250, y, 100, 0, `${i + 1}F`, 'right')
    dw.setActiveLayer('STOP')
  }

  // Car at ground level (slightly inset from shaft walls)
  const carInsetX = sideClearance(d.shaft_width_mm, d.car_width_mm)
  dw.setActiveLayer('CAR')
  dw.drawRect(
    elevOX + carInsetX,
    elevOY + 100,
    elevOX + carInsetX + d.car_width_mm,
    elevOY + 100 + d.car_height_mm
  )

  // Top-of-shaft and pit dimension markers
  dw.setActiveLayer('DIMS')
  // Overhead dim
  dw.drawText(
    elevOX + d.shaft_width_mm + 350,
    elevOY + d.shaft_total_height_mm + d.overhead_mm / 2,
    120,
    0,
    `OH ${d.overhead_mm}`
  )
  // Pit dim
  dw.drawText(
    elevOX + d.shaft_width_mm + 350,
    elevOY - d.pit_depth_mm / 2,
    120,
    0,
    `PIT ${d.pit_depth_mm}`
  )
  // Total shaft height dim
  dw.drawText(
    elevOX + d.shaft_width_mm + 1400,
    elevOY + (shaftTop - shaftBottom) / 2 + shaftBottom,
    140,
    90,
    `H ${d.shaft_total_height_mm + d.overhead_mm + d.pit_depth_mm}`,
    'center'
  )

  // Elevation title
  dw.setActiveLayer('TEXT')
  dw.drawText(
    elevOX + d.shaft_width_mm / 2,
    shaftBottom - 400,
    180,
    0,
    'ELEVATION VIEW (側面圖)',
    'center'
  )

  // ---- Spec block (right of elevation) ----
  const specX = elevOX + d.shaft_width_mm + 3500
  const specY = shaftTop
  const specLines = [
    'CNS ELEVATOR DRAFT',
    '',
    `usage:      ${d.usage}`,
    `load:       ${d.rated_load_kg} kg`,
    `speed:      ${d.rated_speed_mpm} m/min`,
    `stops:      ${d.stops}`,
    '',
    `shaft:      ${d.shaft_width_mm} x ${d.shaft_depth_mm}`,
    `height:     ${d.shaft_total_height_mm} mm`,
    `overhead:   ${d.overhead_mm} mm`,
    `pit:        ${d.pit_depth_mm} mm`,
    '',
    `car:        ${d.car_width_mm} x ${d.car_depth_mm} x ${d.car_height_mm}`,
    `door:       ${d.door_width_mm} mm`,
    '',
    `status: DRAFT - engineer review required`,
  ]
  dw.setActiveLayer('TEXT')
  const specLineH = 220
  for (let i = 0; i < specLines.length; i++) {
    dw.drawText(specX, specY - i * specLineH, 140, 0, specLines[i])
  }

  return dw.toDxfString()
}

// ---- Generate + write ----

const outPath = join(homedir(), 'cns-data', 'spike4-generated.dxf')
const dxfString = generate(design)
await Bun.write(outPath, dxfString)

console.log(`Generated: ${outPath}`)
console.log(`Size: ${(dxfString.length / 1024).toFixed(1)} KB`)

// ---- Round-trip: parse the generated DXF with dxf-parser ----

const parser = new DxfParser()
const parsed = parser.parseSync(dxfString) as any

if (!parsed?.entities) {
  console.error('FAIL: parser returned no entities for generated DXF')
  process.exit(1)
}

const typeCounts: Record<string, number> = {}
const layerCounts: Record<string, number> = {}
for (const e of parsed.entities) {
  typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
  const layer = e.layer || '<no layer>'
  layerCounts[layer] = (layerCounts[layer] || 0) + 1
}

console.log('\nRound-trip parse result:')
console.log(`  entities: ${parsed.entities.length}`)
console.log('  entity types:')
for (const [t, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${t.padEnd(15)} ${c}`)
}
console.log('  layers:')
for (const [l, c] of Object.entries(layerCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${l.padEnd(15)} ${c}`)
}

// ---- Validate extracted shaft bbox matches input ----

// Find SHAFT layer LWPOLYLINE (drawn by drawRect) and compute bbox
const shaftPolys = parsed.entities.filter(
  (e: any) => e.layer === 'SHAFT' && (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE')
)
console.log(`\nSHAFT polylines found: ${shaftPolys.length} (expect 2: plan + elevation)`)

let hit = false
for (const p of shaftPolys) {
  if (!Array.isArray(p.vertices)) continue
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const v of p.vertices) {
    if (v.x < minX) minX = v.x
    if (v.y < minY) minY = v.y
    if (v.x > maxX) maxX = v.x
    if (v.y > maxY) maxY = v.y
  }
  const w = Math.round(maxX - minX)
  const h = Math.round(maxY - minY)
  console.log(`  poly bbox: ${w} x ${h} mm at (${minX}, ${minY})`)
  if (w === design.shaft_width_mm && h === design.shaft_depth_mm) {
    console.log(`  → matches PLAN shaft: ${design.shaft_width_mm} × ${design.shaft_depth_mm}`)
    hit = true
  }
  if (w === design.shaft_width_mm && h === design.shaft_total_height_mm + design.overhead_mm + design.pit_depth_mm) {
    console.log(`  → matches ELEVATION shaft height: ${design.shaft_total_height_mm + design.overhead_mm + design.pit_depth_mm}`)
    hit = true
  }
}

console.log(hit ? '\nSPIKE 4: PASS' : '\nSPIKE 4: FAIL (shaft bbox did not match input)')
if (!hit) process.exit(1)
