/**
 * Request body validation tests for handleSolve / parseSolveBody.
 *
 * parseSolveBody is the single entry point for validating /api/solve
 * request bodies. These tests enforce the invariant: every code path
 * into the solver goes through a validated shape, and malformed input
 * throws InvalidSolveBodyError (which the worker converts to HTTP 400).
 */

import { describe, test, expect } from 'bun:test'
import {
  parseSolveBody,
  InvalidSolveBodyError,
  handleSolve,
} from './solve'
import { StaticRulesLoader } from '../config/load'

describe('parseSolveBody — rejects malformed input', () => {
  test('non-object body throws', () => {
    expect(() => parseSolveBody(null)).toThrow(InvalidSolveBodyError)
    expect(() => parseSolveBody(undefined)).toThrow(InvalidSolveBodyError)
    expect(() => parseSolveBody('hello')).toThrow(InvalidSolveBodyError)
    expect(() => parseSolveBody(42)).toThrow(InvalidSolveBodyError)
    expect(() => parseSolveBody([])).toThrow(InvalidSolveBodyError)
  })

  test('missing mode throws', () => {
    expect(() => parseSolveBody({ stops: 6, usage: 'passenger' })).toThrow(
      /Invalid mode/,
    )
  })

  test('invalid mode throws', () => {
    expect(() =>
      parseSolveBody({ mode: 'C', stops: 6, usage: 'passenger' }),
    ).toThrow(/Invalid mode/)
  })

  test('stops < 2 throws', () => {
    expect(() =>
      parseSolveBody({
        mode: 'B',
        stops: 1,
        usage: 'passenger',
        rated_load_kg: 500,
      }),
    ).toThrow(/stops must be integer/)
  })

  test('non-integer stops throws', () => {
    expect(() =>
      parseSolveBody({
        mode: 'B',
        stops: 6.5,
        usage: 'passenger',
        rated_load_kg: 500,
      }),
    ).toThrow(/stops must be integer/)
  })

  test('invalid usage throws', () => {
    expect(() =>
      parseSolveBody({
        mode: 'B',
        stops: 6,
        usage: 'cargo',
        rated_load_kg: 500,
      }),
    ).toThrow(/Invalid usage/)
  })

  test('mode A missing width_mm throws', () => {
    expect(() =>
      parseSolveBody({
        mode: 'A',
        stops: 6,
        usage: 'passenger',
        depth_mm: 2000,
        total_height_mm: 18000,
        overhead_mm: 4500,
        pit_depth_mm: 1400,
      }),
    ).toThrow(/width_mm must be a positive number/)
  })

  test('mode A rejects zero/negative numerics', () => {
    expect(() =>
      parseSolveBody({
        mode: 'A',
        stops: 6,
        usage: 'passenger',
        width_mm: 0,
        depth_mm: 2000,
        total_height_mm: 18000,
        overhead_mm: 4500,
        pit_depth_mm: 1400,
      }),
    ).toThrow(/width_mm must be a positive number/)
  })

  test('mode B missing rated_load_kg throws', () => {
    expect(() =>
      parseSolveBody({ mode: 'B', stops: 6, usage: 'passenger' }),
    ).toThrow(/rated_load_kg must be a positive number/)
  })

  test('mode B invalid machine_location throws', () => {
    expect(() =>
      parseSolveBody({
        mode: 'B',
        stops: 6,
        usage: 'passenger',
        rated_load_kg: 500,
        machine_location: 'BASEMENT',
      }),
    ).toThrow(/Invalid machine_location/)
  })

  test('caseOverride must be an object when provided', () => {
    expect(() =>
      parseSolveBody({
        mode: 'B',
        stops: 6,
        usage: 'passenger',
        rated_load_kg: 500,
        caseOverride: 'invalid',
      }),
    ).toThrow(/caseOverride must be an object/)
  })
})

