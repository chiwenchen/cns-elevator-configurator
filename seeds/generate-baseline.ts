#!/usr/bin/env bun
/**
 * Baseline rule generator.
 *
 * Single source of truth for the initial rules seeded into the D1 `rules` table.
 * The numeric values below MIRROR the existing hardcoded constants in:
 *   - src/solver/clearances.ts  (DEFAULT_CLEARANCE, DEFAULT_FLOOR_HEIGHT_MM,
 *                                 carAspectRatio, defaultCarHeight, defaultDoorWidth,
 *                                 minOverheadFromSpeed, minPitDepthFromSpeed)
 *   - src/solver/mode-a.ts      (MIN_SHAFT_WIDTH_MM, MIN_SHAFT_DEPTH_MM)
 *   - src/solver/mode-b.ts      (accessible/bed inline minimums, default speed,
 *                                 door type switch threshold)
 *   - src/dxf/plan.ts           (CWT_*, CAR_RAIL_*, CWT_RAIL_*, DOOR_*, SILL_*)
 *
 * Milestone 1a rule: we do NOT import from those files (which would require
 * exporting module-local consts and touching solver code). Values are duplicated
 * inline with a comment pointing to the source location. Milestone 1b's solver
 * refactor deduplicates — by then solver reads from DB, so these become the
 * authoritative values.
 *
 * Usage:
 *   bun seeds/generate-baseline.ts > seeds/0001_baseline_rules.sql
 */

export interface RawRule {
  key: string
  name: string
  description: string | null
  type: 'number' | 'enum'
  value: string
  default_value: string
  unit: string | null
  baseline_min: number | null
  baseline_max: number | null
  baseline_choices: string[] | null
  category: string
  mandatory: 0 | 1
  source: 'cns' | 'industry' | 'engineering'
}

// Helper to reduce boilerplate for number rules
const num = (
  key: string,
  name: string,
  value: number,
  opts: {
    unit?: string | null
    min?: number | null
    max?: number | null
    category: string
    mandatory: 0 | 1
    source: 'cns' | 'industry' | 'engineering'
    description?: string
  }
): RawRule => ({
  key,
  name,
  description: opts.description ?? null,
  type: 'number',
  value: String(value),
  default_value: String(value),
  unit: opts.unit !== undefined ? opts.unit : 'mm',
  baseline_min: opts.min ?? null,
  baseline_max: opts.max ?? null,
  baseline_choices: null,
  category: opts.category,
  mandatory: opts.mandatory,
  source: opts.source,
})

// Helper for enum rules
const enumRule = (
  key: string,
  name: string,
  value: string,
  choices: string[],
  opts: {
    category: string
    mandatory: 0 | 1
    source: 'cns' | 'industry' | 'engineering'
    description?: string
  }
): RawRule => ({
  key,
  name,
  description: opts.description ?? null,
  type: 'enum',
  value,
  default_value: value,
  unit: null,
  baseline_min: null,
  baseline_max: null,
  baseline_choices: choices,
  category: opts.category,
  mandatory: opts.mandatory,
  source: opts.source,
})

