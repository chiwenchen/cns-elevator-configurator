/**
 * Shared DXF drawing primitives.
 *
 * Each function calls dw.setActiveLayer(layer) first, then the corresponding
 * dxf-writer method. These are not yet used by existing code — they will be
 * consumed by professional drawing code in later tasks.
 */

export function drawRect(
  dw: any,
  layer: string,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  dw.setActiveLayer(layer)
  dw.drawRect(x, y, x + w, y + h)
}

export function drawLine(
  dw: any,
  layer: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  dw.setActiveLayer(layer)
  dw.drawLine(x1, y1, x2, y2)
}

export function drawCircle(
  dw: any,
  layer: string,
  cx: number,
  cy: number,
  radius: number
): void {
  dw.setActiveLayer(layer)
  dw.drawCircle(cx, cy, radius)
}

export function drawText(
  dw: any,
  layer: string,
  x: number,
  y: number,
  height: number,
  text: string
): void {
  dw.setActiveLayer(layer)
  dw.drawText(x, y, height, 0, text)
}

export function drawTriangle(
  dw: any,
  layer: string,
  cx: number,
  cy: number,
  size: number,
  direction: 'left' | 'right'
): void {
  dw.setActiveLayer(layer)
  // Equilateral-ish triangle pointing left or right
  const half = size / 2
  if (direction === 'right') {
    // Tip points right
    dw.drawLine(cx - half, cy + half, cx + half, cy)
    dw.drawLine(cx + half, cy, cx - half, cy - half)
    dw.drawLine(cx - half, cy - half, cx - half, cy + half)
  } else {
    // Tip points left
    dw.drawLine(cx + half, cy + half, cx - half, cy)
    dw.drawLine(cx - half, cy, cx + half, cy - half)
    dw.drawLine(cx + half, cy - half, cx + half, cy + half)
  }
}
