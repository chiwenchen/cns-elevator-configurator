/**
 * Solver tests — 驗證 Mode A + Mode B 解算 + 產 DXF + round-trip
 *
 * 執行：bun test src/solver
 */

import { test, expect, describe } from 'bun:test'
// @ts-ignore
import DxfParser from 'dxf-parser'

import { solveModeA } from './mode-a'
import { solveModeB } from './mode-b'
import { minLoadForArea, maxAreaForLoad, maxPassengersForLoad } from './table'
import { NonStandardError } from './types'
import { generateElevatorDXF } from '../dxf/generate'

// ---- Table lookup tests ----

describe('ISO 8100-1 Table 6 lookup', () => {
  test('minLoadForArea exact hits', () => {
    expect(minLoadForArea(3.40)).toBe(1500)
    expect(minLoadForArea(1.90)).toBe(750)
    expect(minLoadForArea(0.37)).toBe(100)
    expect(minLoadForArea(5.00)).toBe(2500)
  })

  test('minLoadForArea between table points', () => {
    // 2.0 m² 剛好是 800 kg 的 max_car_area
    expect(minLoadForArea(2.0)).toBe(800)
    // 2.01 m² 要升到下一個 step 825 kg
    expect(minLoadForArea(2.01)).toBe(825)
    // 2.7 m² 落在 1125 (2.65) 跟 1200 (2.80) 之間 → 向上取 1200
    expect(minLoadForArea(2.7)).toBe(1200)
  })

  test('minLoadForArea above table extends with 0.16/100kg rule', () => {
    // 5.00 m² = 2500 kg (表格上限)
    // 5.16 m² = 2500 + 100 = 2600 kg
    expect(minLoadForArea(5.16)).toBe(2600)
    // 5.32 m² = 2500 + 200 = 2700 kg
    expect(minLoadForArea(5.32)).toBe(2700)
  })

  test('maxAreaForLoad exact hits', () => {
    expect(maxAreaForLoad(1500)).toBe(3.40)
    expect(maxAreaForLoad(750)).toBe(1.90)
    expect(maxAreaForLoad(100)).toBe(0.37)
  })

  test('maxAreaForLoad linear interpolation', () => {
    // 700 kg 落在 675 (1.75) 跟 750 (1.90) 之間
    // ratio = (700-675)/(750-675) = 25/75 = 0.333
    // area = 1.75 + 0.333 * (1.90-1.75) = 1.75 + 0.05 = 1.80
    expect(maxAreaForLoad(700)).toBeCloseTo(1.80, 2)
  })

  test('maxPassengersForLoad', () => {
    expect(maxPassengersForLoad(1500)).toBe(20)
    expect(maxPassengersForLoad(750)).toBe(10)
    expect(maxPassengersForLoad(450)).toBe(6)
  })
})

// ---- Mode A tests ----

describe('Mode A Solver (shaft → design)', () => {
  test('standard 2000x2200 passenger shaft fits 750 kg', () => {
    const design = solveModeA({
      width_mm: 2000,
      depth_mm: 2200,
      total_height_mm: 18000,
      overhead_mm: 4200,
      pit_depth_mm: 1600,
      stops: 6,
      usage: 'passenger',
    })

    expect(design.solver_mode).toBe('A')
    expect(design.shaft.width_mm).toBe(2000)
    expect(design.shaft.depth_mm).toBe(2200)
    // 2000 - 400 (2×200 side) = 1600, floor to 50 = 1600
    expect(design.car.width_mm).toBe(1600)
    // 2200 - 250 back - 150 front = 1800, floor to 50 = 1800
    expect(design.car.depth_mm).toBe(1800)
    // area = 1.6 × 1.8 = 2.88 m²
    // 2.88 falls between 1200 (2.80) and 1250 (2.90) in table → chooses 1200
    expect(design.car.area_m2).toBeCloseTo(2.88, 2)
    expect(design.rated_load_kg).toBe(1200)
    expect(design.rated_speed_mpm).toBe(60)
  })

  test('minimal viable 1400x1500 passenger shaft', () => {
    const design = solveModeA({
      width_mm: 1400,
      depth_mm: 1500,
      total_height_mm: 9000,
      overhead_mm: 4200,
      pit_depth_mm: 1600,
      stops: 4,
      usage: 'passenger',
    })

    expect(design.car.width_mm).toBe(1000) // 1400 - 400
    expect(design.car.depth_mm).toBe(1100) // 1500 - 400
    // area = 1.1 m² → 大於 375 kg (1.10 m²)，選 375 (向下取)
    expect(design.rated_load_kg).toBeGreaterThanOrEqual(375)
  })

  test('throws NonStandardError on too-narrow shaft', () => {
    expect(() =>
      solveModeA({
        width_mm: 1000,
        depth_mm: 1500,
        total_height_mm: 9000,
        overhead_mm: 4200,
        pit_depth_mm: 1600,
        stops: 4,
        usage: 'passenger',
      })
    ).toThrow(NonStandardError)
  })

  test('throws on insufficient overhead', () => {
    expect(() =>
      solveModeA({
        width_mm: 2000,
        depth_mm: 2200,
        total_height_mm: 18000,
        overhead_mm: 2000, // too low
        pit_depth_mm: 1600,
        stops: 6,
        usage: 'passenger',
      })
    ).toThrow(/頂部|overhead/i)
  })

  test('throws on insufficient pit depth', () => {
    expect(() =>
      solveModeA({
        width_mm: 2000,
        depth_mm: 2200,
        total_height_mm: 18000,
        overhead_mm: 4200,
        pit_depth_mm: 500, // too low
        stops: 6,
        usage: 'passenger',
      })
    ).toThrow(/底坑/i)
  })
})