export function buildBaselineRules(): RawRule[] {
  return [
    // ---- shaft (2) ----
    // mirrors src/solver/mode-a.ts MIN_SHAFT_WIDTH_MM
    num('shaft.min_width_mm', '坑道最小寬度', 1400, {
      min: 1400, max: null,
      category: 'shaft', mandatory: 1, source: 'engineering',
      description: '業務輸入 Mode A 坑道寬度時的實用最小值',
    }),
    // mirrors src/solver/mode-a.ts MIN_SHAFT_DEPTH_MM
    num('shaft.min_depth_mm', '坑道最小深度', 1500, {
      min: 1500, max: null,
      category: 'shaft', mandatory: 1, source: 'engineering',
      description: '業務輸入 Mode A 坑道深度時的實用最小值',
    }),

    // ---- clearance (3) ----
    // mirrors src/solver/clearances.ts DEFAULT_CLEARANCE.side_each_mm
    num('clearance.side_mm', '車廂側向間隙', 200, {
      min: 150, max: 400,
      category: 'clearance', mandatory: 1, source: 'engineering',
      description: '車廂左右兩側到坑道壁的單側間隙，容納導軌 + 安裝工作空間',
    }),
    // mirrors src/solver/clearances.ts DEFAULT_CLEARANCE.back_mm
    num('clearance.back_mm', '車廂後方間隙', 250, {
      min: 200, max: 400,
      category: 'clearance', mandatory: 1, source: 'engineering',
      description: '車廂後方到坑道後壁的間隙，容納配重框與後方結構',
    }),
    // mirrors src/solver/clearances.ts DEFAULT_CLEARANCE.front_mm
    num('clearance.front_mm', '車廂前方間隙', 150, {
      min: 100, max: 300,
      category: 'clearance', mandatory: 1, source: 'engineering',
      description: '車廂前方到門檻的間隙，容納門 operator 與 sill 空間',
    }),

    // ---- car (12) ----
    // mirrors src/solver/clearances.ts carAspectRatio() per-usage values
    num('car.aspect_ratio.passenger.w', '客用車廂寬比例', 1.15, {
      unit: null, min: 0.5, max: 3.0,
      category: 'car', mandatory: 1, source: 'industry',
      description: '客用梯車廂寬方向比例（與 d 配對用於 area → dimensions 推算）',
    }),
    num('car.aspect_ratio.passenger.d', '客用車廂深比例', 1.0, {
      unit: null, min: 0.5, max: 3.0,
      category: 'car', mandatory: 1, source: 'industry',
    }),
    num('car.aspect_ratio.accessible.w', '無障礙車廂寬比例', 1.0, {
      unit: null, min: 0.5, max: 3.0,
      category: 'car', mandatory: 1, source: 'cns',
      description: '符合 CNS 13627 1100×1400 的寬比例',
    }),
    num('car.aspect_ratio.accessible.d', '無障礙車廂深比例', 1.27, {
      unit: null, min: 0.5, max: 3.0,
      category: 'car', mandatory: 1, source: 'cns',
    }),
    num('car.aspect_ratio.bed.w', '病床車廂寬比例', 1.0, {
      unit: null, min: 0.3, max: 3.0,
      category: 'car', mandatory: 1, source: 'industry',
    }),
    num('car.aspect_ratio.bed.d', '病床車廂深比例', 2.18, {
      unit: null, min: 1.0, max: 3.0,
      category: 'car', mandatory: 1, source: 'industry',
      description: '病床電梯深遠大於寬，典型 1100×2400',
    }),
    num('car.aspect_ratio.freight.w', '貨用車廂寬比例', 1.0, {
      unit: null, min: 0.5, max: 3.0,
      category: 'car', mandatory: 1, source: 'industry',
    }),
    num('car.aspect_ratio.freight.d', '貨用車廂深比例', 1.0, {
      unit: null, min: 0.5, max: 3.0,
      category: 'car', mandatory: 1, source: 'industry',
    }),
    // mirrors src/solver/clearances.ts defaultCarHeight()
    num('car.height_mm.passenger', '客用車廂淨高', 2300, {
      min: 2100, max: 2700,
      category: 'car', mandatory: 0, source: 'industry',
    }),
    num('car.height_mm.accessible', '無障礙車廂淨高', 2300, {
      min: 2100, max: 2700,
      category: 'car', mandatory: 0, source: 'industry',
    }),
    num('car.height_mm.bed', '病床車廂淨高', 2400, {
      min: 2200, max: 2700,
      category: 'car', mandatory: 0, source: 'industry',
    }),
    num('car.height_mm.freight', '貨用車廂淨高', 2200, {
      min: 2000, max: 3000,
      category: 'car', mandatory: 0, source: 'industry',
    }),

    // ---- cwt (5) ----
    // Implicit in src/dxf/plan.ts — CWT is currently always drawn at
    // back-left (offset 250 from left wall, 40 from back wall).
    enumRule(
      'cwt.position',
      '配重位置',
      'back_left',
      ['back_left', 'back_center', 'back_right', 'side_left', 'side_right'],
      {
        category: 'cwt', mandatory: 0, source: 'engineering',
        description: '配重在坑道中的擺放位置。影響 DXF plan view 繪圖，不影響結構計算。',
      }
    ),
    // mirrors src/dxf/plan.ts CWT_WIDTH_MM
    num('cwt.width_mm', '配重框寬度', 700, {
      min: 300, max: 1500,
      category: 'cwt', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts CWT_THICKNESS_MM
    num('cwt.thickness_mm', '配重框厚度', 120, {
      min: 80, max: 250,
      category: 'cwt', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts CWT_BACK_OFFSET_MM
    num('cwt.back_offset_mm', '配重與後牆間隙', 40, {
      min: 20, max: 150,
      category: 'cwt', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts line 59 `const cwtX0 = ox + 250`
    num('cwt.left_offset_mm', '配重與左牆間隙', 250, {
      min: 100, max: 800,
      category: 'cwt', mandatory: 0, source: 'engineering',
      description: '配重框左側與坑道左牆的距離（DXF plan view 繪圖用）',
    }),

    // ---- rail (4) ----
    // mirrors src/dxf/plan.ts CAR_RAIL_SIZE_MM
    num('rail.car.size_mm', '車廂導軌外接方塊邊長', 90, {
      min: 50, max: 150,
      category: 'rail', mandatory: 0, source: 'engineering',
      description: 'T 型導軌在 plan view 的簡化方塊尺寸',
    }),
    // mirrors src/dxf/plan.ts CAR_RAIL_GAP_MM
    num('rail.car.gap_mm', '車廂導軌與車廂側面 gap', 30, {
      min: 10, max: 80,
      category: 'rail', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts CWT_RAIL_SIZE_MM
    num('rail.cwt.size_mm', '配重導軌邊長', 70, {
      min: 40, max: 120,
      category: 'rail', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts line 72 `cwtX0 - CWT_RAIL_SIZE_MM - 20`
    num('rail.cwt.gap_mm', '配重導軌與配重邊緣 gap', 20, {
      min: 10, max: 60,
      category: 'rail', mandatory: 0, source: 'engineering',
      description: '配重框兩側到配重導軌的間隙',
    }),

    // ---- door (8) ----
    // mirrors src/dxf/plan.ts DOOR_FRAME_DEPTH_MM
    num('door.frame_depth_mm', '門套深度', 100, {
      min: 50, max: 200,
      category: 'door', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts DOOR_LEAF_THICKNESS_MM
    num('door.leaf_thickness_mm', '門扇厚度', 30, {
      min: 20, max: 80,
      category: 'door', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/dxf/plan.ts SILL_DEPTH_MM
    num('door.sill_depth_mm', '門檻深度', 90, {
      min: 50, max: 150,
      category: 'door', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/solver/clearances.ts defaultDoorWidth('passenger')
    num('door.default_width_mm.passenger', '客用電梯預設門寬', 800, {
      min: 700, max: 1200,
      category: 'door', mandatory: 0, source: 'industry',
    }),
    // mirrors src/solver/clearances.ts defaultDoorWidth('accessible')
    num('door.default_width_mm.accessible', '無障礙電梯預設門寬', 900, {
      min: 900, max: 1400,
      category: 'door', mandatory: 1, source: 'cns',
      description: 'CNS 13627 規定無障礙電梯門淨寬不得小於 900 mm',
    }),
    // mirrors src/solver/clearances.ts defaultDoorWidth('bed')
    num('door.default_width_mm.bed', '病床電梯預設門寬', 1100, {
      min: 1100, max: 1400,
      category: 'door', mandatory: 0, source: 'industry',
    }),
    // mirrors src/solver/clearances.ts defaultDoorWidth('freight')
    num('door.default_width_mm.freight', '貨用電梯預設門寬', 1100, {
      min: 900, max: 1800,
      category: 'door', mandatory: 0, source: 'industry',
    }),
    // mirrors src/solver/mode-b.ts line 120:
    //   type: car_width_mm >= 1400 ? 'center_opening' : 'side_opening'
    num('door.type_switch.center_opening_min_car_width_mm', '中分門切換下限', 1400, {
      min: 1100, max: 1800,
      category: 'door', mandatory: 0, source: 'engineering',
      description: '車廂寬 ≥ 此值時預設中分門，否則側開門',
    }),

    // ---- height (9) ----
    // mirrors src/solver/clearances.ts DEFAULT_FLOOR_HEIGHT_MM
    num('height.floor_default_mm', '預設樓層高', 3000, {
      min: 2400, max: 4500,
      category: 'height', mandatory: 0, source: 'industry',
      description: 'Mode B 樓層高預設值（用戶沒填時）',
    }),
    // mirrors src/solver/mode-b.ts `rated_speed_mpm ?? 60`
    num('height.default_speed_mpm', '預設額定速度', 60, {
      unit: 'm/min', min: 30, max: 240,
      category: 'height', mandatory: 0, source: 'industry',
    }),
    // mirrors src/solver/clearances.ts minOverheadFromSpeed() refuge
    num('height.overhead.refuge_mm', 'Overhead 避險空間', 2000, {
      min: 1800, max: 2500,
      category: 'height', mandatory: 1, source: 'cns',
      description: 'CNS 15827-20 §5.2.5.7.1 規定的車頂站立避險高度',
    }),
    // mirrors src/solver/clearances.ts minOverheadFromSpeed() machine_and_buffer
    num('height.overhead.machine_buffer_mm', 'Overhead 機械 + 緩衝', 2000, {
      min: 1500, max: 3000,
      category: 'height', mandatory: 1, source: 'engineering',
    }),
    // mirrors src/solver/clearances.ts minOverheadFromSpeed() 0.035 * v² 的 0.035
    num('height.overhead.bounce_coef', 'Overhead 跳衝係數', 0.035, {
      unit: null, min: 0.035, max: 0.05,
      category: 'height', mandatory: 1, source: 'cns',
      description: 'EN 81-20 / CNS 15827-20 跳衝計算公式係數 (0.035 × v²)',
    }),
    // mirrors src/solver/clearances.ts minPitDepthFromSpeed() refuge
    num('height.pit.refuge_mm', 'Pit 避險空間', 1000, {
      min: 1000, max: 1500,
      category: 'height', mandatory: 1, source: 'cns',
      description: 'CNS 15827-20 §5.2.5.8.1 規定的底坑蜷縮避險空間',
    }),
    // mirrors src/solver/clearances.ts minPitDepthFromSpeed() buffer
    num('height.pit.buffer_mm', 'Pit 緩衝空間', 500, {
      min: 300, max: 800,
      category: 'height', mandatory: 1, source: 'engineering',
    }),
    // mirrors src/solver/clearances.ts minPitDepthFromSpeed() speed > 90 加 200
    num('height.pit.speed_bonus_90mpm_mm', 'Pit 速度加值 (>90 m/min)', 200, {
      min: 0, max: 500,
      category: 'height', mandatory: 0, source: 'engineering',
    }),
    // mirrors src/solver/clearances.ts minPitDepthFromSpeed() speed > 150 加 500
    num('height.pit.speed_bonus_150mpm_mm', 'Pit 速度加值 (>150 m/min)', 500, {
      min: 200, max: 1000,
      category: 'height', mandatory: 0, source: 'engineering',
    }),

    // ---- usage (3) ----
    // mirrors src/solver/mode-b.ts line 66 accessible 1100 check
    num('usage.accessible.min_car_width_mm', '無障礙車廂最小寬', 1100, {
      min: 1100, max: 1400,
      category: 'usage', mandatory: 1, source: 'cns',
      description: 'CNS 13627 無障礙電梯車廂最小寬 1100 mm',
    }),
    // mirrors src/solver/mode-b.ts line 66 accessible 1400 check
    num('usage.accessible.min_car_depth_mm', '無障礙車廂最小深', 1400, {
      min: 1400, max: 1800,
      category: 'usage', mandatory: 1, source: 'cns',
      description: 'CNS 13627 無障礙電梯車廂最小深 1400 mm',
    }),
    // mirrors src/solver/mode-b.ts line 77 bed 2400 check
    num('usage.bed.min_car_depth_mm', '病床電梯車廂最小深', 2400, {
      min: 2400, max: 3000,
      category: 'usage', mandatory: 1, source: 'industry',
      description: '病床電梯最小車廂深度 (容納擔架 + 護理人員)',
    }),
  ]
}

// ---- SQL serialization ----

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''")
}

function toSqlLiteral(v: string | number | null): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') return String(v)
  return `'${sqlEscape(v)}'`
}

export function toInsertSql(rules: RawRule[]): string {
  const columns = [
    'key', 'name', 'description', 'type', 'value', 'default_value', 'unit',
    'baseline_min', 'baseline_max', 'baseline_choices', 'category', 'mandatory',
    'source', 'created_at', 'updated_at',
  ]
  const header = `-- Generated by seeds/generate-baseline.ts. Do not edit directly.\n-- To regenerate: bun seeds/generate-baseline.ts > seeds/0001_baseline_rules.sql\n\nINSERT INTO rules (\n  ${columns.join(', ')}\n) VALUES`

  const rows = rules.map(r => {
    const baseline_choices =
      r.baseline_choices === null ? null : JSON.stringify(r.baseline_choices)
    const values = [
      toSqlLiteral(r.key),
      toSqlLiteral(r.name),
      toSqlLiteral(r.description),
      toSqlLiteral(r.type),
      toSqlLiteral(r.value),
      toSqlLiteral(r.default_value),
      toSqlLiteral(r.unit),
      toSqlLiteral(r.baseline_min),
      toSqlLiteral(r.baseline_max),
      toSqlLiteral(baseline_choices),
      toSqlLiteral(r.category),
      String(r.mandatory),
      toSqlLiteral(r.source),
      "strftime('%s','now')",
      "strftime('%s','now')",
    ]
    return `  (${values.join(', ')})`
  })

  return `${header}\n${rows.join(',\n')};\n`
}

// ---- CLI entry ----

if (import.meta.main) {
  const rules = buildBaselineRules()
  process.stdout.write(toInsertSql(rules))
}
