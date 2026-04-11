/**
 * Spike 1 — DXF parser feasibility POC
 *
 * 問題：電梯設計師用 AutoCAD 畫坑道 → 存成 DWG 或 DXF 檔。
 * 我們要從這些檔案自動抽出坑道尺寸（W, D）以及可能的註記。
 *
 * 本 spike 驗證「DXF 檔可以被 TypeScript 程式讀出結構化資料」這個前提。
 * 如果這個驗證通過，資料考古階段就能以 DXF parser 為核心。
 * 如果失敗，就要 fallback 到手動 key 入或 OCR。
 *
 * 執行：bun spikes/spike-1-dxf-parser/parse.ts
 */

// dxf-parser v1.x doesn't ship TypeScript types so we require it loosely.
// For the spike this is acceptable; Sprint 1 will add a thin typed wrapper.
// @ts-ignore
import DxfParser from 'dxf-parser'

const fixturePath = new URL('./fixture.dxf', import.meta.url)
const dxfText = await Bun.file(fixturePath).text()

const parser = new DxfParser()
const dxf = parser.parseSync(dxfText) as {
  entities: Array<{
    type: string
    layer?: string
    vertices?: Array<{ x: number; y: number; z?: number }>
    text?: string
    position?: { x: number; y: number; z?: number }
    startPoint?: { x: number; y: number; z?: number }
    endPoint?: { x: number; y: number; z?: number }
  }>
}

if (!dxf?.entities) {
  console.error('FAIL: parser returned no entities')
  process.exit(1)
}

console.log(`Parsed ${dxf.entities.length} entities from fixture.dxf`)
console.log('Entity types seen:', new Set(dxf.entities.map((e) => e.type)))

// ---- Extract LINE entities on SHAFT layer, compute bounding box ----

const shaftLines = dxf.entities.filter(
  (e) => e.type === 'LINE' && e.layer === 'SHAFT'
)

if (shaftLines.length === 0) {
  console.error('FAIL: no SHAFT-layer lines found')
  process.exit(1)
}

let minX = Number.POSITIVE_INFINITY
let minY = Number.POSITIVE_INFINITY
let maxX = Number.NEGATIVE_INFINITY
let maxY = Number.NEGATIVE_INFINITY

for (const line of shaftLines) {
  const points: Array<{ x: number; y: number }> = []
  if (line.vertices && line.vertices.length > 0) {
    points.push(...line.vertices)
  } else if (line.startPoint && line.endPoint) {
    points.push(line.startPoint, line.endPoint)
  }
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
}

const width_mm = Math.round(maxX - minX)
const depth_mm = Math.round(maxY - minY)

// ---- Extract TEXT annotations (candidate dimension labels) ----

const textEntities = dxf.entities.filter((e) => e.type === 'TEXT')
const annotations = textEntities.map((t) => t.text).filter(Boolean)

// ---- Output ----

const result = {
  spike: 'spike-1-dxf-parser',
  pass: width_mm > 0 && depth_mm > 0,
  extracted: {
    width_mm,
    depth_mm,
    annotations,
    shaft_line_count: shaftLines.length,
  },
  boundingBox: { minX, minY, maxX, maxY },
  notes: [
    'Bounding box extraction works for axis-aligned rectangular shafts.',
    'Real-world DXF files may include arcs, dimensions, blocks, inserts — Sprint 1 must handle those.',
    'Text annotations present but unparsed — future work to extract W=/D=/H= labels.',
  ],
}

console.log(JSON.stringify(result, null, 2))

if (!result.pass) {
  console.error('SPIKE 1 FAILED')
  process.exit(1)
}

console.log('\nSPIKE 1 PASSED')
