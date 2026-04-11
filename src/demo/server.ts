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

const DXF_PATH = join(homedir(), 'cns-data', 'sample_building.dxf')

// ---- Analysis (same algorithm as parse-real.ts) ----

async function analyze() {
  const dxfText = await Bun.file(DXF_PATH).text()
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
    file: DXF_PATH,
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
      try {
        const data = await analyze()
        return Response.json(data)
      } catch (err) {
        return Response.json(
          { error: String(err), hint: `Expected DXF at ${DXF_PATH}` },
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
console.log(`DXF source: ${DXF_PATH}`)
