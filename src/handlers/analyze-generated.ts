/**
 * Analysis for generator-style DXF — 讀 SHAFT / CAR / CWT / RAIL_CAR / RAIL_CWT / DOOR 等 layer。
 *
 * 輸入：DXF 字串。輸出：前端 renderSvg 可直接吃的結構。
 *
 * Runtime-neutral — 不呼叫 Bun / Node fs / Cloudflare 任何東西。
 */

// @ts-ignore
import DxfParser from 'dxf-parser'
import type { Point } from './types'

export interface GeneratedAnalysis {
  source: string
  file: string
  file_kb: number
  unit: 'Millimeters'
  entity_count: number
  room_count: number
  wall_count: 0
  door_count: 0
  window_count: 0
  column_count: 0
  balcony_count: 0
  insert_count: 0
  elevator_label_count: 0
  matched_room_count: number
  building_bbox: { minX: number; minY: number; maxX: number; maxY: number }
  rooms: Array<{ id: number; vertices: Point[]; is_elevator: boolean; layer: string }>
  walls: []
  doors: []
  windows: []
  columns: []
  balconies: []
  inserts: []
  elevator_labels: []
  extra_lines: Array<{ a: Point; b: Point; layer: string }>
  extra_texts: Array<{ text: string; position: Point; layer: string; height: number }>
  shaft_groups: Array<{ width_mm: number; depth_mm: number; instance_count: number; labels: string[] }>
}

export function analyzeGeneratedDxf(
  dxfText: string,
  sourceKey: string,
  filePath: string = '(in-memory)'
): GeneratedAnalysis {
  const parser = new DxfParser()
  const dxf: any = parser.parseSync(dxfText)

  const entities = dxf.entities || []

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
    source: sourceKey,
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
    extra_lines: lines,
    extra_texts: texts,
    shaft_groups: shaftGroups,
  }
}
