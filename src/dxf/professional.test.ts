/**
 * Tests for professional plan + elevation views.
 *
 * Uses a mock dxf-writer to verify layer usage, component counts,
 * and buffer auto-selection logic.
 */

import { describe, test, expect } from 'bun:test'
import { drawPlanProfessional } from './plan-professional'
import { drawElevationProfessional } from './elevation-professional'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, ProfessionalConfig } from '../config/types'

// ---- Mock DXF writer ----

interface MockCall {
  method: string
  args: any[]
}

function createMockDw() {
  const calls: MockCall[] = []
  return {
    calls,
    setActiveLayer(name: string) {
      calls.push({ method: 'setActiveLayer', args: [name] })
    },
    drawRect(...args: any[]) {
      calls.push({ method: 'drawRect', args })
    },
    drawLine(...args: any[]) {
      calls.push({ method: 'drawLine', args })
    },
    drawCircle(...args: any[]) {
      calls.push({ method: 'drawCircle', args })
    },
    drawText(...args: any[]) {
      calls.push({ method: 'drawText', args })
    },
  }
}

// ---- Test fixtures ----

const PRO: ProfessionalConfig = {
  sling_offset_mm: 75,
  sling_thickness_mm: 12,
  guide_shoe_width_mm: 100,
  guide_shoe_depth_mm: 60,
  wall_thickness_mm: 200,
  buffer_type: 'auto',
  buffer_width_mm: 200,
  buffer_height_spring_mm: 300,
  buffer_height_oil_mm: 450,
  machine_width_mm: 600,
  machine_height_mm: 400,
  sheave_diameter_mm: 400,
  safety_gear_width_mm: 150,
  safety_gear_height_mm: 80,
  governor_diameter_mm: 300,
  rail_bracket_spacing_mm: 2500,
}

function makeDesign(overrides?: Partial<{ speed: number; load: number; stops: number }>): ElevatorDesign {
  return {
    shaft: {
      width_mm: 2000,
      depth_mm: 2200,
      total_height_mm: 12000,
      overhead_mm: 4200,
      pit_depth_mm: 1500,
      stops: overrides?.stops ?? 5,
      usage: 'passenger',
    },
    car: {
      width_mm: 1400,
      depth_mm: 1350,
      height_mm: 2400,
      area_m2: 1.89,
    },
    door: {
      width_mm: 900,
      type: 'center_opening',
    },
    rated_load_kg: overrides?.load ?? 1000,
    rated_speed_mpm: overrides?.speed ?? 60,
    machine_location: 'MRL',
    solver_mode: 'A',
    generated_at: '2025-01-01T00:00:00Z',
  }
}

function makeConfig(proOverrides?: Partial<ProfessionalConfig>): EffectiveConfig {
  return {
    shaft: { min_width_mm: 1500, min_depth_mm: 1500 },
    clearance: { side_mm: 50, back_mm: 300, front_mm: 200 },
    car: {
      aspect_ratio: {
        passenger: { w: 1.4, d: 1.35 },
        freight: { w: 1.5, d: 2.0 },
        bed: { w: 1.5, d: 2.4 },
        accessible: { w: 1.5, d: 1.5 },
      },
      height_mm: {
        passenger: 2400,
        freight: 2400,
        bed: 2400,
        accessible: 2400,
      },
    },
    cwt: {
      position: 'back_center',
      width_mm: 700,
      thickness_mm: 120,
      back_offset_mm: 40,
      left_offset_mm: 250,
    },
    rail: {
      car_size_mm: 89,
      car_gap_mm: 50,
      cwt_size_mm: 70,
      cwt_gap_mm: 20,
    },
    door: {
      frame_depth_mm: 70,
      leaf_thickness_mm: 45,
      sill_depth_mm: 30,
      default_width_mm: {
        passenger: 900,
        freight: 1100,
        bed: 1100,
        accessible: 900,
      },
      center_opening_min_car_width_mm: 1100,
    },
    height: {
      floor_default_mm: 3000,
      default_speed_mpm: 60,
      overhead: {
        refuge_mm: 2400,
        machine_buffer_mm: 400,
        bounce_coef: 0.0003,
      },
      pit: {
        refuge_mm: 500,
        buffer_mm: 250,
        speed_bonus_90mpm_mm: 200,
        speed_bonus_150mpm_mm: 400,
      },
    },
    usage_constraints: {
      accessible_min_car_width_mm: 1100,
      accessible_min_car_depth_mm: 1400,
      bed_min_car_depth_mm: 2100,
    },
    professional: { ...PRO, ...proOverrides },
  }
}

