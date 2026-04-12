import { describe, test, expect } from 'bun:test'
import { defaultFixtureConfig } from './fixtures'

describe('defaultFixtureConfig', () => {
  test('returns a valid EffectiveConfig derived from seeds', () => {
    const config = defaultFixtureConfig()
    expect(config).toBeDefined()
  })

  test('matches expected seed values for sanity check', () => {
    const config = defaultFixtureConfig()
    expect(config.clearance.side_mm).toBe(200)
    expect(config.clearance.back_mm).toBe(250)
    expect(config.clearance.front_mm).toBe(150)
    expect(config.shaft.min_width_mm).toBe(1400)
    expect(config.shaft.min_depth_mm).toBe(1500)
    expect(config.cwt.position).toBe('back_left')
    expect(config.cwt.left_offset_mm).toBe(250)
    expect(config.rail.cwt_gap_mm).toBe(20)
    expect(config.height.floor_default_mm).toBe(3000)
    expect(config.height.default_speed_mpm).toBe(60)
    expect(config.height.overhead.bounce_coef).toBe(0.035)
    expect(config.car.height_mm.passenger).toBe(2300)
    expect(config.car.height_mm.bed).toBe(2400)
    expect(config.door.default_width_mm.accessible).toBe(900)
    expect(config.door.center_opening_min_car_width_mm).toBe(1400)
    expect(config.usage_constraints.accessible_min_car_width_mm).toBe(1100)
    expect(config.usage_constraints.accessible_min_car_depth_mm).toBe(1400)
    expect(config.usage_constraints.bed_min_car_depth_mm).toBe(2400)
  })

  test('all 4 usages have aspect_ratio entries', () => {
    const config = defaultFixtureConfig()
    expect(config.car.aspect_ratio.passenger).toEqual({ w: 1.15, d: 1.0 })
    expect(config.car.aspect_ratio.accessible).toEqual({ w: 1.0, d: 1.27 })
    expect(config.car.aspect_ratio.bed).toEqual({ w: 1.0, d: 2.18 })
    expect(config.car.aspect_ratio.freight).toEqual({ w: 1.0, d: 1.0 })
  })

  test('is a fresh object (no shared mutation)', () => {
    const a = defaultFixtureConfig()
    const b = defaultFixtureConfig()
    a.clearance.side_mm = 999
    expect(b.clearance.side_mm).toBe(200)
  })
})
