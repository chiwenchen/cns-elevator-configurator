/**
 * Spike 1 Demo Server — visualize DXF parsing on sample_building.dxf
 *
 * Routes:
 *   GET /             → demo HTML page
 *   GET /api/analysis → JSON: polygons + elevator matches + metadata
 *
 * Run: bun src/demo/server.ts
 */

// @ts-ignore
import DxfParser from 'dxf-parser'
import { homedir } from 'os'
import { join } from 'path'

type Point = { x: number; y: number }
type Bbox = { minX: number; minY: number; maxX: number; maxY: number }

const SOURCE_PATHS: Record<string, string> = {
  'hack-canada': join(homedir(), 'cns-data', 'sample_building.dxf'),
  generated: join(homedir(), 'cns-data', 'spike4-generated.dxf'),
}
const DEFAULT_SOURCE = 'hack-canada'

// ---- Router ----

async function analyze(source: string = DEFAULT_SOURCE) {
  if (source === 'generated') return analyzeGenerated()
  return analyzeHackCanada(source)
}

// ---- Analysis: generated Spike 4 DXF (simpler — render by layer) ----

async function analyzeGenerated() {
  const filePath = SOURCE_PATHS.generated
  const dxfText = await Bun.file(filePath).text()
  const parser = new DxfParser()
  const dxf: any = parser.parseSync(dxfText)

  const entities = dxf.entities || []

  // Collect polylines by layer
  type Poly = { vertices: Point[]; layer: string; closed: boolean }
  const polys: Poly[] = []
  const lines: Array<{ a: Point; b: Point; layer: string }> = []
  const texts: Array<{ text: string; position: Point; layer: string; height: number }> = []

  for (const e of entities) {
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      if (!Array.isArray(e.vertices)) continue
      const vs: Point[] = e.vertices
        .filter((v: any) => typeof v.x === 'number')
        .map((v: any) => ({ x: v.x, y: v.y }))
      if (vs.length < 2) continue
      polys.push({ vertices: vs, layer: e.layer || '0', closed: vs.length >= 4 })
    } else if (e.type === 'LINE') {
      const a = e.startPoint || (e.vertices && e.vertices[0])
      const b = e.endPoint || (e.vertices && e.vertices[1])
      if (!a || !b) continue
      lines.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, layer: e.layer || '0' })
    } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
      const pos = e.position || e.startPoint
      if (!pos || typeof pos.x !== 'number') continue
      texts.push({
        text: e.text || '',
        position: { x: pos.x, y: pos.y },
        layer: e.layer || '0',
        height: e.textHeight || e.height || 100,
      })
    }
  }

  // Overall bbox across all content
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const consume = (p: Point) => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  for (const p of polys) for (const v of p.vertices) consume(v)
  for (const l of lines) { consume(l.a); consume(l.b) }
  for (const t of texts) consume(t.position)

  // Shaft summary: find SHAFT layer closed polys, report their W×H
  const shaftGroups = polys
    .filter((p) => p.layer === 'SHAFT' && p.closed)
    .map((p) => {
      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity
      for (const v of p.vertices) {
        if (v.x < pMinX) pMinX = v.x
        if (v.y < pMinY) pMinY = v.y
        if (v.x > pMaxX) pMaxX = v.x
        if (v.y > pMaxY) pMaxY = v.y
      }
      return {
        width_mm: Math.round(pMaxX - pMinX),
        depth_mm: Math.round(pMaxY - pMinY),
        instance_count: 1,
        labels: ['SHAFT'],
      }
    })

  return {
    source: 'generated',
    file: filePath,
    file_kb: Math.round(dxfText.length / 1024),
    unit: 'Millimeters',
    entity_count: entities.length,
    room_count: polys.length,
    wall_count: 0,
    door_count: 0,
    window_count: 0,
    column_count: 0,
    balcony_count: 0,
    insert_count: 0,
    elevator_label_count: 0,
    matched_room_count: polys.filter((p) => p.layer === 'CAR').length,
    building_bbox: { minX, minY, maxX, maxY },
    // Map to the same schema as hack-canada so the front-end code is one path
    rooms: polys.map((p, i) => ({
      id: i,
      vertices: p.vertices,
      is_elevator: p.layer === 'CAR' || p.layer === 'DOOR',
      layer: p.layer,
    })),
    walls: [],
    doors: [],
    windows: [],
    columns: [],
    balconies: [],
    inserts: [],
    elevator_labels: [],
    // Expose raw lines and texts so the front-end can render them (only for generated)
    extra_lines: lines,
    extra_texts: texts,
    shaft_groups: shaftGroups,
  }
}