// ---- Helpers ----

function getLayerCalls(calls: MockCall[], layer: string): MockCall[] {
  const result: MockCall[] = []
  let active = false
  for (const call of calls) {
    if (call.method === 'setActiveLayer') {
      active = call.args[0] === layer
    } else if (active) {
      result.push(call)
    }
  }
  return result
}

function getLayersUsed(calls: MockCall[]): string[] {
  const layers = new Set<string>()
  for (const call of calls) {
    if (call.method === 'setActiveLayer') {
      layers.add(call.args[0])
    }
  }
  return [...layers]
}

// ---- Plan Professional Tests ----

describe('drawPlanProfessional', () => {
  test('draws on correct layers (SLING, WALL, LANDING, ROPE, TEXT)', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, makeDesign(), { x: 0, y: 0 }, PRO, makeConfig())

    const layers = getLayersUsed(dw.calls)
    expect(layers).toContain('SLING')
    expect(layers).toContain('WALL')
    expect(layers).toContain('LANDING')
    expect(layers).toContain('ROPE')
    expect(layers).toContain('TEXT')
  })

  test('draws exactly 4 guide shoe rectangles on SLING layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, makeDesign(), { x: 0, y: 0 }, PRO, makeConfig())

    // Count drawRect calls on SLING layer — 4 sling beams + 4 guide shoes = 8 total rects
    const slingRects = getLayerCalls(dw.calls, 'SLING').filter(c => c.method === 'drawRect')
    // 4 beams (crosshead, bolster, left stile, right stile) + 4 guide shoes = 8
    expect(slingRects.length).toBe(8)
  })

  test('draws wall outer rectangle on WALL layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, makeDesign(), { x: 0, y: 0 }, PRO, makeConfig())

    const wallRects = getLayerCalls(dw.calls, 'WALL').filter(c => c.method === 'drawRect')
    expect(wallRects.length).toBe(1)
  })

  test('rope count: 3 circles for load <= 1000kg', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, makeDesign({ load: 1000 }), { x: 0, y: 0 }, PRO, makeConfig())

    const ropeCircles = getLayerCalls(dw.calls, 'ROPE').filter(c => c.method === 'drawCircle')
    // 3 rope marks + 1 TC mark = 4
    expect(ropeCircles.length).toBe(4)
  })

  test('rope count: 4 circles for load > 1000kg', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, makeDesign({ load: 1500 }), { x: 0, y: 0 }, PRO, makeConfig())

    const ropeCircles = getLayerCalls(dw.calls, 'ROPE').filter(c => c.method === 'drawCircle')
    // 4 rope marks + 1 TC mark = 5
    expect(ropeCircles.length).toBe(5)
  })

  test('landing door draws on LANDING layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, makeDesign(), { x: 0, y: 0 }, PRO, makeConfig())

    const landingCalls = getLayerCalls(dw.calls, 'LANDING')
    expect(landingCalls.length).toBeGreaterThan(0)
  })
})

// ---- Elevation Professional Tests ----

