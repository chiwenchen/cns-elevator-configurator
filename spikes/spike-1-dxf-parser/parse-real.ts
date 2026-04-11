/**
 * Spike 1 — Real-world DXF validation with room-boundary extraction
 *
 * Tests the parser against Hack_Canada/sample_building.dxf
 * (AutoCAD 2013, AIA layers, 714 entities, 219 KB, unit = Meters).
 *
 * Strategy (v2, correct):
 * 1. Parse DXF
 * 2. Find all A-ROOM-BDRY LWPOLYLINE entities (room outlines)
 * 3. Find all TEXT entities that mention "elevator"
 * 4. For each elevator text, use point-in-polygon to find which room
 *    boundary contains it → that polygon's bbox IS the elevator room
 * 5. Convert to mm, report
 *
 * This is the pattern Sprint 1 data archaeology will use for real
 * customer CAD files: rooms are polygons on A-ROOM-BDRY layer,
 * room names are on A-ROOM-NAME layer, you join them geometrically.
 *
 * Run: bun spikes/spike-1-dxf-parser/parse-real.ts
 */

// @ts-ignore
import DxfParser from 'dxf-parser'
import { homedir } from 'os'
import { join } from 'path'

type Point = { x: number; y: number }
type Bbox = { minX: number; minY: number; maxX: number; maxY: number }

const dxfPath = join(homedir(), 'cns-data', 'sample_building.dxf')
const dxfText = await Bun.file(dxfPath).text()

console.log(`Reading: ${dxfPath}`)
console.log(`File size: ${(dxfText.length / 1024).toFixed(1)} KB`)

const parser = new DxfParser()
const dxf = parser.parseSync(dxfText) as any

// ---- Unit detection ----
const unitMap: Record<number, string> = {
  0: 'Unitless', 1: 'Inches', 2: 'Feet', 3: 'Miles',
  4: 'Millimeters', 5: 'Centimeters', 6: 'Meters',
}
const unitCode = dxf.header?.$INSUNITS ?? 0
const unitName = unitMap[unitCode] || 'Unknown'
const toMm = (v: number): number => {
  if (unitCode === 4) return v
  if (unitCode === 5) return v * 10
  if (unitCode === 6) return v * 1000
  if (unitCode === 1) return v * 25.4
  if (unitCode === 2) return v * 304.8
  return v
}
console.log(`Unit: ${unitName}\n`)

// ---- Helpers ----
const polygonBbox = (vertices: Point[]): Bbox => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const v of vertices) {
    if (v.x < minX) minX = v.x
    if (v.y < minY) minY = v.y
    if (v.x > maxX) maxX = v.x
    if (v.y > maxY) maxY = v.y
  }
  return { minX, minY, maxX, maxY }
}

/** Classic ray-casting point-in-polygon test. */
const pointInPolygon = (pt: Point, poly: Point[]): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// ---- Step 1: Collect A-ROOM-BDRY polygons ----
const roomBoundaries: Array<{
  vertices: Point[]
  bbox: Bbox
  width: number
  height: number
  area: number
}> = []

for (const e of dxf.entities) {
  if (e.layer !== 'A-ROOM-BDRY') continue
  if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') continue
  if (!Array.isArray(e.vertices) || e.vertices.length < 3) continue
  const vs: Point[] = e.vertices
    .filter((v: any) => typeof v.x === 'number' && typeof v.y === 'number')
    .map((v: any) => ({ x: v.x, y: v.y }))
  if (vs.length < 3) continue
  const b = polygonBbox(vs)
  roomBoundaries.push({
    vertices: vs,
    bbox: b,
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
    area: (b.maxX - b.minX) * (b.maxY - b.minY),
  })
}

console.log(`Found ${roomBoundaries.length} A-ROOM-BDRY polygons`)

// ---- Step 2: Find elevator text labels ----
const elevatorTexts: Array<{ text: string; position: Point }> = []
for (const e of dxf.entities) {
  if (e.type !== 'TEXT' && e.type !== 'MTEXT') continue
  const text = (e.text || '').toLowerCase()
  if (!text.includes('elev')) continue
  const pos = e.position || e.startPoint
  if (!pos || typeof pos.x !== 'number') continue
  elevatorTexts.push({ text: e.text, position: { x: pos.x, y: pos.y } })
}

