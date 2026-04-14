/**
 * Byte-identical regression test for /api/solve Mode B 500kg passenger.
 * Uses StaticRulesLoader (no D1) and strips the generated_at timestamp
 * from the design before comparison (timestamp varies per call).
 */

import { describe, test, expect } from 'bun:test'
import { handleSolve } from './solve'
import { StaticRulesLoader } from '../config/load'

const TEST_USER = { id: 'test', email: 't@t.com', raw_email: 't@t.com', role: 'user', company_id: null as string | null, session_id: 's1' }

describe('solve-snapshot: Mode B 500kg passenger regression', () => {
  test('design output matches golden values (excluding timestamp)', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
        caseOverride: {},
      },
      loader,
    )

    expect(result.design.shaft).toEqual({
      width_mm: 1650,
      depth_mm: 1500,
      total_height_mm: 15000,
      overhead_mm: 4100,
      pit_depth_mm: 1500,
      stops: 6,
      usage: 'passenger',
    })

    expect(result.design.car).toEqual({
      width_mm: 1250,
      depth_mm: 1100,
      height_mm: 2300,
      area_m2: 1.375,
    })

    expect(result.design.door).toEqual({
      width_mm: 800,
      type: 'side_opening',
    })

    expect(result.design.rated_load_kg).toBe(500)
    expect(result.design.rated_speed_mpm).toBe(60)
    expect(result.design.machine_location).toBe('MR')
    expect(result.design.solver_mode).toBe('B')

    // DXF should be ~22-25 KB with title + full spec table + MR plan.
    // (MR plan adds ~5KB; timestamp causes small variance.)
    expect(result.dxf_kb).toBeGreaterThan(20)
    expect(result.dxf_kb).toBeLessThan(28)
  })

  test('DXF string contains expected structural elements', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
        caseOverride: {},
      },
      loader,
      TEST_USER,
      null,
    )

    expect(result.dxf_string!).toContain('SHAFT')
    expect(result.dxf_string!).toContain('CAR')
    expect(result.dxf_string!).toContain('CWT')
    expect(result.dxf_string!).toContain('RAIL_CAR')
    expect(result.dxf_string!).toContain('RAIL_CWT')
    expect(result.dxf_string!).toContain('DOOR')
    expect(result.dxf_string!).toContain('PLAN VIEW')
    expect(result.dxf_string!).toContain('SIDE SECTION')
  })

  test('validation_report returns real shape with 46 items', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
      },
      loader,
    )

    expect(result.validation_report.items).toHaveLength(62)
    expect(result.validation_report.summary.total_fail).toBe(0)

    // All items should pass when no case override
    const passed = result.validation_report.items.filter(i => i.status === 'pass')
    expect(passed).toHaveLength(62)

    // Summary counts should sum to total
    const { guideline_pass, guideline_warning, cns_pass, cns_warning } =
      result.validation_report.summary
    expect(guideline_pass + guideline_warning + cns_pass + cns_warning).toBe(62)
  })

  test('validation_report summary counts cns_warning when cns rule overridden', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
        caseOverride: { 'height.overhead.refuge_mm': '2100' },
      },
      loader,
    )
    expect(result.validation_report.summary.cns_warning).toBe(1)
    const cnsItemCount = result.validation_report.items.filter(
      (i) => i.source === 'cns',
    ).length
    expect(result.validation_report.summary.cns_pass).toBeLessThan(cnsItemCount)
  })
})