describe('drawElevationProfessional', () => {
  test('draws on correct layers (LANDING, BUFFER, MACHINE, SAFETY, ROPE, WALL, DIMS)', () => {
    const dw = createMockDw()
    const design = makeDesign()
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const layers = getLayersUsed(dw.calls)
    expect(layers).toContain('LANDING')
    expect(layers).toContain('BUFFER')
    expect(layers).toContain('MACHINE')
    expect(layers).toContain('SAFETY')
    expect(layers).toContain('ROPE')
    expect(layers).toContain('WALL')
    expect(layers).toContain('DIMS')
  })

  test('buffer auto-selection: speed <= 60 -> spring (has zigzag drawLine inside buffer)', () => {
    const dw = createMockDw()
    const design = makeDesign({ speed: 60 })
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    // Spring buffers should have zigzag lines on BUFFER layer
    const bufferLines = getLayerCalls(dw.calls, 'BUFFER').filter(c => c.method === 'drawLine')
    // 6 zigzag segments × 2 buffers = 12 lines
    expect(bufferLines.length).toBe(12)

    // Should NOT have "OIL" text
    const textCalls = dw.calls.filter(
      c => c.method === 'drawText' && c.args.some((a: any) => a === 'OIL'),
    )
    expect(textCalls.length).toBe(0)
  })

  test('buffer auto-selection: speed > 60 -> oil (OIL text, no zigzag)', () => {
    const dw = createMockDw()
    const design = makeDesign({ speed: 90 })
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    // Oil buffers should NOT have zigzag lines on BUFFER layer
    const bufferLines = getLayerCalls(dw.calls, 'BUFFER').filter(c => c.method === 'drawLine')
    expect(bufferLines.length).toBe(0)

    // Should have "OIL" text
    const oilTexts = dw.calls.filter(
      c => c.method === 'drawText' && c.args.some((a: any) => a === 'OIL'),
    )
    expect(oilTexts.length).toBe(2) // one per buffer
  })

  test('buffer type override: spring forced even at high speed', () => {
    const dw = createMockDw()
    const design = makeDesign({ speed: 120 })
    const config = makeConfig({ buffer_type: 'spring' })
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, config.professional!, config)

    const bufferLines = getLayerCalls(dw.calls, 'BUFFER').filter(c => c.method === 'drawLine')
    expect(bufferLines.length).toBe(12) // zigzag present
  })

  test('multi-floor: draws N floor lines for N stops', () => {
    const stops = 7
    const dw = createMockDw()
    const design = makeDesign({ stops })
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const landingLines = getLayerCalls(dw.calls, 'LANDING').filter(c => c.method === 'drawLine')
    // Each stop: 1 floor line + 1 door indicator = 2 lines per stop
    expect(landingLines.length).toBe(stops * 2)
  })

  test('draws floor labels for each stop', () => {
    const stops = 5
    const dw = createMockDw()
    const design = makeDesign({ stops })
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const floorLabels = dw.calls.filter(
      c => c.method === 'drawText' && typeof c.args[4] === 'string' && /^\dF$/.test(c.args[4]),
    )
    expect(floorLabels.length).toBe(stops)
  })

  test('draws safety gear + governor on SAFETY layer', () => {
    const dw = createMockDw()
    const design = makeDesign()
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const safetyRects = getLayerCalls(dw.calls, 'SAFETY').filter(c => c.method === 'drawRect')
    expect(safetyRects.length).toBe(2) // left + right safety gear

    const safetyCircles = getLayerCalls(dw.calls, 'SAFETY').filter(c => c.method === 'drawCircle')
    expect(safetyCircles.length).toBe(1) // governor wheel
  })

  test('draws machine + sheave on MACHINE layer', () => {
    const dw = createMockDw()
    const design = makeDesign()
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const machineRects = getLayerCalls(dw.calls, 'MACHINE').filter(c => c.method === 'drawRect')
    expect(machineRects.length).toBe(1)

    const machineCircles = getLayerCalls(dw.calls, 'MACHINE').filter(c => c.method === 'drawCircle')
    expect(machineCircles.length).toBe(1) // sheave
  })

  test('draws PIT dimension on DIMS layer', () => {
    const dw = createMockDw()
    const design = makeDesign()
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const pitTexts = dw.calls.filter(
      c => c.method === 'drawText' && typeof c.args[4] === 'string' && c.args[4].includes('PIT'),
    )
    expect(pitTexts.length).toBeGreaterThanOrEqual(1)
  })

  test('draws professional title', () => {
    const dw = createMockDw()
    const design = makeDesign()
    const config = makeConfig()
    drawElevationProfessional(dw, design, { x: 0, y: 0 }, PRO, config)

    const titleCalls = dw.calls.filter(
      c =>
        c.method === 'drawText' &&
        typeof c.args[4] === 'string' &&
        c.args[4].includes('PROFESSIONAL'),
    )
    expect(titleCalls.length).toBe(1)
  })
})
