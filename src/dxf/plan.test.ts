/**
 * Unit tests for computeCwtPlacement — the position-aware CWT helper
 * used by plan.ts. Covers all 5 CwtPosition values.
 *
 * Coordinate system (plan-view local, before origin offset):
 *   - X: 0 at left wall, shaft.width_mm at right wall
 *   - Y: 0 at back wall, shaft.depth_mm at front wall
 */

import { describe, test, expect } from 'bun:test'
import { computeCwtPlacement } from './plan'
import type { EffectiveConfig } from '../config/types'

const SHAFT = { width_mm: 2000, depth_mm: 2200 }

const CWT: EffectiveConfig['cwt'] = {
  position: 'back_left',
  width_mm: 700,
  thickness_mm: 120,
  back_offset_mm: 40,
  left_offset_mm: 250,
}

const RAIL: EffectiveConfig['rail'] = {
  car_size_mm: 89,
  car_gap_mm: 50,
  cwt_size_mm: 70,
  cwt_gap_mm: 20,
}

describe('computeCwtPlacement', () => {
  test('back_left: CWT at left offset along back wall', () => {
    const p = computeCwtPlacement(SHAFT, CWT, RAIL, 'back_left')
    expect(p.cwt).toEqual({ x0: 250, y0: 40, x1: 950, y1: 160 })
    // Rails flank CWT along X at the vertical midline of the CWT (y = 100)
    expect(p.rails[0]).toEqual({ x0: 160, y0: 65, x1: 230, y1: 135 })
    expect(p.rails[1]).toEqual({ x0: 970, y0: 65, x1: 1040, y1: 135 })
  })

  test('back_center: CWT centered along back wall', () => {
    const p = computeCwtPlacement(SHAFT, CWT, RAIL, 'back_center')
    // centered: x0 = (2000 - 700) / 2 = 650
    expect(p.cwt).toEqual({ x0: 650, y0: 40, x1: 1350, y1: 160 })
    expect(p.rails[0]).toEqual({ x0: 560, y0: 65, x1: 630, y1: 135 })
    expect(p.rails[1]).toEqual({ x0: 1370, y0: 65, x1: 1440, y1: 135 })
  })

  test('back_right: CWT at right side of back wall', () => {
    const p = computeCwtPlacement(SHAFT, CWT, RAIL, 'back_right')
    // x0 = 2000 - 250 - 700 = 1050
    expect(p.cwt).toEqual({ x0: 1050, y0: 40, x1: 1750, y1: 160 })
    expect(p.rails[0]).toEqual({ x0: 960, y0: 65, x1: 1030, y1: 135 })
    expect(p.rails[1]).toEqual({ x0: 1770, y0: 65, x1: 1840, y1: 135 })
  })

  test('side_left: CWT rotated 90° along left wall', () => {
    const p = computeCwtPlacement(SHAFT, CWT, RAIL, 'side_left')
    // x0 = back_offset = 40, x1 = 40 + thickness 120 = 160
    // y0 = (2200 - 700) / 2 = 750, y1 = 1450
    expect(p.cwt).toEqual({ x0: 40, y0: 750, x1: 160, y1: 1450 })
    // Rails flank along Y axis, centered on CWT midline x = 100
    expect(p.rails[0]).toEqual({ x0: 65, y0: 660, x1: 135, y1: 730 })
    expect(p.rails[1]).toEqual({ x0: 65, y0: 1470, x1: 135, y1: 1540 })
  })

  test('side_right: mirror of side_left', () => {
    const p = computeCwtPlacement(SHAFT, CWT, RAIL, 'side_right')
    // x1 = 2000 - 40 = 1960, x0 = 1960 - 120 = 1840
    expect(p.cwt).toEqual({ x0: 1840, y0: 750, x1: 1960, y1: 1450 })
    // Mid-X = 1900
    expect(p.rails[0]).toEqual({ x0: 1865, y0: 660, x1: 1935, y1: 730 })
    expect(p.rails[1]).toEqual({ x0: 1865, y0: 1470, x1: 1935, y1: 1540 })
  })

  test('back_left CWT stays within shaft (left edge)', () => {
    const p = computeCwtPlacement(SHAFT, CWT, RAIL, 'back_left')
    expect(p.cwt.x0).toBeGreaterThanOrEqual(0)
    expect(p.cwt.x1).toBeLessThanOrEqual(SHAFT.width_mm)
    expect(p.cwt.y0).toBeGreaterThanOrEqual(0)
    expect(p.cwt.y1).toBeLessThanOrEqual(SHAFT.depth_mm)
  })

  test('side positions swap width/thickness axes', () => {
    const back = computeCwtPlacement(SHAFT, CWT, RAIL, 'back_center')
    const side = computeCwtPlacement(SHAFT, CWT, RAIL, 'side_left')

    // back position: CWT rectangle is width_mm wide (X) and thickness_mm tall (Y)
    expect(back.cwt.x1 - back.cwt.x0).toBe(CWT.width_mm)
    expect(back.cwt.y1 - back.cwt.y0).toBe(CWT.thickness_mm)

    // side position: CWT rectangle is thickness_mm wide (X) and width_mm tall (Y)
    expect(side.cwt.x1 - side.cwt.x0).toBe(CWT.thickness_mm)
    expect(side.cwt.y1 - side.cwt.y0).toBe(CWT.width_mm)
  })
})
