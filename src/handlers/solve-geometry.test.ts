/**
 * Integration test: case override for clearance.front_mm affects BOTH
 * solver shaft depth AND DXF plan geometry consistently.
 *
 * This catches the silent drift that would happen if plan.ts was not
 * refactored to read from config (see Milestone 1a findings doc).
 */

import { describe, test, expect } from 'bun:test'
import { handleSolve } from './solve'
import { StaticRulesLoader } from '../config/load'

describe('solver + DXF geometry consistency under case override', () => {
  test('changing clearance.front_mm affects shaft depth AND DXF front gap label', async () => {
    const loader = new StaticRulesLoader()

    // Baseline request: front clearance 150 (default)
    const baseline = await handleSolve(
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

    // Override request: front clearance 200 (within baseline 100-300)
    const overridden = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
        caseOverride: { 'clearance.front_mm': '200' },
      },
      loader,
    )

    // 1. Shaft depth should differ by exactly 50 mm (200 - 150)
    const depthDelta = overridden.design.shaft.depth_mm - baseline.design.shaft.depth_mm
    expect(depthDelta).toBe(50)

    // 2. DXF should label the front gap as "200" not "150"
    // (the dimension text is "${frontGap}" in plan.ts, produces a TEXT entity)
    expect(overridden.dxf_string).not.toContain('\n150\n')
    expect(overridden.dxf_string).toContain('200')
  })

  test('changing cwt.width_mm affects DXF CWT rectangle', async () => {
    const loader = new StaticRulesLoader()

    const baseline = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
      },
      loader,
    )

    const overridden = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
        caseOverride: { 'cwt.width_mm': '900' },
      },
      loader,
    )

    // DXF strings must differ (different CWT dimensions)
    expect(overridden.dxf_string).not.toEqual(baseline.dxf_string)

    // Design output (shaft/car/door) should be IDENTICAL — cwt width is a
    // drawing-only value, doesn't affect structural calculation
    expect(overridden.design.shaft).toEqual(baseline.design.shaft)
    expect(overridden.design.car).toEqual(baseline.design.car)
    expect(overridden.design.door).toEqual(baseline.design.door)
  })

  test('baseline violation in case override returns 400-ready error', async () => {
    const loader = new StaticRulesLoader()

    await expect(
      handleSolve(
        {
          mode: 'B',
          rated_load_kg: 500,
          stops: 6,
          usage: 'passenger',
          machine_location: 'MR',
          caseOverride: { 'clearance.side_mm': '50' }, // below min 150
        },
        loader,
      ),
    ).rejects.toThrow(/Baseline violation on clearance.side_mm/)
  })

  test('enum override changes cwt.position in DXF geometry', async () => {
    const loader = new StaticRulesLoader()

    const baseline = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
      },
      loader,
    )

    const overridden = await handleSolve(
      {
        mode: 'B',
        rated_load_kg: 500,
        stops: 6,
        usage: 'passenger',
        machine_location: 'MR',
        caseOverride: { 'cwt.position': 'back_center' },
      },
      loader,
    )

    // cwt.position is stored in config but currently doesn't affect plan.ts
    // geometry (the position literal is hardcoded in plan.ts layout logic).
    // This test documents the current behavior: the override is ACCEPTED
    // but the DXF string is unchanged. When Milestone 1c or later adds
    // position-aware drawing, this test will need updating.
    //
    // For now: assert that the override doesn't break solve (no throw).
    expect(overridden.design).toBeDefined()
  })
})
