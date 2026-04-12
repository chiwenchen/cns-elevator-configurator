/**
 * Mode A path coverage for handleSolve — uses StaticRulesLoader and
 * verifies the shaft → design flow is reachable through the handler
 * (not just via solveModeA directly).
 */

import { describe, test, expect } from 'bun:test'
import { handleSolve } from './solve'
import { StaticRulesLoader } from '../config/load'

describe('handleSolve Mode A path', () => {
  test('valid 2000x2200 passenger shaft → design', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'A',
        width_mm: 2000,
        depth_mm: 2200,
        total_height_mm: 12000,
        overhead_mm: 4200,
        pit_depth_mm: 1500,
        stops: 5,
        usage: 'passenger',
      },
      loader,
    )

    expect(result.design.solver_mode).toBe('A')
    expect(result.design.shaft.width_mm).toBe(2000)
    expect(result.design.shaft.depth_mm).toBe(2200)
    expect(result.design.car.width_mm).toBeGreaterThan(0)
    expect(result.design.car.depth_mm).toBeGreaterThan(0)
    expect(result.dxf_kb).toBeGreaterThan(0)
  })

  test('Mode A with explicit preferred_speed_mpm', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'A',
        width_mm: 2000,
        depth_mm: 2200,
        total_height_mm: 12000,
        overhead_mm: 4500,
        pit_depth_mm: 1600,
        stops: 5,
        usage: 'passenger',
        preferred_speed_mpm: 90,
      },
      loader,
    )
    expect(result.design.rated_speed_mpm).toBe(90)
  })

  test('unknown mode throws InvalidSolveBodyError', async () => {
    const loader = new StaticRulesLoader()
    await expect(
      handleSolve({ mode: 'X', stops: 5, usage: 'passenger' }, loader),
    ).rejects.toThrow(/Invalid mode: X/)
  })
})