// ---- Analysis: Hack_Canada AIA-style architectural DXF ----

async function analyzeHackCanada(source: string) {
  const filePath = SOURCE_PATHS[source] || SOURCE_PATHS[DEFAULT_SOURCE]
  const dxfText = await Bun.file(filePath).text()
  const parser = new DxfParser()
  const dxf: any = parser.parseSync(dxfText)

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

  const polygonBbox = (vs: Point[]): Bbox => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const v of vs) {
      if (v.x < minX) minX = v.x
      if (v.y < minY) minY = v.y
      if (v.x > maxX) maxX = v.x
      if (v.y > maxY) maxY = v.y
    }
    return { minX, minY, maxX, maxY }
  }

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

  // All A-ROOM-BDRY polygons (thin outlines for background rendering)
  type Room = {
    id: number
    vertices: Point[]
    bbox: Bbox
    area: number
  }
  const rooms: Room[] = []
  let nextId = 0
  for (const e of dxf.entities) {
    if (e.layer !== 'A-ROOM-BDRY') continue
    if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') continue
    if (!Array.isArray(e.vertices) || e.vertices.length < 3) continue
    const vs: Point[] = e.vertices
      .filter((v: any) => typeof v.x === 'number' && typeof v.y === 'number')
      .map((v: any) => ({ x: v.x, y: v.y }))
    if (vs.length < 3) continue
    const b = polygonBbox(vs)
    rooms.push({
      id: nextId++,
      vertices: vs,
      bbox: b,
      area: (b.maxX - b.minX) * (b.maxY - b.minY),
    })
  }

  // Helper: extract polyline vertices from an entity regardless of shape
  const extractVertices = (e: any): Point[] => {
    if (e.type === 'LINE') {
      if (e.vertices && e.vertices.length >= 2) {
        return e.vertices.map((v: any) => ({ x: v.x, y: v.y }))
      }
      if (e.startPoint && e.endPoint) {
        return [
          { x: e.startPoint.x, y: e.startPoint.y },
          { x: e.endPoint.x, y: e.endPoint.y },
        ]
      }
      return []
    }
    if (Array.isArray(e.vertices)) {
      return e.vertices
        .filter((v: any) => typeof v.x === 'number' && typeof v.y === 'number')
        .map((v: any) => ({ x: v.x, y: v.y }))
    }
    return []
  }

  // Layer categories we render as polygons/polylines
  const wallLayers = new Set(['A-WALL-STRC', 'A-WALL-EXTR', 'A-WALL-PART'])
  const doorLayers = new Set(['A-DOOR'])
  const windowLayers = new Set(['A-WINDOW'])
  const columnLayers = new Set(['S-COLS'])
  const balconyLayers = new Set(['A-BALCONY'])

  const walls: Point[][] = []
  const doors: Point[][] = []
  const windows: Point[][] = []
  const columns: Point[][] = []
  const balconies: Point[][] = []
  const inserts: Array<{ layer: string; position: Point; name: string }> = []

  for (const e of dxf.entities) {
    const layer = e.layer || ''
    if (e.type === 'INSERT' && e.position) {
      inserts.push({
        layer,
        position: { x: e.position.x, y: e.position.y },
        name: e.name || '',
      })
      continue
    }
    if (!['LWPOLYLINE', 'POLYLINE', 'LINE'].includes(e.type)) continue
    const vs = extractVertices(e)
    if (vs.length === 0) continue
    if (wallLayers.has(layer)) walls.push(vs)
    else if (doorLayers.has(layer)) doors.push(vs)
    else if (windowLayers.has(layer)) windows.push(vs)
    else if (columnLayers.has(layer)) columns.push(vs)
    else if (balconyLayers.has(layer)) balconies.push(vs)
  }

  // Elevator labels
  type ElevLabel = { text: string; position: Point; matchedRoomId: number | null }
  const elevLabels: ElevLabel[] = []
  for (const e of dxf.entities) {
    if (e.type !== 'TEXT' && e.type !== 'MTEXT') continue
    const text = (e.text || '').toLowerCase()
    if (!text.includes('elev')) continue
    const pos = e.position || e.startPoint
    if (!pos || typeof pos.x !== 'number') continue
    elevLabels.push({
      text: e.text,
      position: { x: pos.x, y: pos.y },
      matchedRoomId: null,
    })
  }

  // Match labels to rooms via point-in-polygon (smallest containing room)
  for (const l of elevLabels) {
    const containing = rooms
      .filter((r) => pointInPolygon(l.position, r.vertices))
      .sort((a, b) => a.area - b.area)
    if (containing.length > 0) l.matchedRoomId = containing[0].id
  }

  // Deduplicate elevator rooms by id
  const matchedRoomIds = new Set(
    elevLabels.filter((l) => l.matchedRoomId !== null).map((l) => l.matchedRoomId!)
  )
  const matchedRooms = rooms.filter((r) => matchedRoomIds.has(r.id))

  // Group labels by matched room
  const labelsByRoom = new Map<number, string[]>()
  for (const l of elevLabels) {
    if (l.matchedRoomId === null) continue
    const key = l.matchedRoomId
    if (!labelsByRoom.has(key)) labelsByRoom.set(key, [])
    const arr = labelsByRoom.get(key)!
    if (!arr.includes(l.text)) arr.push(l.text)
  }

  // Building bbox
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity
  for (const r of rooms) {
    if (r.bbox.minX < bMinX) bMinX = r.bbox.minX
    if (r.bbox.minY < bMinY) bMinY = r.bbox.minY
    if (r.bbox.maxX > bMaxX) bMaxX = r.bbox.maxX
    if (r.bbox.maxY > bMaxY) bMaxY = r.bbox.maxY
  }
  const buildingBbox = { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY }

  // Shaft summary (dedup by w×d)
  type ShaftGroup = {
    width_mm: number
    depth_mm: number
    instance_count: number
    labels: string[]
    sample_room_bbox: Bbox
  }
  const byDims = new Map<string, ShaftGroup>()
  for (const r of matchedRooms) {
    const w = Math.round(toMm(r.bbox.maxX - r.bbox.minX))
    const d = Math.round(toMm(r.bbox.maxY - r.bbox.minY))
    const key = `${w}x${d}`
    const labels = labelsByRoom.get(r.id) || []
    const existing = byDims.get(key)
    if (existing) {
      existing.instance_count++
      for (const lbl of labels) if (!existing.labels.includes(lbl)) existing.labels.push(lbl)
    } else {
      byDims.set(key, {
        width_mm: w,
        depth_mm: d,
        instance_count: 1,
        labels: [...labels],
        sample_room_bbox: r.bbox,
      })
    }
  }
  const shaftGroups = Array.from(byDims.values()).sort((a, b) => b.instance_count - a.instance_count)

  return {
    source,
    file: filePath,
    file_kb: Math.round(dxfText.length / 1024),
    unit: unitName,
    entity_count: dxf.entities.length,
    room_count: rooms.length,
    wall_count: walls.length,
    door_count: doors.length,
    window_count: windows.length,
    column_count: columns.length,
    balcony_count: balconies.length,
    insert_count: inserts.length,
    elevator_label_count: elevLabels.length,
    matched_room_count: matchedRooms.length,
    building_bbox: buildingBbox,
    rooms: rooms.map((r) => ({
      id: r.id,
      vertices: r.vertices,
      is_elevator: matchedRoomIds.has(r.id),
    })),
    walls,
    doors,
    windows,
    columns,
    balconies,
    inserts,
    elevator_labels: elevLabels,
    shaft_groups: shaftGroups,
  }
}

// ---- Server ----

const indexHtml = await Bun.file(join(import.meta.dir, 'index.html')).text()

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') {
      return new Response(indexHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    if (url.pathname === '/api/analysis') {
      const source = url.searchParams.get('source') || DEFAULT_SOURCE
      try {
        const data = await analyze(source)
        return Response.json(data)
      } catch (err) {
        return Response.json(
          { error: String(err), hint: `DXF source: ${source}` },
          { status: 500 }
        )
      }
    }
    if (url.pathname === '/favicon.ico') {
      // Empty 1×1 transparent PNG so browsers stop 404-ing
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  },
})

console.log(`Spike 1 demo running at http://localhost:${server.port}`)
console.log(`Sources:`)
for (const [key, path] of Object.entries(SOURCE_PATHS)) {
  console.log(`  ${key.padEnd(15)} ${path}`)
}