// ---- Mode B tests ----

describe('Mode B Solver (requirement → design)', () => {
  test('500 kg passenger requirement', () => {
    const design = solveModeB({
      rated_load_kg: 500,
      stops: 6,
      usage: 'passenger',
      machine_location: 'MR',
    })

    expect(design.solver_mode).toBe('B')
    expect(design.rated_load_kg).toBe(500)
    // 500 kg → area via linear interpolation between 450 (1.30) and 525 (1.45)
    // ratio = (500-450)/(525-450) = 50/75 = 0.667
    // area = 1.30 + 0.667 * 0.15 = 1.40 m²
    expect(design.car.area_m2).toBeGreaterThan(1.3)
    expect(design.car.area_m2).toBeLessThan(1.5)
    expect(design.car.width_mm).toBeGreaterThan(0)
    expect(design.car.depth_mm).toBeGreaterThan(0)
    expect(design.shaft.stops).toBe(6)
    // Default floor height = 3000 → total = 3000 * (6-1) = 15000
    expect(design.shaft.total_height_mm).toBe(15000)
    expect(design.shaft.overhead_mm).toBeGreaterThanOrEqual(3800)
    expect(design.shaft.pit_depth_mm).toBeGreaterThanOrEqual(1400)
  })

  test('750 kg passenger at 90 m/min', () => {
    const design = solveModeB({
      rated_load_kg: 750,
      rated_speed_mpm: 90,
      stops: 10,
      usage: 'passenger',
      machine_location: 'MRL',
    })

    expect(design.rated_load_kg).toBe(750)
    expect(design.rated_speed_mpm).toBe(90)
    expect(design.machine_location).toBe('MRL')
    // 90 m/min (1.5 m/s) → 0.035 * 2.25 = 0.079 → overhead slightly higher than 60 m/min
    // Mostly driven by the 4000 constant, rounded up to 100
    expect(design.shaft.overhead_mm).toBeGreaterThanOrEqual(4000)
  })

  test('bed elevator needs deep car', () => {
    const design = solveModeB({
      rated_load_kg: 1600,
      stops: 8,
      usage: 'bed',
      machine_location: 'MR',
    })

    expect(design.car.depth_mm).toBeGreaterThanOrEqual(2400)
    expect(design.shaft.depth_mm).toBeGreaterThan(design.car.depth_mm)
  })

  test('throws on accessible load too low for CNS 13627 minimum', () => {
    expect(() =>
      solveModeB({
        rated_load_kg: 400,
        stops: 4,
        usage: 'accessible',
        machine_location: 'MR',
      })
    ).toThrow(NonStandardError)
  })

  test('throws on load below ISO 8100-1 table minimum', () => {
    expect(() =>
      solveModeB({
        rated_load_kg: 50,
        stops: 4,
        usage: 'passenger',
        machine_location: 'MR',
      })
    ).toThrow(NonStandardError)
  })
})

// ---- DXF generation + round-trip ----

describe('DXF Writer + round-trip', () => {
  test('generates valid DXF from Mode A design', () => {
    const design = solveModeA({
      width_mm: 2000,
      depth_mm: 2200,
      total_height_mm: 18000,
      overhead_mm: 4200,
      pit_depth_mm: 1600,
      stops: 6,
      usage: 'passenger',
    })

    const dxf = generateElevatorDXF(design)
    expect(dxf.length).toBeGreaterThan(1000)
    expect(dxf).toContain('SECTION')
    expect(dxf).toContain('SHAFT')
    expect(dxf).toContain('CAR')

    // Round-trip: parser should read it back
    const parser = new DxfParser()
    const parsed = parser.parseSync(dxf)
    expect(parsed.entities.length).toBeGreaterThan(20)
  })

  test('generates valid DXF from Mode B design', () => {
    const design = solveModeB({
      rated_load_kg: 500,
      stops: 6,
      usage: 'passenger',
      machine_location: 'MR',
    })

    const dxf = generateElevatorDXF(design)
    const parser = new DxfParser()
    const parsed = parser.parseSync(dxf)

    // Should have 2 SHAFT polylines (plan + elevation)
    const shaftPolys = parsed.entities.filter(
      (e: any) => e.layer === 'SHAFT' && e.type === 'LWPOLYLINE'
    )
    expect(shaftPolys.length).toBe(2)
  })
})