console.log(`Found ${elevatorTexts.length} elevator text labels\n`)

// ---- Step 3: Join text → polygon via point-in-polygon ----
type Match = {
  label: string
  position: Point
  room_bbox: Bbox
  width_m: number
  depth_m: number
  width_mm: number
  depth_mm: number
}
const matches: Match[] = []
const unmatched: string[] = []

for (const t of elevatorTexts) {
  // Find ALL rooms containing this text point, pick the smallest (most specific)
  const containing = roomBoundaries.filter((r) => pointInPolygon(t.position, r.vertices))
  if (containing.length === 0) {
    unmatched.push(`${t.text} @ (${t.position.x.toFixed(1)}, ${t.position.y.toFixed(1)})`)
    continue
  }
  const smallest = containing.sort((a, b) => a.area - b.area)[0]
  matches.push({
    label: t.text,
    position: t.position,
    room_bbox: smallest.bbox,
    width_m: smallest.width,
    depth_m: smallest.height,
    width_mm: Math.round(toMm(smallest.width)),
    depth_mm: Math.round(toMm(smallest.height)),
  })
}

// ---- Step 4: Deduplicate (same room boundary shared by multi-floor labels) ----
const unique = new Map<string, Match & { label_count: number; labels: string[] }>()
for (const m of matches) {
  const key = `${m.room_bbox.minX.toFixed(2)},${m.room_bbox.minY.toFixed(2)},${m.room_bbox.maxX.toFixed(2)},${m.room_bbox.maxY.toFixed(2)}`
  const existing = unique.get(key)
  if (existing) {
    existing.label_count++
    if (!existing.labels.includes(m.label)) existing.labels.push(m.label)
  } else {
    unique.set(key, { ...m, label_count: 1, labels: [m.label] })
  }
}

const uniqueShafts = Array.from(unique.values())

console.log(`Matched ${matches.length}/${elevatorTexts.length} labels to room polygons`)
console.log(`Deduplicated to ${uniqueShafts.length} unique shaft regions\n`)

if (unmatched.length > 0) {
  console.log('Unmatched labels (no containing room polygon):')
  unmatched.forEach((u) => console.log(`  ${u}`))
  console.log()
}

console.log('Unique elevator shaft / core regions:')
for (const s of uniqueShafts) {
  console.log(`\n  labels: ${JSON.stringify(s.labels)} (×${s.label_count} floor instances)`)
  console.log(`  text pos: (${s.position.x.toFixed(2)}, ${s.position.y.toFixed(2)})`)
  console.log(`  room bbox: (${s.room_bbox.minX.toFixed(2)}, ${s.room_bbox.minY.toFixed(2)}) → (${s.room_bbox.maxX.toFixed(2)}, ${s.room_bbox.maxY.toFixed(2)})`)
  console.log(`  dimensions: ${s.width_m.toFixed(2)} m × ${s.depth_m.toFixed(2)} m`)
  console.log(`  → ${s.width_mm} mm × ${s.depth_mm} mm`)
}

// ---- Sanity check ----
const realisticRanges = uniqueShafts.filter(
  (s) => s.width_mm >= 1000 && s.width_mm <= 6000 && s.depth_mm >= 1000 && s.depth_mm <= 6000
)

const result = {
  spike: 'spike-1-real-dxf-room-boundary-extraction',
  file: dxfPath,
  file_kb: Math.round(dxfText.length / 1024),
  parser: 'dxf-parser@1.1.2',
  pass: uniqueShafts.length > 0,
  entity_count: dxf.entities.length,
  unit: unitName,
  room_boundaries_found: roomBoundaries.length,
  elevator_labels_found: elevatorTexts.length,
  labels_matched_to_rooms: matches.length,
  unique_shafts: uniqueShafts.length,
  realistic_shafts: realisticRanges.length,
  realistic_note: `Realistic elevator shaft = 1-6 m both dimensions. ${realisticRanges.length}/${uniqueShafts.length} shafts fall in this range.`,
}

console.log('\n' + JSON.stringify(result, null, 2))
console.log(result.pass ? '\nSPIKE 1 REAL: PASS' : '\nSPIKE 1 REAL: FAIL')