describe('parseSolveBody — accepts valid input', () => {
  test('valid mode A body returns typed shape', () => {
    const parsed = parseSolveBody({
      mode: 'A',
      stops: 6,
      usage: 'passenger',
      width_mm: 2000,
      depth_mm: 2200,
      total_height_mm: 18000,
      overhead_mm: 4500,
      pit_depth_mm: 1400,
    })
    expect(parsed.mode).toBe('A')
    expect(parsed.width_mm).toBe(2000)
    expect(parsed.depth_mm).toBe(2200)
    expect(parsed.stops).toBe(6)
    expect(parsed.usage).toBe('passenger')
    expect(parsed.caseOverride).toEqual({})
  })

  test('valid mode B body returns typed shape with defaults', () => {
    const parsed = parseSolveBody({
      mode: 'B',
      stops: 6,
      usage: 'passenger',
      rated_load_kg: 500,
    })
    expect(parsed.mode).toBe('B')
    expect(parsed.rated_load_kg).toBe(500)
    expect(parsed.machine_location).toBe('MR')
    expect(parsed.caseOverride).toEqual({})
  })

  test('lowercase mode is normalized to uppercase', () => {
    const parsed = parseSolveBody({
      mode: 'b',
      stops: 6,
      usage: 'passenger',
      rated_load_kg: 500,
    })
    expect(parsed.mode).toBe('B')
  })

  test('extra unknown fields are silently ignored', () => {
    const parsed = parseSolveBody({
      mode: 'B',
      stops: 6,
      usage: 'passenger',
      rated_load_kg: 500,
      unknownField: 'whatever',
      anotherExtra: 123,
    })
    expect(parsed.mode).toBe('B')
    expect(parsed.rated_load_kg).toBe(500)
    // Extra fields are not copied onto the parsed shape.
    expect((parsed as unknown as Record<string, unknown>).unknownField).toBeUndefined()
  })

  test('caseOverride is passed through when valid', () => {
    const parsed = parseSolveBody({
      mode: 'B',
      stops: 6,
      usage: 'passenger',
      rated_load_kg: 500,
      caseOverride: { 'cwt.width_mm': '800' },
    })
    expect(parsed.caseOverride).toEqual({ 'cwt.width_mm': '800' })
  })
})

describe('parseSolveBody — detail_level', () => {
  test('parseSolveBody defaults detail_level to draft', () => {
    const result = parseSolveBody({
      mode: 'A', stops: 6, usage: 'passenger',
      width_mm: 2000, depth_mm: 2200, total_height_mm: 18000,
      overhead_mm: 4200, pit_depth_mm: 1600
    })
    expect(result.detail_level).toBe('draft')
  })

  test('parseSolveBody accepts professional detail_level', () => {
    const result = parseSolveBody({
      mode: 'A', stops: 6, usage: 'passenger',
      width_mm: 2000, depth_mm: 2200, total_height_mm: 18000,
      overhead_mm: 4200, pit_depth_mm: 1600,
      detail_level: 'professional'
    })
    expect(result.detail_level).toBe('professional')
  })

  test('parseSolveBody ignores invalid detail_level', () => {
    const result = parseSolveBody({
      mode: 'A', stops: 6, usage: 'passenger',
      width_mm: 2000, depth_mm: 2200, total_height_mm: 18000,
      overhead_mm: 4200, pit_depth_mm: 1600,
      detail_level: 'ultra'
    })
    expect(result.detail_level).toBe('draft')
  })
})

describe('handleSolve — integration with validation', () => {
  test('throws InvalidSolveBodyError on malformed body (before hitting solver)', async () => {
    const loader = new StaticRulesLoader()
    await expect(
      handleSolve({ mode: 'Z', stops: 6 }, loader),
    ).rejects.toThrow(InvalidSolveBodyError)
  })

  test('still works on valid mode B body', async () => {
    const loader = new StaticRulesLoader()
    const result = await handleSolve(
      {
        mode: 'B',
        stops: 6,
        usage: 'passenger',
        rated_load_kg: 500,
        machine_location: 'MR',
      },
      loader,
    )
    expect(result.design).toBeDefined()
    expect(result.dxf_string.length).toBeGreaterThan(0)
  })
})
