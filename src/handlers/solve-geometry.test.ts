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

/**
 * Scan the DXF for TEXT entities on the DIMS layer and assert that at least
 * one has the given string value.
 *
 * Parses the flat group-code / group-value text lines output by dxf-writer.
 * A TEXT entity looks like:
 *   0\nTEXT\n...8\nDIMS\n...1\n<value>\n...
 * We walk the lines, track the currently open entity, and collect its (8) layer
 * and (1) value. When a new `0 <TYPE>` starts we commit the previous entity.
 */
function assertDimsTextLabel(dxf: string, expectedValue: string): void {
  // DXF is a sequence of (groupCode, groupValue) pairs, one per line each:
  //   code\nvalue\ncode\nvalue\n...
  // Walk pairs, tracking the currently open entity, and collect the (1) value
  // of every TEXT entity whose (8) layer is DIMS.
  const lines = dxf.split('\n')
  let currentType: string | undefined
  let currentLayer: string | undefined
  let currentValue: string | undefined
  const dimsTextValues: string[] = []

  const commit = (): void => {
    if (currentType === 'TEXT' && currentLayer === 'DIMS' && currentValue !== undefined) {
      dimsTextValues.push(currentValue)
    }
  }

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]?.trim()
    const val = lines[i + 1]
    if (code === undefined || val === undefined) continue
    if (code === '0') {
      commit()
      currentType = val.trim()
      currentLayer = undefined
      currentValue = undefined
      continue
    }
    if (code === '8' && currentType !== undefined) {
      currentLayer = val.trim()
      continue
    }
    if (code === '1' && currentType === 'TEXT') {
      currentValue = val
      continue
    }
  }
  commit()

  expect(dimsTextValues).toContain(expectedValue)
}

const TEST_USER = { id: 'test', email: 't@t.com', raw_email: 't@t.com', role: 'user', company_id: null as string | null, session_id: 's1' }

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
      TEST_USER,
      null,
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
      TEST_USER,
      null,
    )

    // 1. Shaft depth should differ by exactly 50 mm (200 - 150)
    const depthDelta = overridden.design.shaft.depth_mm - baseline.design.shaft.depth_mm
    expect(depthDelta).toBe(50)

    // 2. DXF should carry the shaft-depth dimension TEXT ("D <depth>") derived
    //    from plan.ts — proving config drift propagates to the drawing.
    //    Using the "D " prefix is robust: TEXT entity values with "D " cannot
    //    collide with DXF handles, layer names, or numeric group codes.
    expect(baseline.dxf_string!).toContain(`D ${baseline.design.shaft.depth_mm}`)
    expect(overridden.dxf_string!).toContain(`D ${overridden.design.shaft.depth_mm}`)
    expect(overridden.dxf_string!).not.toContain(`D ${baseline.design.shaft.depth_mm}`)

    // 3. Regression guard: the "D <depth>" label comes from solver output
    //    (design.shaft.depth_mm), not from plan.ts's internal frontGap. If
    //    someone hardcodes frontGap=150 back into plan.ts, the D label would
    //    still match (solver would still update correctly). Catch that drift
    //    by asserting the raw front-gap label (drawn as DIMS TEXT) reflects
    //    the overridden value.
    //
    //    plan.ts:279 draws `${frontGap}` as a TEXT entity on the DIMS layer.
    //    When overridden to 200, the string "\n200\n" appears in the DXF as
    //    a TEXT group-1 value.
    assertDimsTextLabel(overridden.dxf_string!, '200')
    assertDimsTextLabel(baseline.dxf_string!, '150')
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
      TEST_USER,
      null,
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
      TEST_USER,
      null,
    )

    // DXF strings must differ (different CWT dimensions)
    expect(overridden.dxf_string!).not.toEqual(baseline.dxf_string!)

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
        TEST_USER,
        null,
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
      TEST_USER,
      null,
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
      TEST_USER,
      null,
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
    expect(overridden.dxf_string!).not.toEqual(baseline.dxf_string!)
  })
})
