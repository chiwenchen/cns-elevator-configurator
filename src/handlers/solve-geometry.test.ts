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

    // 2. DXF should carry the shaft-depth dimension TEXT ("D <depth>") derived
    //    from plan.ts — proving config drift propagates to the drawing.
    //    Using the "D " prefix is robust: TEXT entity values with "D " cannot
    //    collide with DXF handles, layer names, or numeric group codes.
    expect(baseline.dxf_string).toContain(`D ${baseline.design.shaft.depth_mm}`)
    expect(overridden.dxf_string).toContain(`D ${overridden.design.shaft.depth_mm}`)
    expect(overridden.dxf_string).not.toContain(`D ${baseline.design.shaft.depth_mm}`)
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

    // cwt.position is now honored by plan.ts (Finding 1 fix). Overriding
    // back_left → back_center must materially change the DXF geometry:
    // the CWT rectangle (and its rails) are redrawn at a different X origin.
    expect(overridden.design).toBeDefined()
    // Structural design outputs (shaft/car/door) are independent of CWT
    // position — it's a drawing-only value.
    expect(overridden.design.shaft).toEqual(baseline.design.shaft)
    expect(overridden.design.car).toEqual(baseline.design.car)
    expect(overridden.design.door).toEqual(baseline.design.door)
    // DXF strings must differ because CWT rectangle moved.
    expect(overridden.dxf_string).not.toEqual(baseline.dxf_string)
  })
})
