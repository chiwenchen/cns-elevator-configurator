/**
 * Coverage + smoke test for analyzeArchDxf against the real hack-canada.dxf
 * architectural fixture that ships in public/assets.
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { analyzeArchDxf } from './analyze-arch'

const FIXTURE_PATH = 'public/assets/hack-canada.dxf'

describe('analyzeArchDxf against hack-canada.dxf fixture', () => {
  test('parses the fixture and returns the expected shape', () => {
    const dxfText = readFileSync(FIXTURE_PATH, 'utf-8')
    const result = analyzeArchDxf(dxfText, 'hack-canada', FIXTURE_PATH)

    expect(result.source).toBe('hack-canada')
    expect(result.file).toBe(FIXTURE_PATH)
    expect(result.file_kb).toBeGreaterThan(0)
    expect(typeof result.unit).toBe('string')
    expect(result.entity_count).toBeGreaterThan(0)
    expect(result.room_count).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(result.walls)).toBe(true)
    expect(Array.isArray(result.doors)).toBe(true)
    expect(Array.isArray(result.windows)).toBe(true)
    expect(Array.isArray(result.columns)).toBe(true)
    expect(Array.isArray(result.balconies)).toBe(true)
    expect(Array.isArray(result.inserts)).toBe(true)
    expect(Array.isArray(result.elevator_labels)).toBe(true)
    expect(Array.isArray(result.shaft_groups)).toBe(true)
    expect(result.building_bbox).toBeDefined()
    expect(Array.isArray(result.rooms)).toBe(true)
  })
})
