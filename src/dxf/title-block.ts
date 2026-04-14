/**
 * Title block — project metadata + revision table + disclaimer watermark.
 *
 * Industry convention (Mitsubishi / Schindler style):
 *   ┌────────────────────────────────────────────┐
 *   │  PROJECT:     ...                          │
 *   │  DWG TITLE:   ...                          │
 *   │  DWG NO:      ...   DATE: ...   SCALE: ... │
 *   │  DRAWN BY:    ...   CHECKED BY: ...        │
 *   ├────────────────────────────────────────────┤
 *   │  REV │ DATE │ BY │ DESCRIPTION             │
 *   │   -  │      │    │                         │
 *   ├────────────────────────────────────────────┤
 *   │         NOT FOR CONSTRUCTION               │
 *   └────────────────────────────────────────────┘
 */

import type { ElevatorDesign } from '../solver/types'

export interface TitleBlockData {
  project?: string
  drawing_title?: string
  drawing_no?: string
  scale?: string
  drawn_by?: string
  checked_by?: string
}

const WIDTH_MM = 4000
const HEIGHT_MM = 2000
const HEADER_H = 1200
const REV_H = 500
const FOOTER_H = 300
const ROW_H = 280

function formatDate(iso: string): string {
  return iso.slice(0, 10) // YYYY-MM-DD
}

function drawCell(
  dw: any,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  dw.drawRect(x, y, x + w, y + h)
}

export function drawTitleBlock(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  data: TitleBlockData = {},
): void {
  const ox = origin.x
  const oy = origin.y

  const project = data.project ?? 'TBD'
  const drawingTitle = data.drawing_title ?? 'ELEVATOR GENERAL ARRANGEMENT'
  const drawingNo = data.drawing_no ?? 'VP-DRAFT'
  const scale = data.scale ?? '1:50'
  const drawnBy = data.drawn_by ?? 'Vera Plot'
  const checkedBy = data.checked_by ?? '-'
  const date = formatDate(design.generated_at)

  dw.setActiveLayer('TITLE')

  // Outer frame
  drawCell(dw, ox, oy, WIDTH_MM, HEIGHT_MM)

  // Horizontal dividers: footer / revision table / header
  const footerY = oy + FOOTER_H
  const revTopY = footerY + REV_H
  dw.drawLine(ox, footerY, ox + WIDTH_MM, footerY)
  dw.drawLine(ox, revTopY, ox + WIDTH_MM, revTopY)

  // --- Header section (top) ---
  // Row 1: PROJECT (full width)
  // Row 2: DWG TITLE (full width)
  // Row 3: DWG NO | DATE | SCALE (three columns)
  // Row 4: DRAWN BY | CHECKED BY (two columns)
  const headerTop = oy + HEIGHT_MM
  const row1Y = headerTop - ROW_H
  const row2Y = row1Y - ROW_H
  const row3Y = row2Y - ROW_H
  const row4Y = row3Y - ROW_H
  dw.drawLine(ox, row1Y, ox + WIDTH_MM, row1Y)
  dw.drawLine(ox, row2Y, ox + WIDTH_MM, row2Y)
  dw.drawLine(ox, row3Y, ox + WIDTH_MM, row3Y)

  // Column dividers in row 3 and row 4
  const row3ColA = ox + WIDTH_MM * 0.4
  const row3ColB = ox + WIDTH_MM * 0.7
  dw.drawLine(row3ColA, row3Y, row3ColA, row2Y)
  dw.drawLine(row3ColB, row3Y, row3ColB, row2Y)
  const row4ColA = ox + WIDTH_MM * 0.5
  dw.drawLine(row4ColA, row4Y, row4ColA, row3Y)

  dw.setActiveLayer('TEXT')
  const labelH = 90
  const valueH = 120
  const padX = 80
  const padYLabel = 190

  // Row 1
  dw.drawText(ox + padX, row1Y + padYLabel, labelH, 0, 'PROJECT')
  dw.drawText(ox + padX, row1Y + 30, valueH, 0, project)
  // Row 2
  dw.drawText(ox + padX, row2Y + padYLabel, labelH, 0, 'DWG TITLE')
  dw.drawText(ox + padX, row2Y + 30, valueH, 0, drawingTitle)
  // Row 3: DWG NO | DATE | SCALE
  dw.drawText(ox + padX, row3Y + padYLabel, labelH, 0, 'DWG NO')
  dw.drawText(ox + padX, row3Y + 30, valueH, 0, drawingNo)
  dw.drawText(row3ColA + padX, row3Y + padYLabel, labelH, 0, 'DATE')
  dw.drawText(row3ColA + padX, row3Y + 30, valueH, 0, date)
  dw.drawText(row3ColB + padX, row3Y + padYLabel, labelH, 0, 'SCALE')
  dw.drawText(row3ColB + padX, row3Y + 30, valueH, 0, scale)
  // Row 4: DRAWN BY | CHECKED BY
  dw.drawText(ox + padX, row4Y + padYLabel, labelH, 0, 'DRAWN BY')
  dw.drawText(ox + padX, row4Y + 30, valueH, 0, drawnBy)
  dw.drawText(row4ColA + padX, row4Y + padYLabel, labelH, 0, 'CHECKED BY')
  dw.drawText(row4ColA + padX, row4Y + 30, valueH, 0, checkedBy)

  // --- Revision table ---
  const revCols = [0, 0.1, 0.3, 0.45, 1.0]
  for (let i = 1; i < revCols.length - 1; i++) {
    const colX = ox + WIDTH_MM * revCols[i]
    dw.drawLine(colX, footerY, colX, revTopY)
  }
  const revHeaderY = revTopY - 120
  const revHeaders = ['REV', 'DATE', 'BY', 'DESCRIPTION']
  for (let i = 0; i < revHeaders.length; i++) {
    const cx = ox + WIDTH_MM * (revCols[i] + revCols[i + 1]) / 2
    dw.drawText(cx, revHeaderY, 80, 0, revHeaders[i], 'center')
  }
  // One empty placeholder row
  const firstRowY = footerY + 80
  dw.drawText(
    ox + WIDTH_MM * (revCols[0] + revCols[1]) / 2,
    firstRowY,
    90,
    0,
    '-',
    'center',
  )

  // --- Footer disclaimer ---
  dw.drawText(
    ox + WIDTH_MM / 2,
    oy + FOOTER_H / 2 - 40,
    140,
    0,
    'NOT FOR CONSTRUCTION — SUBJECT TO SITE VERIFICATION',
    'center',
  )
}

export function titleBlockBBox(): { width: number; height: number } {
  return { width: WIDTH_MM, height: HEIGHT_MM }
}
