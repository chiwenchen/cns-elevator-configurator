# Milestone 1b: Solver Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the solver + DXF layer to read design constants from D1 (via `EffectiveConfig`) instead of module-level constants, with zero behavior change when no case override is applied. Add `caseOverride` to the `/api/solve` request body (frontend still sends empty `{}` — no UI change).

**Architecture:** Introduce a `src/config/*` module namespace that owns type definitions (`EffectiveConfig`, `TeamRule`, `CaseOverride`), D1 loading (`loadActiveRules`), three-layer merging (`buildEffectiveConfig` with baseline enforcement), and a test fixture (`defaultFixtureConfig()` derived from the generator). Refactor `src/solver/*.ts` and `src/dxf/*.ts` to accept config as a parameter. Rewrite `src/handlers/solve.ts` as an orchestrator. Add Layer 1 unit tests for `buildEffectiveConfig` and refactor existing 18 solver tests to inject fixture config. Snapshot test confirms byte-identical design output for Mode B 500kg passenger.

**Tech Stack:** TypeScript, Cloudflare D1, bun:test, dxf-writer (unchanged)

**Parent spec:** `docs/superpowers/specs/2026-04-12-guidance-system-design.md` §4 + §8 Milestone 1b

**Findings carried forward:** `docs/superpowers/specs/2026-04-12-milestone-1a-review-findings.md` — finding [1] expands 1b scope to include `src/dxf/plan.ts` refactor and a new rule `cwt.left_offset_mm` (discovered during 1b planning as another hidden hardcoded 250 in plan.ts)

**Workflow rule:** One PR on `feat/milestone-1b-solver-refactor` branch. Sequential small-PR workflow. Do NOT start Milestone 1c until 1b PR is merged and main is pulled.

---

## Scope Boundaries

### In scope
- Create `src/config/{types,effective,load,fixtures}.ts` (4 new files)
- Add 2 new rules to baseline seeds (`cwt.left_offset_mm = 250`, `rail.cwt.gap_mm = 20`) — new total: 46 rules
- Regenerate `seeds/0001_baseline_rules.sql` from updated generator
- Apply additional rules to local + production D1
- Refactor `src/solver/clearances.ts` (remove module constants, helpers take config)
- Refactor `src/solver/mode-a.ts` (accepts config)
- Refactor `src/solver/mode-b.ts` (accepts config, inline magic numbers → config reads)
- Refactor `src/dxf/plan.ts` (all 10 constants + `frontGap` + `cwt.left_offset_mm` + `rail.cwt.gap_mm` → config reads)
- Refactor `src/dxf/generate.ts` (pass config through)
- Rewrite `src/handlers/solve.ts` as async orchestrator taking `env.DB`
- Update `src/worker/index.ts` + `src/demo/server.ts` to pass DB binding / fixture-backed loader
- Refactor existing 18 solver tests to inject `defaultFixtureConfig()`
- Add ~20 Layer 1 unit tests for `buildEffectiveConfig`
- Add snapshot test for /api/solve Mode B 500kg passenger (byte-identical contract)
- Add integration test for solver + DXF geometry coupling (drift detection)
- Stub `validation_report` in response (real logic = Milestone 1c)
- Test coverage ≥90% on `src/` TypeScript files (measured via `bun test --coverage`)

### Out of scope (Milestone 1c+)
- Rules CRUD API (`GET/PATCH/DELETE /api/rules`)
- Frontend UI changes (validation panel, rules tab)
- AI chat (1d)
- Real approval workflow

---

## File Structure

**New files:**
- `src/config/types.ts` — `TeamRule`, `CaseOverride`, `EffectiveConfig`, `CwtPosition`, `ValidationReport` (stub shape)
- `src/config/effective.ts` — `buildEffectiveConfig`, `BaselineViolationError`, `assertValueWithinBaseline`
- `src/config/effective.test.ts` — unit tests for buildEffectiveConfig
- `src/config/load.ts` — `loadActiveRules(db)` D1 query + `StaticRulesLoader` for Bun local dev
- `src/config/fixtures.ts` — `defaultFixtureConfig()` derived from seeds/generate-baseline
- `src/config/fixtures.test.ts` — verify fixture matches seed values
- `src/handlers/solve-snapshot.test.ts` — byte-identical snapshot test for Mode B 500kg passenger
- `src/handlers/solve-geometry.test.ts` — integration test: case override affects solver + DXF consistently

**Modified files:**
- `seeds/generate-baseline.ts` — add `cwt.left_offset_mm` + `rail.cwt.gap_mm` rules
- `seeds/generate-baseline.test.ts` — update count assertion 44 → 46, add pinned tests for new rules
- `seeds/0001_baseline_rules.sql` — regenerated
- `src/solver/clearances.ts` — remove `DEFAULT_CLEARANCE`, `DEFAULT_FLOOR_HEIGHT_MM`, helper functions take config parameter
- `src/solver/mode-a.ts` — signature `solveModeA(input, config)`, reads from config
- `src/solver/mode-b.ts` — signature `solveModeB(input, config)`, inline magic numbers → config reads
- `src/solver/solver.test.ts` — all 18 tests inject `defaultFixtureConfig()`
- `src/dxf/plan.ts` — `drawPlanView(dw, design, origin, config)`, all 13 hardcoded values → config
- `src/dxf/generate.ts` — `generateElevatorDXF(design, config)`, passes config to drawPlanView
- `src/handlers/solve.ts` — async orchestrator, takes `env.DB`
- `src/worker/index.ts` — passes `env` to handleSolve
- `src/demo/server.ts` — uses `StaticRulesLoader` instead of D1 (simpler for local Bun)
- `.github/workflows/test.yml` — add `bun test --coverage` step; coverage gate

**Untouched files (Milestone 1c scope):**
- `public/index.html` — frontend stays as-is; still sends empty caseOverride
- `src/handlers/analyze-arch.ts` / `analyze-generated.ts` — unchanged

---

## Definition of Done

- [ ] 46 rules seeded in local + prod D1
- [ ] All 18 existing solver tests still pass (refactored to use fixture config)
- [ ] ~20 new buildEffectiveConfig unit tests pass
- [ ] Fixture sanity test passes (fixture matches seeded rule values)
- [ ] Snapshot test passes (Mode B 500kg passenger byte-identical design)
- [ ] Integration test passes (case override affects solver + DXF consistently)
- [ ] Production `/api/solve` with empty caseOverride returns byte-identical design (excluding timestamp)
- [ ] Production `/api/solve` with case override (e.g. `{"cwt.position": "back_center"}`) successfully alters output
- [ ] Production `/api/solve` with baseline violation (e.g. `{"clearance.side_mm": "50"}`) returns 400 with `error: "baseline_violation"`
- [ ] `bun test --coverage` reports ≥90% line coverage on `src/**/*.ts` (excluding test files)
- [ ] All 6+ commits signed, one merged PR
- [ ] CI workflow includes coverage gate (fail-on-coverage-below-90)

---

## Pre-Task: Branch Setup

- [ ] **Step 1: Ensure clean main**

```bash
cd /Users/chiwenchen/Documents/repos/cns-elevator-configurator
git status
git checkout main
git fetch origin
git pull --rebase origin main
```

Expected: `On branch main`, clean, `522b489` at HEAD. Untracked file: `docs/superpowers/plans/2026-04-12-milestone-1b-solver-refactor.md`.

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b feat/milestone-1b-solver-refactor
```

- [ ] **Step 3: Commit plan file**

```bash
git add docs/superpowers/plans/2026-04-12-milestone-1b-solver-refactor.md
git commit -S -m "docs(plans): add Milestone 1b solver refactor implementation plan"
```

---

## Task 1: Add 2 new rules to baseline seeds

**Files:**
- Modify: `seeds/generate-baseline.ts` (add 2 rule definitions, bump count to 46)
- Modify: `seeds/generate-baseline.test.ts` (update count assertion, add pinned tests)
- Regenerate: `seeds/0001_baseline_rules.sql`

**Why:** During 1b planning, inspection of `src/dxf/plan.ts` revealed two more hidden hardcoded values: `cwt.left_offset_mm = 250` (line 59 `const cwtX0 = ox + 250`) and `rail.cwt.gap_mm = 20` (lines 72/74/77/80 `- 20` / `+ 20`). These are exactly the kind of stealthy coupling that the findings doc warned about. Add them now so Task 7 (plan.ts refactor) can read from config instead of re-hardcoding them.

- [ ] **Step 1: Update `buildBaselineRules` in `seeds/generate-baseline.ts`**

Find the `// ---- cwt (4) ----` section and add a new entry after `cwt.back_offset_mm`. The updated cwt block becomes:

```typescript
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
```

Then find the `// ---- rail (3) ----` section and add a new entry for `rail.cwt.gap_mm`. The updated rail block becomes:

```typescript
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
```

- [ ] **Step 2: Update the count assertion in `seeds/generate-baseline.test.ts`**

Change:
```typescript
test('returns exactly 44 rules', () => {
  const rules = buildBaselineRules()
  expect(rules).toHaveLength(44)
})
```

To:
```typescript
test('returns exactly 46 rules', () => {
  const rules = buildBaselineRules()
  expect(rules).toHaveLength(46)
})
```

Then add two new pinned tests inside the `describe('buildBaselineRules — specific spec rules present', ...)` block (right after the aspect ratio test):

```typescript
  test('cwt.left_offset_mm exists with value 250', () => {
    const r = byKey().get('cwt.left_offset_mm')!
    expect(r).toBeDefined()
    expect(r.type).toBe('number')
    expect(r.value).toBe('250')
    expect(r.baseline_min).toBe(100)
    expect(r.baseline_max).toBe(800)
    expect(r.category).toBe('cwt')
    expect(r.source).toBe('engineering')
  })

  test('rail.cwt.gap_mm exists with value 20', () => {
    const r = byKey().get('rail.cwt.gap_mm')!
    expect(r).toBeDefined()
    expect(r.value).toBe('20')
    expect(r.baseline_min).toBe(10)
    expect(r.baseline_max).toBe(60)
    expect(r.category).toBe('rail')
  })
```

- [ ] **Step 3: Run the tests**

```bash
bun test seeds/generate-baseline.test.ts
```

Expected: 25 pass, 0 fail (was 23; +1 for count, +2 new pinned tests).

- [ ] **Step 4: Regenerate the seed SQL**

```bash
bun seeds/generate-baseline.ts > seeds/0001_baseline_rules.sql
grep -c "^  (" seeds/0001_baseline_rules.sql
```

Expected: `46` (46 value rows).

- [ ] **Step 5: Apply the new rules to local D1**

Since the existing 44 rules are already in local D1, we can't just re-run the seed (UNIQUE constraint violation). Clean slate:

```bash
wrangler d1 execute elevator-configurator-db --local --command "DELETE FROM rules"
wrangler d1 execute elevator-configurator-db --local --file seeds/0001_baseline_rules.sql
wrangler d1 execute elevator-configurator-db --local --command "SELECT COUNT(*) FROM rules"
```

Expected: `count = 46`.

- [ ] **Step 6: Apply to production D1**

```bash
wrangler d1 execute elevator-configurator-db --command "DELETE FROM rules"
wrangler d1 execute elevator-configurator-db --file seeds/0001_baseline_rules.sql
wrangler d1 execute elevator-configurator-db --command "SELECT COUNT(*) FROM rules"
```

Expected: `count = 46`.

- [ ] **Step 7: Verify existing solver tests still pass**

```bash
bun test src/solver/solver.test.ts
```

Expected: 18/18 pass (solver still reads module-level constants; DB contents don't affect yet).

- [ ] **Step 8: Commit**

```bash
git add seeds/generate-baseline.ts seeds/generate-baseline.test.ts seeds/0001_baseline_rules.sql
git commit -S -m "feat(seeds): add cwt.left_offset_mm + rail.cwt.gap_mm (46 rules total)"
```

---

## Task 2: Create `src/config/types.ts`

**Files:**
- Create: `src/config/types.ts`

**Rationale:** Define all shared types used by effective.ts, load.ts, fixtures.ts, and downstream consumers (solver, handler, DXF). Types only, no runtime logic.

- [ ] **Step 1: Create the types file with complete content**

Create `src/config/types.ts`:

```typescript
/**
 * Config system types — shared across rules loading, effective config building,
 * and solver/DXF consumption.
 *
 * No runtime logic lives here; see effective.ts, load.ts, fixtures.ts.
 */

import type { Usage, DoorType } from '../solver/types'

/** A row from the D1 `rules` table, parsed into typed form. */
export interface TeamRule {
  id: number
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

/** Flat key → value map sent by client in /api/solve request body. */
export interface CaseOverride {
  [key: string]: string
}

/** Counterweight position choices (matches `cwt.position` enum rule). */
export type CwtPosition =
  | 'back_left'
  | 'back_center'
  | 'back_right'
  | 'side_left'
  | 'side_right'

/** Overhead formula parameters (CNS 15827-20 §5.2.5.7.1 derived). */
export interface OverheadFormulaParams {
  refuge_mm: number
  machine_buffer_mm: number
  bounce_coef: number
}

/** Pit depth formula parameters (CNS 15827-20 §5.2.5.8.1 derived). */
export interface PitFormulaParams {
  refuge_mm: number
  buffer_mm: number
  speed_bonus_90mpm_mm: number
  speed_bonus_150mpm_mm: number
}

/**
 * Parsed + structured EffectiveConfig. This is what the solver, DXF generator,
 * and validation report consume. Built from:
 *   baseline (DB rules) + team defaults (DB values) + per-case override (request body)
 * via buildEffectiveConfig in effective.ts.
 */
export interface EffectiveConfig {
  shaft: {
    min_width_mm: number
    min_depth_mm: number
  }
  clearance: {
    side_mm: number
    back_mm: number
    front_mm: number
  }
  car: {
    aspect_ratio: Record<Usage, { w: number; d: number }>
    height_mm: Record<Usage, number>
  }
  cwt: {
    position: CwtPosition
    width_mm: number
    thickness_mm: number
    back_offset_mm: number
    left_offset_mm: number
  }
  rail: {
    car_size_mm: number
    car_gap_mm: number
    cwt_size_mm: number
    cwt_gap_mm: number
  }
  door: {
    frame_depth_mm: number
    leaf_thickness_mm: number
    sill_depth_mm: number
    default_width_mm: Record<Usage, number>
    center_opening_min_car_width_mm: number
  }
  height: {
    floor_default_mm: number
    default_speed_mpm: number
    overhead: OverheadFormulaParams
    pit: PitFormulaParams
  }
  usage_constraints: {
    accessible_min_car_width_mm: number
    accessible_min_car_depth_mm: number
    bed_min_car_depth_mm: number
  }
}

/** Re-exports so downstream files don't have to double-import. */
export type { Usage, DoorType } from '../solver/types'
```

- [ ] **Step 2: Verify it type-checks**

```bash
bun -e "import type { EffectiveConfig } from './src/config/types'; console.log('OK')"
```

Expected: prints `OK` (means the file parses and the type export exists).

- [ ] **Step 3: Commit**

```bash
git add src/config/types.ts
git commit -S -m "feat(config): add EffectiveConfig + TeamRule + CaseOverride types"
```

---

## Task 3: Create `src/config/effective.ts` with TDD

**Files:**
- Create: `src/config/effective.test.ts` (write test first, run fail)
- Create: `src/config/effective.ts` (implement to pass tests)

**Rationale:** `buildEffectiveConfig` is the heart of the config system. Must: validate every rule against its baseline, merge case override into team defaults, parse strings to typed values, assemble the nested EffectiveConfig structure. Fail-fast on baseline violations.

- [ ] **Step 1: Write the failing test file**

Create `src/config/effective.test.ts`:

```typescript
/**
 * Unit tests for buildEffectiveConfig — the three-layer rule merger.
 *
 * Tests operate on fixture TeamRule[] arrays (no D1 access). Covers:
 *   - No override → team defaults used
 *   - Override within baseline → applied
 *   - Override violates baseline min/max/choices → throws BaselineViolationError
 *   - Stale / unknown override key → silently ignored
 *   - Type coercion (number string → number, enum string → literal)
 *   - Structural assembly (per-usage records, nested formula params)
 *   - Missing required rule → throws (seed drift guard)
 */

import { describe, test, expect } from 'bun:test'
import { buildEffectiveConfig, BaselineViolationError } from './effective'
import type { TeamRule, CaseOverride } from './types'

// ---- Fixture helpers ----

function num(
  key: string,
  value: number,
  opts: { min?: number; max?: number; category?: string; mandatory?: 0 | 1; source?: 'cns' | 'industry' | 'engineering' } = {}
): TeamRule {
  return {
    id: 0,
    key,
    name: key,
    description: null,
    type: 'number',
    value: String(value),
    default_value: String(value),
    unit: 'mm',
    baseline_min: opts.min ?? null,
    baseline_max: opts.max ?? null,
    baseline_choices: null,
    category: opts.category ?? 'shaft',
    mandatory: opts.mandatory ?? 0,
    source: opts.source ?? 'engineering',
  }
}

function enumR(
  key: string,
  value: string,
  choices: string[],
  opts: { category?: string; mandatory?: 0 | 1 } = {}
): TeamRule {
  return {
    id: 0,
    key,
    name: key,
    description: null,
    type: 'enum',
    value,
    default_value: value,
    unit: null,
    baseline_min: null,
    baseline_max: null,
    baseline_choices: choices,
    category: opts.category ?? 'cwt',
    mandatory: opts.mandatory ?? 0,
    source: 'engineering',
  }
}

/**
 * Minimal set of rules the config parser requires. In tests we inject via
 * defaultFixtureConfig in src/config/fixtures.ts, but for unit tests we build
 * the minimal set manually to avoid coupling to the generator.
 */
function makeCompleteRuleSet(): TeamRule[] {
  return [
    num('shaft.min_width_mm', 1400, { min: 1400, category: 'shaft', mandatory: 1 }),
    num('shaft.min_depth_mm', 1500, { min: 1500, category: 'shaft', mandatory: 1 }),
    num('clearance.side_mm', 200, { min: 150, max: 400, category: 'clearance', mandatory: 1 }),
    num('clearance.back_mm', 250, { min: 200, max: 400, category: 'clearance', mandatory: 1 }),
    num('clearance.front_mm', 150, { min: 100, max: 300, category: 'clearance', mandatory: 1 }),
    num('car.aspect_ratio.passenger.w', 1.15, { category: 'car' }),
    num('car.aspect_ratio.passenger.d', 1.0, { category: 'car' }),
    num('car.aspect_ratio.accessible.w', 1.0, { category: 'car' }),
    num('car.aspect_ratio.accessible.d', 1.27, { category: 'car' }),
    num('car.aspect_ratio.bed.w', 1.0, { category: 'car' }),
    num('car.aspect_ratio.bed.d', 2.18, { category: 'car' }),
    num('car.aspect_ratio.freight.w', 1.0, { category: 'car' }),
    num('car.aspect_ratio.freight.d', 1.0, { category: 'car' }),
    num('car.height_mm.passenger', 2300, { category: 'car' }),
    num('car.height_mm.accessible', 2300, { category: 'car' }),
    num('car.height_mm.bed', 2400, { category: 'car' }),
    num('car.height_mm.freight', 2200, { category: 'car' }),
    enumR('cwt.position', 'back_left', ['back_left', 'back_center', 'back_right', 'side_left', 'side_right']),
    num('cwt.width_mm', 700, { category: 'cwt' }),
    num('cwt.thickness_mm', 120, { category: 'cwt' }),
    num('cwt.back_offset_mm', 40, { category: 'cwt' }),
    num('cwt.left_offset_mm', 250, { category: 'cwt' }),
    num('rail.car.size_mm', 90, { category: 'rail' }),
    num('rail.car.gap_mm', 30, { category: 'rail' }),
    num('rail.cwt.size_mm', 70, { category: 'rail' }),
    num('rail.cwt.gap_mm', 20, { category: 'rail' }),
    num('door.frame_depth_mm', 100, { category: 'door' }),
    num('door.leaf_thickness_mm', 30, { category: 'door' }),
    num('door.sill_depth_mm', 90, { category: 'door' }),
    num('door.default_width_mm.passenger', 800, { category: 'door' }),
    num('door.default_width_mm.accessible', 900, { category: 'door', mandatory: 1, source: 'cns' }),
    num('door.default_width_mm.bed', 1100, { category: 'door' }),
    num('door.default_width_mm.freight', 1100, { category: 'door' }),
    num('door.type_switch.center_opening_min_car_width_mm', 1400, { category: 'door' }),
    num('height.floor_default_mm', 3000, { category: 'height' }),
    num('height.default_speed_mpm', 60, { category: 'height' }),
    num('height.overhead.refuge_mm', 2000, { category: 'height', mandatory: 1, source: 'cns' }),
    num('height.overhead.machine_buffer_mm', 2000, { category: 'height', mandatory: 1 }),
    num('height.overhead.bounce_coef', 0.035, { category: 'height', mandatory: 1, source: 'cns' }),
    num('height.pit.refuge_mm', 1000, { category: 'height', mandatory: 1, source: 'cns' }),
    num('height.pit.buffer_mm', 500, { category: 'height', mandatory: 1 }),
    num('height.pit.speed_bonus_90mpm_mm', 200, { category: 'height' }),
    num('height.pit.speed_bonus_150mpm_mm', 500, { category: 'height' }),
    num('usage.accessible.min_car_width_mm', 1100, { category: 'usage', mandatory: 1, source: 'cns' }),
    num('usage.accessible.min_car_depth_mm', 1400, { category: 'usage', mandatory: 1, source: 'cns' }),
    num('usage.bed.min_car_depth_mm', 2400, { category: 'usage', mandatory: 1 }),
  ]
}

describe('buildEffectiveConfig — happy path', () => {
  test('no override: final values match team defaults', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {})
    expect(config.clearance.side_mm).toBe(200)
    expect(config.shaft.min_width_mm).toBe(1400)
    expect(config.cwt.position).toBe('back_left')
    expect(config.cwt.left_offset_mm).toBe(250)
    expect(config.rail.cwt_gap_mm).toBe(20)
  })

  test('override within baseline number: applied', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {
      'clearance.side_mm': '250',
    })
    expect(config.clearance.side_mm).toBe(250)
  })

  test('override enum with valid choice: applied', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {
      'cwt.position': 'back_center',
    })
    expect(config.cwt.position).toBe('back_center')
  })

  test('per-usage variants round-trip through config structure', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {})
    expect(config.car.aspect_ratio.passenger).toEqual({ w: 1.15, d: 1.0 })
    expect(config.car.aspect_ratio.accessible).toEqual({ w: 1.0, d: 1.27 })
    expect(config.car.aspect_ratio.bed).toEqual({ w: 1.0, d: 2.18 })
    expect(config.car.aspect_ratio.freight).toEqual({ w: 1.0, d: 1.0 })
    expect(config.car.height_mm.passenger).toBe(2300)
    expect(config.car.height_mm.bed).toBe(2400)
    expect(config.door.default_width_mm.accessible).toBe(900)
  })

  test('formula params round-trip through nested structure', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {})
    expect(config.height.overhead.refuge_mm).toBe(2000)
    expect(config.height.overhead.bounce_coef).toBe(0.035)
    expect(config.height.pit.refuge_mm).toBe(1000)
    expect(config.height.pit.speed_bonus_150mpm_mm).toBe(500)
  })
})

describe('buildEffectiveConfig — baseline violations', () => {
  test('number override below baseline_min throws BaselineViolationError', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'clearance.side_mm': '100' })
    ).toThrow(BaselineViolationError)
  })

  test('number override above baseline_max throws', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'clearance.side_mm': '500' })
    ).toThrow(BaselineViolationError)
  })

  test('number override is not a valid number throws', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'clearance.side_mm': 'hello' })
    ).toThrow(BaselineViolationError)
  })

  test('enum override with invalid choice throws', () => {
    const rules = makeCompleteRuleSet()
    expect(() =>
      buildEffectiveConfig(rules, { 'cwt.position': 'moon_base' })
    ).toThrow(BaselineViolationError)
  })

  test('thrown error exposes rule key and reason', () => {
    const rules = makeCompleteRuleSet()
    try {
      buildEffectiveConfig(rules, { 'clearance.side_mm': '50' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BaselineViolationError)
      const e = err as BaselineViolationError
      expect(e.ruleKey).toBe('clearance.side_mm')
      expect(e.attemptedValue).toBe('50')
      expect(e.baseline.min).toBe(150)
      expect(e.baseline.max).toBe(400)
    }
  })
})

describe('buildEffectiveConfig — stale / missing keys', () => {
  test('unknown override key is silently ignored (stale client)', () => {
    const rules = makeCompleteRuleSet()
    const config = buildEffectiveConfig(rules, {
      'deleted.long.ago': '999',
      'clearance.side_mm': '220',
    })
    expect(config.clearance.side_mm).toBe(220)
  })

  test('missing required rule throws (seed drift)', () => {
    const rules = makeCompleteRuleSet().filter(r => r.key !== 'clearance.side_mm')
    expect(() => buildEffectiveConfig(rules, {})).toThrow(/Missing rule: clearance.side_mm/)
  })
})

describe('buildEffectiveConfig — team default already differs from original baseline', () => {
  test('team default within baseline, no override: team default used', () => {
    // Simulate a rule where admin changed clearance.side_mm from 200 (factory) to 230
    const rules = makeCompleteRuleSet()
    const modified = rules.map(r =>
      r.key === 'clearance.side_mm' ? { ...r, value: '230' } : r
    )
    const config = buildEffectiveConfig(modified, {})
    expect(config.clearance.side_mm).toBe(230)
  })

  test('case override wins over team default', () => {
    const rules = makeCompleteRuleSet()
    const modified = rules.map(r =>
      r.key === 'clearance.side_mm' ? { ...r, value: '230' } : r
    )
    const config = buildEffectiveConfig(modified, { 'clearance.side_mm': '280' })
    expect(config.clearance.side_mm).toBe(280)
  })
})

describe('BaselineViolationError class', () => {
  test('instanceof Error', () => {
    const e = new BaselineViolationError('test.key', '99', 'too low', { min: 100, max: 500 })
    expect(e).toBeInstanceOf(Error)
  })

  test('has name property', () => {
    const e = new BaselineViolationError('test.key', '99', 'too low', {})
    expect(e.name).toBe('BaselineViolationError')
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
bun test src/config/effective.test.ts
```

Expected: fails with `Cannot find module './effective'`.

- [ ] **Step 3: Create `src/config/effective.ts`**

Create the file with this content:

```typescript
/**
 * Three-layer rule merger.
 *
 * Merges team default rules (from D1) with per-case overrides (from client),
 * validates every final value against its baseline constraints, and assembles
 * a strongly-typed EffectiveConfig for downstream consumers.
 *
 * Fails fast on any baseline violation. Silently ignores unknown override keys
 * (client may have stale localStorage referring to rules that were deleted).
 */

import type { TeamRule, CaseOverride, EffectiveConfig, CwtPosition, Usage } from './types'

export class BaselineViolationError extends Error {
  constructor(
    public readonly ruleKey: string,
    public readonly attemptedValue: string,
    public readonly reason: string,
    public readonly baseline: { min?: number; max?: number; choices?: string[] },
  ) {
    super(`Baseline violation on ${ruleKey}: ${reason}`)
    this.name = 'BaselineViolationError'
  }
}

/**
 * Validate a candidate string value against a rule's baseline constraints.
 * Throws BaselineViolationError on failure.
 */
export function assertValueWithinBaseline(rule: TeamRule, value: string): void {
  if (rule.type === 'number') {
    const n = parseFloat(value)
    if (!Number.isFinite(n)) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `值 "${value}" 不是有效數字`,
        { min: rule.baseline_min ?? undefined, max: rule.baseline_max ?? undefined },
      )
    }
    if (rule.baseline_min !== null && n < rule.baseline_min) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `${n} 低於 baseline 下限 ${rule.baseline_min}${rule.unit || ''}`,
        { min: rule.baseline_min, max: rule.baseline_max ?? undefined },
      )
    }
    if (rule.baseline_max !== null && n > rule.baseline_max) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `${n} 超過 baseline 上限 ${rule.baseline_max}${rule.unit || ''}`,
        { min: rule.baseline_min ?? undefined, max: rule.baseline_max },
      )
    }
  } else if (rule.type === 'enum') {
    if (rule.baseline_choices && !rule.baseline_choices.includes(value)) {
      throw new BaselineViolationError(
        rule.key,
        value,
        `"${value}" 不在允許選項 [${rule.baseline_choices.join(', ')}] 內`,
        { choices: rule.baseline_choices },
      )
    }
  }
}

/**
 * Merge three layers (baseline ranges already on each rule, team defaults in
 * rule.value, case override from client) and return a typed EffectiveConfig.
 */
export function buildEffectiveConfig(
  teamRules: TeamRule[],
  caseOverride: CaseOverride,
): EffectiveConfig {
  // Step 1: map team rules by key for O(1) lookup.
  const byKey = new Map<string, TeamRule>()
  for (const rule of teamRules) byKey.set(rule.key, rule)

  // Step 2: compute final value for every rule (override wins), validate baseline.
  const finalValues = new Map<string, string>()
  for (const rule of teamRules) {
    const override = caseOverride[rule.key]
    const final = override !== undefined ? override : rule.value
    assertValueWithinBaseline(rule, final)
    finalValues.set(rule.key, final)
  }

  // Step 3: parse into structured EffectiveConfig.
  return parseIntoStructuredConfig(finalValues)
}

// ---- Structural assembly ----

function parseIntoStructuredConfig(values: Map<string, string>): EffectiveConfig {
  const num = (key: string): number => {
    const v = values.get(key)
    if (v === undefined) throw new Error(`Missing rule: ${key}`)
    return parseFloat(v)
  }
  const str = (key: string): string => {
    const v = values.get(key)
    if (v === undefined) throw new Error(`Missing rule: ${key}`)
    return v
  }

  const usages: Usage[] = ['passenger', 'accessible', 'bed', 'freight']

  const buildAspectRatio = () => {
    const out = {} as Record<Usage, { w: number; d: number }>
    for (const u of usages) {
      out[u] = {
        w: num(`car.aspect_ratio.${u}.w`),
        d: num(`car.aspect_ratio.${u}.d`),
      }
    }
    return out
  }

  const buildCarHeight = () => {
    const out = {} as Record<Usage, number>
    for (const u of usages) out[u] = num(`car.height_mm.${u}`)
    return out
  }

  const buildDoorWidth = () => {
    const out = {} as Record<Usage, number>
    for (const u of usages) out[u] = num(`door.default_width_mm.${u}`)
    return out
  }

  return {
    shaft: {
      min_width_mm: num('shaft.min_width_mm'),
      min_depth_mm: num('shaft.min_depth_mm'),
    },
    clearance: {
      side_mm: num('clearance.side_mm'),
      back_mm: num('clearance.back_mm'),
      front_mm: num('clearance.front_mm'),
    },
    car: {
      aspect_ratio: buildAspectRatio(),
      height_mm: buildCarHeight(),
    },
    cwt: {
      position: str('cwt.position') as CwtPosition,
      width_mm: num('cwt.width_mm'),
      thickness_mm: num('cwt.thickness_mm'),
      back_offset_mm: num('cwt.back_offset_mm'),
      left_offset_mm: num('cwt.left_offset_mm'),
    },
    rail: {
      car_size_mm: num('rail.car.size_mm'),
      car_gap_mm: num('rail.car.gap_mm'),
      cwt_size_mm: num('rail.cwt.size_mm'),
      cwt_gap_mm: num('rail.cwt.gap_mm'),
    },
    door: {
      frame_depth_mm: num('door.frame_depth_mm'),
      leaf_thickness_mm: num('door.leaf_thickness_mm'),
      sill_depth_mm: num('door.sill_depth_mm'),
      default_width_mm: buildDoorWidth(),
      center_opening_min_car_width_mm: num('door.type_switch.center_opening_min_car_width_mm'),
    },
    height: {
      floor_default_mm: num('height.floor_default_mm'),
      default_speed_mpm: num('height.default_speed_mpm'),
      overhead: {
        refuge_mm: num('height.overhead.refuge_mm'),
        machine_buffer_mm: num('height.overhead.machine_buffer_mm'),
        bounce_coef: num('height.overhead.bounce_coef'),
      },
      pit: {
        refuge_mm: num('height.pit.refuge_mm'),
        buffer_mm: num('height.pit.buffer_mm'),
        speed_bonus_90mpm_mm: num('height.pit.speed_bonus_90mpm_mm'),
        speed_bonus_150mpm_mm: num('height.pit.speed_bonus_150mpm_mm'),
      },
    },
    usage_constraints: {
      accessible_min_car_width_mm: num('usage.accessible.min_car_width_mm'),
      accessible_min_car_depth_mm: num('usage.accessible.min_car_depth_mm'),
      bed_min_car_depth_mm: num('usage.bed.min_car_depth_mm'),
    },
  }
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
bun test src/config/effective.test.ts
```

Expected: ~18 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/config/effective.ts src/config/effective.test.ts
git commit -S -m "feat(config): buildEffectiveConfig + BaselineViolationError with TDD"
```

---

## Task 4: Create `src/config/fixtures.ts` (derived from generator)

**Files:**
- Create: `src/config/fixtures.ts`
- Create: `src/config/fixtures.test.ts`

**Rationale:** Solver tests (Task 10) need an EffectiveConfig to inject. Instead of hand-writing it (which would drift from seeds), derive it from `buildBaselineRules()` via the real `buildEffectiveConfig` pipeline. Single source of truth.

- [ ] **Step 1: Write the test first**

Create `src/config/fixtures.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run, verify fails**

```bash
bun test src/config/fixtures.test.ts
```

Expected: fails with missing module.

- [ ] **Step 3: Create `src/config/fixtures.ts`**

```typescript
/**
 * Test fixture: default EffectiveConfig derived from seeds/generate-baseline.ts.
 *
 * This is NOT the runtime config path — production /api/solve reads from D1.
 * This is a test helper so solver + handler tests can inject a known config
 * without needing a real D1 connection.
 *
 * Since it routes through buildEffectiveConfig with the real generator output,
 * it automatically stays in sync with D1 seeds. If the generator adds/removes
 * rules, this fixture reflects it.
 */

import { buildBaselineRules, type RawRule } from '../../seeds/generate-baseline'
import { buildEffectiveConfig } from './effective'
import type { TeamRule, EffectiveConfig } from './types'

function rawToTeamRule(raw: RawRule): TeamRule {
  return {
    id: 0,
    key: raw.key,
    name: raw.name,
    description: raw.description,
    type: raw.type,
    value: raw.value,
    default_value: raw.default_value,
    unit: raw.unit,
    baseline_min: raw.baseline_min,
    baseline_max: raw.baseline_max,
    baseline_choices: raw.baseline_choices,
    category: raw.category,
    mandatory: raw.mandatory,
    source: raw.source,
  }
}

/** Build a fresh EffectiveConfig from the generator's baseline rules. */
export function defaultFixtureConfig(): EffectiveConfig {
  const raw = buildBaselineRules()
  const teamRules = raw.map(rawToTeamRule)
  return buildEffectiveConfig(teamRules, {})
}

/** Build a fixture config with a specific case override applied. */
export function fixtureConfigWithOverride(override: Record<string, string>): EffectiveConfig {
  const raw = buildBaselineRules()
  const teamRules = raw.map(rawToTeamRule)
  return buildEffectiveConfig(teamRules, override)
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
bun test src/config/fixtures.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/config/fixtures.ts src/config/fixtures.test.ts
git commit -S -m "feat(config): defaultFixtureConfig derived from baseline generator"
```

---

## Task 5: Create `src/config/load.ts` — D1 loader + static loader for Bun

**Files:**
- Create: `src/config/load.ts`

**Rationale:** Abstracts rules source behind a `RulesLoader` interface. Production Worker uses `D1RulesLoader`; local Bun dev uses `StaticRulesLoader` (calls generator directly, no DB needed).

- [ ] **Step 1: Create the file**

```typescript
/**
 * Rules loading layer.
 *
 * Two implementations:
 *   D1RulesLoader     — production Worker, reads from CF D1 binding
 *   StaticRulesLoader — local Bun dev, reads from seeds/generate-baseline.ts
 *                       directly (no DB). Case override still works for
 *                       testing. Rules are loaded once at module init.
 *
 * Both return TeamRule[] which buildEffectiveConfig consumes.
 */

import type { TeamRule } from './types'
import { buildBaselineRules, type RawRule } from '../../seeds/generate-baseline'

export interface RulesLoader {
  loadActiveRules(): Promise<TeamRule[]>
}

// ---- D1 loader (production Worker) ----

interface D1Database {
  prepare(query: string): {
    all<T = unknown>(): Promise<{ results: T[] }>
  }
}

interface RawRuleRow {
  id: number
  key: string
  name: string
  description: string | null
  type: string
  value: string
  default_value: string
  unit: string | null
  baseline_min: number | null
  baseline_max: number | null
  baseline_choices: string | null
  category: string
  mandatory: number
  source: string
}

export class D1RulesLoader implements RulesLoader {
  constructor(private readonly db: D1Database) {}

  async loadActiveRules(): Promise<TeamRule[]> {
    const result = await this.db
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE deleted_at IS NULL
         ORDER BY category, key`,
      )
      .all<RawRuleRow>()

    return result.results.map(parseRuleRow)
  }
}

function parseRuleRow(row: RawRuleRow): TeamRule {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.type === 'number' ? 'number' : 'enum',
    value: row.value,
    default_value: row.default_value,
    unit: row.unit,
    baseline_min: row.baseline_min,
    baseline_max: row.baseline_max,
    baseline_choices: row.baseline_choices ? JSON.parse(row.baseline_choices) : null,
    category: row.category,
    mandatory: row.mandatory === 1 ? 1 : 0,
    source: row.source as 'cns' | 'industry' | 'engineering',
  }
}

// ---- Static loader (local Bun dev, tests) ----

export class StaticRulesLoader implements RulesLoader {
  async loadActiveRules(): Promise<TeamRule[]> {
    return buildBaselineRules().map(rawToTeamRule)
  }
}

function rawToTeamRule(raw: RawRule): TeamRule {
  return {
    id: 0,
    key: raw.key,
    name: raw.name,
    description: raw.description,
    type: raw.type,
    value: raw.value,
    default_value: raw.default_value,
    unit: raw.unit,
    baseline_min: raw.baseline_min,
    baseline_max: raw.baseline_max,
    baseline_choices: raw.baseline_choices,
    category: raw.category,
    mandatory: raw.mandatory,
    source: raw.source,
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun -e "import { D1RulesLoader, StaticRulesLoader } from './src/config/load'; console.log('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add src/config/load.ts
git commit -S -m "feat(config): add D1RulesLoader + StaticRulesLoader"
```

---

## Task 6: Refactor `src/solver/clearances.ts` — remove module constants

**Files:**
- Modify: `src/solver/clearances.ts`

**Rationale:** Strip out all module-level `const DEFAULT_*` and the per-usage helpers. Keep the file as a thin module of pure functions that take values as parameters. Anything the solver needed via helper calls now comes from the EffectiveConfig it receives.

- [ ] **Step 1: Replace the entire file content**

Replace `src/solver/clearances.ts` with:

```typescript
/**
 * Clearance + formula helpers — pure math, no module-level constants.
 *
 * All numeric inputs come from EffectiveConfig now (via callers). This file
 * only contains the formula shapes (overhead = f(speed), pit = g(speed),
 * area → car dimensions given aspect ratio, etc.). The actual numbers live
 * in D1 rules and flow through buildEffectiveConfig.
 *
 * Prior to Milestone 1b this file held `DEFAULT_CLEARANCE`, `carAspectRatio`,
 * `defaultCarHeight`, etc. — all deleted in favor of reading from config.
 */

import type { Usage } from './types'
import type {
  EffectiveConfig,
  OverheadFormulaParams,
  PitFormulaParams,
} from '../config/types'

/** Car width clearance calculation: shaft_width - 2 * side_clearance = car_width. */
export function carWidthToShaftWidth(
  car_width_mm: number,
  config: EffectiveConfig,
): number {
  return car_width_mm + config.clearance.side_mm * 2
}

export function carDepthToShaftDepth(
  car_depth_mm: number,
  config: EffectiveConfig,
): number {
  return car_depth_mm + config.clearance.back_mm + config.clearance.front_mm
}

export function shaftWidthToMaxCarWidth(
  shaft_width_mm: number,
  config: EffectiveConfig,
): number {
  return shaft_width_mm - config.clearance.side_mm * 2
}

export function shaftDepthToMaxCarDepth(
  shaft_depth_mm: number,
  config: EffectiveConfig,
): number {
  return shaft_depth_mm - config.clearance.back_mm - config.clearance.front_mm
}

/**
 * Required overhead from speed — CNS 15827-20 §5.2.5.7.1 simplified form.
 * Formula: refuge + bounce_coef * v² * 1000 + machine_buffer
 * (v in m/s, result in mm, rounded up to 100 mm)
 */
export function minOverheadFromSpeed(
  speed_mpm: number,
  params: OverheadFormulaParams,
): number {
  const v_mps = speed_mpm / 60
  const bounce = params.bounce_coef * v_mps * v_mps * 1000
  const raw = params.refuge_mm + bounce + params.machine_buffer_mm
  return Math.ceil(raw / 100) * 100
}

/**
 * Required pit depth from speed — CNS 15827-20 §5.2.5.8.1 simplified form.
 */
export function minPitDepthFromSpeed(
  speed_mpm: number,
  params: PitFormulaParams,
): number {
  const speed_bonus =
    speed_mpm > 150
      ? params.speed_bonus_150mpm_mm
      : speed_mpm > 90
      ? params.speed_bonus_90mpm_mm
      : 0
  const raw = params.refuge_mm + params.buffer_mm + speed_bonus
  return Math.ceil(raw / 100) * 100
}

/**
 * Given car area and usage, recover (car_width_mm, car_depth_mm) using the
 * per-usage aspect ratio from config. Rounds to 50mm increments.
 */
export function areaToCarDimensions(
  area_m2: number,
  usage: Usage,
  config: EffectiveConfig,
): { car_width_mm: number; car_depth_mm: number } {
  const { w: w_ratio, d: d_ratio } = config.car.aspect_ratio[usage]
  // area = width * depth, width/depth = w_ratio/d_ratio
  // → depth = sqrt(area * d_ratio / w_ratio)
  const area_mm2 = area_m2 * 1_000_000
  const depth_mm = Math.sqrt((area_mm2 * d_ratio) / w_ratio)
  const width_mm = depth_mm * (w_ratio / d_ratio)
  return {
    car_width_mm: Math.round(width_mm / 50) * 50,
    car_depth_mm: Math.round(depth_mm / 50) * 50,
  }
}
```

- [ ] **Step 2: Verify no imports of removed symbols exist**

```bash
grep -rn "DEFAULT_CLEARANCE\|DEFAULT_FLOOR_HEIGHT_MM\|carAspectRatio\|defaultCarHeight\|defaultDoorWidth\|getClearance" src/ --include="*.ts"
```

Expected: zero matches in src/ after all tasks complete. At this point in Task 6, the matches in mode-a.ts, mode-b.ts are still present (refactored in Tasks 7-8).

- [ ] **Step 3: Commit**

```bash
git add src/solver/clearances.ts
git commit -S -m "refactor(solver): strip module constants from clearances.ts (config-driven)"
```

---

## Task 7: Refactor `src/solver/mode-a.ts` — accept EffectiveConfig

**Files:**
- Modify: `src/solver/mode-a.ts`

- [ ] **Step 1: Replace the file content**

```typescript
/**
 * Mode A Solver — 空間 → 電梯
 *
 * 1. Validate shaft size against config.shaft min dimensions
 * 2. Derive max car dims from shaft - clearance (from config)
 * 3. Query ISO 8100-1 Table 6 for matching load
 * 4. Compute required overhead/pit from speed + config formula params
 * 5. Validate user-provided overhead/pit are sufficient
 * 6. Assemble ElevatorDesign
 */

import { ISO_8100_TABLE_6 } from './table'
import {
  shaftWidthToMaxCarWidth,
  shaftDepthToMaxCarDepth,
  minOverheadFromSpeed,
  minPitDepthFromSpeed,
} from './clearances'
import { NonStandardError } from './types'
import type { ShaftSpec, ElevatorDesign } from './types'
import type { EffectiveConfig } from '../config/types'

export function solveModeA(
  input: ShaftSpec,
  config: EffectiveConfig,
): ElevatorDesign {
  // ---- Step 1: shaft size sanity ----
  if (input.width_mm < config.shaft.min_width_mm) {
    throw new NonStandardError(
      `坑道寬 ${input.width_mm} mm 小於實用最小值 ${config.shaft.min_width_mm} mm`,
      'shaft_too_narrow',
      `建議坑道寬至少 ${config.shaft.min_width_mm} mm`,
    )
  }
  if (input.depth_mm < config.shaft.min_depth_mm) {
    throw new NonStandardError(
      `坑道深 ${input.depth_mm} mm 小於實用最小值 ${config.shaft.min_depth_mm} mm`,
      'shaft_too_shallow',
      `建議坑道深至少 ${config.shaft.min_depth_mm} mm`,
    )
  }
  if (input.stops < 2) {
    throw new NonStandardError(
      `停站數 ${input.stops} 太少`,
      'too_few_stops',
      '電梯至少需要 2 個停靠層',
    )
  }

  // ---- Step 2: shaft → max car dims via config clearances ----
  const max_car_width = shaftWidthToMaxCarWidth(input.width_mm, config)
  const max_car_depth = shaftDepthToMaxCarDepth(input.depth_mm, config)

  if (max_car_width < 700 || max_car_depth < 700) {
    throw new NonStandardError(
      `扣除 clearance 後車廂可用空間 ${max_car_width}×${max_car_depth} mm 太小`,
      'car_too_small_after_clearance',
    )
  }

  // ---- Step 3: Round to 50mm, compute area ----
  const car_width_mm = Math.floor(max_car_width / 50) * 50
  const car_depth_mm = Math.floor(max_car_depth / 50) * 50
  const car_area_m2 = (car_width_mm * car_depth_mm) / 1_000_000

  // ---- Step 4: Table 6 lookup for load ----
  let chosen_load = 0
  for (const point of ISO_8100_TABLE_6) {
    if (point.max_car_area_m2 <= car_area_m2) {
      chosen_load = point.rated_load_kg
    } else {
      break
    }
  }

  if (chosen_load === 0) {
    throw new NonStandardError(
      `車廂面積 ${car_area_m2.toFixed(2)} m² 小於 Table 6 最小 0.37 m² (100 kg)`,
      'area_below_table_min',
    )
  }

  // ---- Step 5: Required overhead/pit from speed ----
  const preferred_speed_mpm = input.preferred_speed_mpm ?? config.height.default_speed_mpm
  const required_overhead = minOverheadFromSpeed(preferred_speed_mpm, config.height.overhead)
  const required_pit = minPitDepthFromSpeed(preferred_speed_mpm, config.height.pit)

  // ---- Step 6: Validate overhead/pit ----
  if (input.overhead_mm < required_overhead) {
    throw new NonStandardError(
      `頂部高度 ${input.overhead_mm} mm 不足 (以 ${preferred_speed_mpm} m/min 推算需要至少 ${required_overhead} mm)`,
      'insufficient_overhead',
      `增加頂部高度到 ${required_overhead} mm 或調低速度`,
    )
  }
  if (input.pit_depth_mm < required_pit) {
    throw new NonStandardError(
      `底坑深度 ${input.pit_depth_mm} mm 不足 (以 ${preferred_speed_mpm} m/min 推算需要至少 ${required_pit} mm)`,
      'insufficient_pit_depth',
      `增加底坑深度到 ${required_pit} mm 或調低速度`,
    )
  }

  // ---- Step 7: Assemble ElevatorDesign ----
  return {
    shaft: {
      width_mm: input.width_mm,
      depth_mm: input.depth_mm,
      total_height_mm: input.total_height_mm,
      overhead_mm: input.overhead_mm,
      pit_depth_mm: input.pit_depth_mm,
      stops: input.stops,
      usage: input.usage,
    },
    car: {
      width_mm: car_width_mm,
      depth_mm: car_depth_mm,
      height_mm: config.car.height_mm[input.usage],
      area_m2: Number(car_area_m2.toFixed(3)),
    },
    door: {
      width_mm: config.door.default_width_mm[input.usage],
      type:
        car_width_mm >= config.door.center_opening_min_car_width_mm
          ? 'center_opening'
          : 'side_opening',
    },
    rated_load_kg: chosen_load,
    rated_speed_mpm: preferred_speed_mpm,
    machine_location: 'MR',
    solver_mode: 'A',
    generated_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/solver/mode-a.ts
git commit -S -m "refactor(solver): solveModeA takes EffectiveConfig parameter"
```

---

## Task 8: Refactor `src/solver/mode-b.ts` — accept EffectiveConfig

**Files:**
- Modify: `src/solver/mode-b.ts`

- [ ] **Step 1: Replace file content**

```typescript
/**
 * Mode B Solver — 需求 → 空間
 */

import { maxAreaForLoad, ISO_8100_TABLE_6 } from './table'
import {
  carWidthToShaftWidth,
  carDepthToShaftDepth,
  areaToCarDimensions,
  minOverheadFromSpeed,
  minPitDepthFromSpeed,
} from './clearances'
import { NonStandardError } from './types'
import type { ElevatorRequirement, ElevatorDesign } from './types'
import type { EffectiveConfig } from '../config/types'

export function solveModeB(
  input: ElevatorRequirement,
  config: EffectiveConfig,
): ElevatorDesign {
  // ---- Step 1: input sanity ----
  if (input.rated_load_kg < 100) {
    throw new NonStandardError(
      `額定載重 ${input.rated_load_kg} kg 低於 ISO 8100-1 最小 100 kg`,
      'load_below_min',
    )
  }
  const maxTableLoad = ISO_8100_TABLE_6[ISO_8100_TABLE_6.length - 1].rated_load_kg
  if (input.rated_load_kg > maxTableLoad + 2000) {
    throw new NonStandardError(
      `額定載重 ${input.rated_load_kg} kg 超過標準表格 + 延伸範圍`,
      'load_above_max',
    )
  }
  if (input.stops < 2) {
    throw new NonStandardError(`停站數 ${input.stops} 太少`, 'too_few_stops')
  }

  // ---- Step 2: Table 6 → max allowed area ----
  const max_area_m2 = maxAreaForLoad(input.rated_load_kg)

  // ---- Step 3: Area → car dims via per-usage aspect ratio ----
  const { car_width_mm, car_depth_mm } = areaToCarDimensions(
    max_area_m2,
    input.usage,
    config,
  )

  // Accessible minimum (CNS 13627 → config.usage_constraints)
  if (input.usage === 'accessible') {
    if (
      car_width_mm < config.usage_constraints.accessible_min_car_width_mm ||
      car_depth_mm < config.usage_constraints.accessible_min_car_depth_mm
    ) {
      throw new NonStandardError(
        `載重 ${input.rated_load_kg} kg 推出的無障礙車廂 ${car_width_mm}×${car_depth_mm} mm ` +
          `小於 CNS 13627 最小 ${config.usage_constraints.accessible_min_car_width_mm}×${config.usage_constraints.accessible_min_car_depth_mm} mm`,
        'accessible_too_small',
        `提高載重到至少 675 kg (對應 1.75 m² ≈ 1100×1400)`,
      )
    }
  }

  // Bed elevator depth constraint
  if (
    input.usage === 'bed' &&
    car_depth_mm < config.usage_constraints.bed_min_car_depth_mm
  ) {
    throw new NonStandardError(
      `載重 ${input.rated_load_kg} kg 推出的病床車廂深 ${car_depth_mm} mm ` +
        `小於病床電梯最小 ${config.usage_constraints.bed_min_car_depth_mm} mm`,
      'bed_too_shallow',
      `提高載重到至少 1275 kg`,
    )
  }

  // ---- Step 4: Car → shaft via clearances ----
  const shaft_width_mm = carWidthToShaftWidth(car_width_mm, config)
  const shaft_depth_mm = carDepthToShaftDepth(car_depth_mm, config)

  // ---- Step 5: Overhead / pit ----
  const rated_speed_mpm = input.rated_speed_mpm ?? config.height.default_speed_mpm
  const overhead_mm = minOverheadFromSpeed(rated_speed_mpm, config.height.overhead)
  const pit_depth_mm = minPitDepthFromSpeed(rated_speed_mpm, config.height.pit)

  // ---- Step 6: Total height ----
  const floor_height_mm = input.floor_height_mm ?? config.height.floor_default_mm
  const total_height_mm = floor_height_mm * (input.stops - 1)

  // ---- Step 7: Assemble design ----
  const car_area_m2 = (car_width_mm * car_depth_mm) / 1_000_000

  return {
    shaft: {
      width_mm: shaft_width_mm,
      depth_mm: shaft_depth_mm,
      total_height_mm,
      overhead_mm,
      pit_depth_mm,
      stops: input.stops,
      usage: input.usage,
    },
    car: {
      width_mm: car_width_mm,
      depth_mm: car_depth_mm,
      height_mm: config.car.height_mm[input.usage],
      area_m2: Number(car_area_m2.toFixed(3)),
    },
    door: {
      width_mm: config.door.default_width_mm[input.usage],
      type:
        car_width_mm >= config.door.center_opening_min_car_width_mm
          ? 'center_opening'
          : 'side_opening',
    },
    rated_load_kg: input.rated_load_kg,
    rated_speed_mpm,
    machine_location: input.machine_location,
    solver_mode: 'B',
    generated_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/solver/mode-b.ts
git commit -S -m "refactor(solver): solveModeB takes EffectiveConfig parameter"
```

---

## Task 9: Refactor `src/dxf/plan.ts` — config-driven

**Files:**
- Modify: `src/dxf/plan.ts`

**Rationale:** This is the file the findings doc warned about. Remove all 10 module constants + the stealth `frontGap` and new `cwt.left_offset_mm` + `rail.cwt.gap_mm` from config.

- [ ] **Step 1: Replace file content**

Full replacement (reuses existing layer names, only changes data sources):

```typescript
/**
 * Plan view — drawn from EffectiveConfig (Milestone 1b+).
 *
 * All numeric values now come from config. No module-level geometry constants.
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'

export function drawPlanView(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  config: EffectiveConfig,
): { bbox: { minX: number; minY: number; maxX: number; maxY: number } } {
  const { shaft, car, door } = design
  const ox = origin.x
  const oy = origin.y

  const cwtCfg = config.cwt
  const railCfg = config.rail
  const doorCfg = config.door
  const frontGap = config.clearance.front_mm

  // ---- 1. Shaft outline ----
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, oy, ox + shaft.width_mm, oy + shaft.depth_mm)

  // ---- 2. Car position ----
  const carDx = Math.round((shaft.width_mm - car.width_mm) / 2)
  const carDy = shaft.depth_mm - car.depth_mm - frontGap
  const backGap = carDy

  dw.setActiveLayer('CAR')
  dw.drawRect(
    ox + carDx,
    oy + carDy,
    ox + carDx + car.width_mm,
    oy + carDy + car.depth_mm,
  )

  // ---- 3. CWT ----
  const cwtX0 = ox + cwtCfg.left_offset_mm
  const cwtY0 = oy + cwtCfg.back_offset_mm
  dw.setActiveLayer('CWT')
  dw.drawRect(
    cwtX0,
    cwtY0,
    cwtX0 + cwtCfg.width_mm,
    cwtY0 + cwtCfg.thickness_mm,
  )
  // CWT rails
  dw.setActiveLayer('RAIL_CWT')
  const cwtRailY = cwtY0 + cwtCfg.thickness_mm / 2 - railCfg.cwt_size_mm / 2
  dw.drawRect(
    cwtX0 - railCfg.cwt_size_mm - railCfg.cwt_gap_mm,
    cwtRailY,
    cwtX0 - railCfg.cwt_gap_mm,
    cwtRailY + railCfg.cwt_size_mm,
  )
  dw.drawRect(
    cwtX0 + cwtCfg.width_mm + railCfg.cwt_gap_mm,
    cwtRailY,
    cwtX0 + cwtCfg.width_mm + railCfg.cwt_gap_mm + railCfg.cwt_size_mm,
    cwtRailY + railCfg.cwt_size_mm,
  )

  // ---- 4. Car rails ----
  dw.setActiveLayer('RAIL_CAR')
  const carCenterY = carDy + car.depth_mm / 2
  const carRailHalf = railCfg.car_size_mm / 2
  const leftRailX1 = ox + carDx - railCfg.car_gap_mm - railCfg.car_size_mm
  dw.drawRect(
    leftRailX1,
    oy + carCenterY - carRailHalf,
    leftRailX1 + railCfg.car_size_mm,
    oy + carCenterY + carRailHalf,
  )
  const rightRailX1 = ox + carDx + car.width_mm + railCfg.car_gap_mm
  dw.drawRect(
    rightRailX1,
    oy + carCenterY - carRailHalf,
    rightRailX1 + railCfg.car_size_mm,
    oy + carCenterY + carRailHalf,
  )

  // ---- 5. Door + frame + sill ----
  dw.setActiveLayer('DOOR')
  const doorX0 = ox + (shaft.width_mm - door.width_mm) / 2
  const sillY = oy + shaft.depth_mm
  // Frame posts
  dw.drawRect(
    doorX0 - doorCfg.frame_depth_mm,
    sillY - doorCfg.sill_depth_mm,
    doorX0,
    sillY,
  )
  dw.drawRect(
    doorX0 + door.width_mm,
    sillY - doorCfg.sill_depth_mm,
    doorX0 + door.width_mm + doorCfg.frame_depth_mm,
    sillY,
  )
  // Sill line
  dw.drawLine(
    doorX0 - doorCfg.frame_depth_mm,
    sillY - doorCfg.sill_depth_mm,
    doorX0 + door.width_mm + doorCfg.frame_depth_mm,
    sillY - doorCfg.sill_depth_mm,
  )
  // Leaves
  if (door.type === 'center_opening') {
    const leafW = door.width_mm / 2
    dw.drawRect(
      doorX0,
      sillY - doorCfg.leaf_thickness_mm,
      doorX0 + leafW,
      sillY,
    )
    dw.drawRect(
      doorX0 + leafW,
      sillY - doorCfg.leaf_thickness_mm,
      doorX0 + door.width_mm,
      sillY,
    )
  } else {
    dw.drawRect(
      doorX0,
      sillY - doorCfg.leaf_thickness_mm,
      doorX0 + door.width_mm,
      sillY,
    )
  }

  // ---- 6. Center lines ----
  dw.setActiveLayer('CENTER')
  const cx = ox + shaft.width_mm / 2
  dw.drawLine(cx, oy - 200, cx, oy + shaft.depth_mm + 200)
  dw.drawLine(ox - 200, oy + carCenterY, ox + shaft.width_mm + 200, oy + carCenterY)

  // ---- 7. Dimensions ----
  dw.setActiveLayer('DIMS')
  const dimH = 120
  const dimOff = 350
  dw.drawText(ox + shaft.width_mm / 2, oy - dimOff, dimH, 0, `W ${shaft.width_mm}`, 'center')
  dw.drawText(ox - dimOff, oy + shaft.depth_mm / 2, dimH, 90, `D ${shaft.depth_mm}`, 'center')
  dw.drawText(
    ox + carDx + car.width_mm / 2,
    oy + carDy + car.depth_mm - 180,
    90,
    0,
    `AA=${car.width_mm}`,
    'center',
  )
  dw.drawText(
    ox + carDx + 180,
    oy + carDy + car.depth_mm / 2,
    90,
    90,
    `BB=${car.depth_mm}`,
    'center',
  )
  dw.drawText(
    ox + shaft.width_mm / 2,
    sillY + dimOff,
    110,
    0,
    `JJ=${door.width_mm}`,
    'center',
  )
  dw.drawText(ox - dimOff, oy + backGap / 2, 80, 90, `${backGap}`, 'center')
  dw.drawText(
    ox - dimOff,
    oy + carDy + car.depth_mm + frontGap / 2,
    80,
    90,
    `${frontGap}`,
    'center',
  )
  dw.drawText(ox + carDx / 2, oy - dimOff, 80, 0, `${carDx}`, 'center')
  dw.drawText(
    ox + carDx + car.width_mm + (shaft.width_mm - carDx - car.width_mm) / 2,
    oy - dimOff,
    80,
    0,
    `${shaft.width_mm - carDx - car.width_mm}`,
    'center',
  )

  // Component labels
  dw.setActiveLayer('TEXT')
  dw.drawText(
    cwtX0 + cwtCfg.width_mm / 2,
    cwtY0 + cwtCfg.thickness_mm / 2,
    70,
    0,
    'CWT',
    'center',
  )

  // Title
  dw.drawText(
    ox + shaft.width_mm / 2,
    oy - dimOff - 600,
    180,
    0,
    'PLAN VIEW / 平面圖',
    'center',
  )

  return {
    bbox: {
      minX: ox - dimOff - 300,
      minY: oy - dimOff - 900,
      maxX: ox + shaft.width_mm + dimOff + 300,
      maxY: oy + shaft.depth_mm + dimOff + 300,
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/dxf/plan.ts
git commit -S -m "refactor(dxf): plan.ts reads all geometry from EffectiveConfig"
```

---

## Task 10: Refactor `src/dxf/generate.ts` — pass config through

**Files:**
- Modify: `src/dxf/generate.ts`

- [ ] **Step 1: Update `generateElevatorDXF` signature**

Update the exported function signature and the internal drawElevationView helper. Key changes:

```typescript
// BEFORE
export function generateElevatorDXF(design: ElevatorDesign): string {
  // ...
  drawPlanView(dw, design, { x: 0, y: 0 })
  // ...
}

// AFTER
import type { EffectiveConfig } from '../config/types'

export function generateElevatorDXF(
  design: ElevatorDesign,
  config: EffectiveConfig,
): string {
  // ...
  drawPlanView(dw, design, { x: 0, y: 0 }, config)
  // ...
}
```

The `drawElevationView` internal helper does NOT need config — its BREAK_HEADROOM / BREAK_GAP / TOP_MARGIN are pure DXF aesthetic params that per §2.2 of the spec stay in code.

Edit `src/dxf/generate.ts`:
- Add `import type { EffectiveConfig } from '../config/types'` near the top with other imports
- Change `export function generateElevatorDXF(design: ElevatorDesign): string` to `export function generateElevatorDXF(design: ElevatorDesign, config: EffectiveConfig): string`
- Change the call `drawPlanView(dw, design, { x: 0, y: 0 })` to `drawPlanView(dw, design, { x: 0, y: 0 }, config)`
- Keep drawElevationView as-is (no config parameter)

- [ ] **Step 2: Commit**

```bash
git add src/dxf/generate.ts
git commit -S -m "refactor(dxf): generateElevatorDXF passes config to drawPlanView"
```

---

## Task 11: Refactor `src/solver/solver.test.ts` — inject fixture config

**Files:**
- Modify: `src/solver/solver.test.ts`

**Rationale:** All 18 existing tests currently call `solveModeA(input)` and `solveModeB(input)`. After Task 7/8, these functions now require a config parameter. Update every call site to pass `defaultFixtureConfig()`.

- [ ] **Step 1: Add import at top of file**

```typescript
import { defaultFixtureConfig } from '../config/fixtures'
```

- [ ] **Step 2: Update every `solveModeA(...)` call to `solveModeA(..., defaultFixtureConfig())`**

This is a mechanical find/replace. For example:
```typescript
// BEFORE
const design = solveModeA({
  width_mm: 2000,
  // ...
})

// AFTER
const design = solveModeA({
  width_mm: 2000,
  // ...
}, defaultFixtureConfig())
```

Same for `solveModeB`. Do NOT change any expected values — behavior must be identical.

- [ ] **Step 3: Update DXF round-trip tests to pass config to generateElevatorDXF**

Find `generateElevatorDXF(design)` calls and change to `generateElevatorDXF(design, defaultFixtureConfig())`.

- [ ] **Step 4: Run tests, verify all pass**

```bash
bun test src/solver/solver.test.ts
```

Expected: 18/18 pass. If any fail, the refactor broke behavior — investigate.

- [ ] **Step 5: Commit**

```bash
git add src/solver/solver.test.ts
git commit -S -m "test(solver): inject defaultFixtureConfig into existing 18 tests"
```

---

## Task 12: Rewrite `src/handlers/solve.ts` — async orchestrator

**Files:**
- Modify: `src/handlers/solve.ts`

- [ ] **Step 1: Replace entire file**

```typescript
/**
 * /api/solve handler — orchestrator.
 *
 * Flow:
 *   1. Load active rules from the provided RulesLoader (D1 or static)
 *   2. Build EffectiveConfig from rules + optional case override
 *   3. Solve Mode A or B with the config
 *   4. Generate DXF with the config
 *   5. Return design + dxf + analysis + stub validation report
 *
 * Throws NonStandardError or BaselineViolationError; caller converts to HTTP.
 */

import { solveModeA } from '../solver/mode-a'
import { solveModeB } from '../solver/mode-b'
import { NonStandardError } from '../solver/types'
import type { Usage, MachineLocation } from '../solver/types'
import { generateElevatorDXF } from '../dxf/generate'
import { analyzeGeneratedDxf } from './analyze-generated'
import {
  buildEffectiveConfig,
  BaselineViolationError,
} from '../config/effective'
import type { RulesLoader } from '../config/load'
import type { CaseOverride } from '../config/types'

export interface ValidationReportStub {
  summary: {
    guideline_pass: number
    guideline_warning: number
    cns_pass: number
    cns_warning: number
    total_fail: number
  }
  items: []
}

export interface SolveResponse {
  design: ReturnType<typeof solveModeA>
  dxf_string: string
  dxf_kb: number
  analysis: ReturnType<typeof analyzeGeneratedDxf>
  validation_report: ValidationReportStub
}

export async function handleSolve(
  body: any,
  loader: RulesLoader,
): Promise<SolveResponse> {
  // 1. Load rules
  const teamRules = await loader.loadActiveRules()

  // 2. Merge with case override
  const caseOverride: CaseOverride = body.caseOverride ?? {}
  const config = buildEffectiveConfig(teamRules, caseOverride)

  // 3. Solve
  const mode = String(body.mode || '').toUpperCase()
  let design: ReturnType<typeof solveModeA>
  if (mode === 'A') {
    design = solveModeA(
      {
        width_mm: Number(body.width_mm),
        depth_mm: Number(body.depth_mm),
        total_height_mm: Number(body.total_height_mm),
        overhead_mm: Number(body.overhead_mm),
        pit_depth_mm: Number(body.pit_depth_mm),
        stops: Number(body.stops),
        usage: (body.usage || 'passenger') as Usage,
        preferred_speed_mpm: body.preferred_speed_mpm
          ? Number(body.preferred_speed_mpm)
          : undefined,
      },
      config,
    )
  } else if (mode === 'B') {
    design = solveModeB(
      {
        rated_load_kg: Number(body.rated_load_kg),
        stops: Number(body.stops),
        usage: (body.usage || 'passenger') as Usage,
        machine_location: (body.machine_location || 'MR') as MachineLocation,
        rated_speed_mpm: body.rated_speed_mpm ? Number(body.rated_speed_mpm) : undefined,
        floor_height_mm: body.floor_height_mm ? Number(body.floor_height_mm) : undefined,
      },
      config,
    )
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }

  // 4. Generate DXF
  const dxfString = generateElevatorDXF(design, config)
  const analysis = analyzeGeneratedDxf(
    dxfString,
    `solver-${mode.toLowerCase()}`,
    '(in-memory)',
  )

  // 5. Stub validation report (real logic in 1c)
  const validation_report: ValidationReportStub = {
    summary: {
      guideline_pass: 0,
      guideline_warning: 0,
      cns_pass: 0,
      cns_warning: 0,
      total_fail: 0,
    },
    items: [],
  }

  return {
    design,
    dxf_string: dxfString,
    dxf_kb: Number((dxfString.length / 1024).toFixed(1)),
    analysis,
    validation_report,
  }
}

// Re-export for worker to catch
export { BaselineViolationError, NonStandardError }
```

- [ ] **Step 2: Commit**

```bash
git add src/handlers/solve.ts
git commit -S -m "refactor(handlers): handleSolve becomes async orchestrator with RulesLoader"
```

---

## Task 13: Update `src/worker/index.ts` and `src/demo/server.ts`

**Files:**
- Modify: `src/worker/index.ts`
- Modify: `src/demo/server.ts`

- [ ] **Step 1: Update `src/worker/index.ts`**

In the handler block for `/api/solve`:

```typescript
// BEFORE
if (url.pathname === '/api/solve' && request.method === 'POST') {
  try {
    const body = await request.json()
    const result = handleSolve(body)
    return jsonResponse(result)
  } catch (err) {
    // ...existing error handling
  }
}

// AFTER
if (url.pathname === '/api/solve' && request.method === 'POST') {
  try {
    const body = await request.json()
    const loader = new D1RulesLoader(env.DB)
    const result = await handleSolve(body, loader)
    return jsonResponse(result)
  } catch (err) {
    if (err instanceof BaselineViolationError) {
      return jsonResponse(
        {
          error: 'baseline_violation',
          message: err.message,
          rule_key: err.ruleKey,
          attempted_value: err.attemptedValue,
          baseline: err.baseline,
        },
        { status: 400 }
      )
    }
    if (err instanceof NonStandardError) {
      return jsonResponse(
        {
          error: 'non_standard',
          message: err.message,
          reason: err.reason,
          suggestion: err.suggestion,
        },
        { status: 400 }
      )
    }
    return jsonResponse(
      { error: 'solve_failed', message: String(err) },
      { status: 500 }
    )
  }
}
```

Also add imports at the top:
```typescript
import { handleSolve, BaselineViolationError, NonStandardError } from '../handlers/solve'
import { D1RulesLoader } from '../config/load'
```

Also update the `Env` interface:
```typescript
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  DB: D1Database
}
```

Where `D1Database` is inlined or imported. You can declare:
```typescript
interface D1Database {
  prepare(query: string): {
    all<T = unknown>(): Promise<{ results: T[] }>
  }
}
```

- [ ] **Step 2: Update `src/demo/server.ts` to use StaticRulesLoader**

```typescript
// Add import
import { handleSolve, BaselineViolationError } from '../handlers/solve'
import { StaticRulesLoader } from '../config/load'

// ... existing code ...

// Update /api/solve handler
if (url.pathname === '/api/solve' && req.method === 'POST') {
  try {
    const body = await req.json()
    const loader = new StaticRulesLoader()
    const result = await handleSolve(body, loader)
    return Response.json(result)
  } catch (err) {
    if (err instanceof BaselineViolationError) {
      return Response.json(
        {
          error: 'baseline_violation',
          message: err.message,
          rule_key: err.ruleKey,
          attempted_value: err.attemptedValue,
          baseline: err.baseline,
        },
        { status: 400 }
      )
    }
    if (err instanceof NonStandardError) {
      return Response.json(
        { error: 'non_standard', message: err.message, reason: err.reason, suggestion: err.suggestion },
        { status: 400 }
      )
    }
    return Response.json({ error: 'solve_failed', message: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify local Bun server still starts**

```bash
pkill -f "bun src/demo/server" 2>/dev/null; sleep 1
bun src/demo/server.ts > /tmp/1b-server.log 2>&1 &
disown
sleep 2
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"mode":"B","rated_load_kg":500,"stops":6,"usage":"passenger","machine_location":"MR","caseOverride":{}}' \
  http://localhost:3000/api/solve | python3 -c "import json, sys; d = json.load(sys.stdin); print(d['design']['shaft'])"
pkill -f "bun src/demo/server" 2>/dev/null
```

Expected output (unchanged from 1a):
```
{'width_mm': 1650, 'depth_mm': 1500, 'total_height_mm': 15000, 'overhead_mm': 4100, 'pit_depth_mm': 1500, 'stops': 6, 'usage': 'passenger'}
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts src/demo/server.ts
git commit -S -m "refactor(worker): wire RulesLoader + BaselineViolation handling to /api/solve"
```

---

## Task 14: Snapshot + integration tests

**Files:**
- Create: `src/handlers/solve-snapshot.test.ts`
- Create: `src/handlers/solve-geometry.test.ts`

- [ ] **Step 1: Create snapshot test**

```typescript
/**
 * Byte-identical regression test for /api/solve Mode B 500kg passenger.
 * Uses StaticRulesLoader (no D1) and strips the generated_at timestamp
 * from the design before comparison (timestamp varies per call).
 */

import { describe, test, expect } from 'bun:test'
import { handleSolve } from './solve'
import { StaticRulesLoader } from '../config/load'

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

    // DXF should be ~11-12 KB (timestamp causes small variance)
    expect(result.dxf_kb).toBeGreaterThan(10)
    expect(result.dxf_kb).toBeLessThan(13)
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
    )

    expect(result.dxf_string).toContain('SHAFT')
    expect(result.dxf_string).toContain('CAR')
    expect(result.dxf_string).toContain('CWT')
    expect(result.dxf_string).toContain('RAIL_CAR')
    expect(result.dxf_string).toContain('RAIL_CWT')
    expect(result.dxf_string).toContain('DOOR')
    expect(result.dxf_string).toContain('PLAN VIEW')
    expect(result.dxf_string).toContain('ELEVATION VIEW')
  })

  test('validation_report returns stub shape', async () => {
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

    expect(result.validation_report.summary.total_fail).toBe(0)
    expect(result.validation_report.items).toEqual([])
  })
})
```

- [ ] **Step 2: Create geometry drift integration test**

```typescript
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
```

- [ ] **Step 3: Run new tests**

```bash
bun test src/handlers/solve-snapshot.test.ts src/handlers/solve-geometry.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/solve-snapshot.test.ts src/handlers/solve-geometry.test.ts
git commit -S -m "test(handlers): add snapshot + geometry-drift integration tests"
```

---

## Task 15: Full test suite + coverage check

**Files:** none modified. Verification only.

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all existing + new tests pass. Approximate count:
- 18 solver tests (refactored)
- 25 generator tests (+2 for new rules)
- 18 buildEffectiveConfig unit tests
- 4 fixture tests
- 3 snapshot tests
- 4 geometry drift tests
= ~72 tests total

- [ ] **Step 2: Run with coverage**

```bash
bun test --coverage 2>&1 | tail -30
```

Expected: coverage summary shows ≥90% line coverage on all files in `src/`.

If any file is below 90%, add targeted tests before proceeding. Specifically check:
- `src/config/effective.ts`
- `src/config/load.ts` (may need a test specifically for parseRuleRow path)
- `src/solver/clearances.ts`
- `src/handlers/solve.ts`

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck 2>&1 | tail -20
```

Expected: completes without errors on the new files. Pre-existing errors in files not modified may still exist (those are tolerated by CI's `continue-on-error`).

---

## Task 16: Deploy to production

**Files:** none modified. Deployment only.

- [ ] **Step 1: Deploy Worker with new code**

```bash
wrangler deploy 2>&1 | tail -20
```

Expected: successful deploy, bindings listed include both ASSETS and DB.

- [ ] **Step 2: Smoke test production with empty case override (byte-identical design)**

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"mode":"B","rated_load_kg":500,"stops":6,"usage":"passenger","machine_location":"MR","caseOverride":{}}' \
  https://elevator-configurator.redarch.dev/api/solve | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('shaft:', d['design']['shaft'])
print('car:', d['design']['car'])
print('door:', d['design']['door'])
print('validation_report.summary:', d['validation_report']['summary'])
"
```

Expected:
```
shaft: {'width_mm': 1650, 'depth_mm': 1500, 'total_height_mm': 15000, 'overhead_mm': 4100, 'pit_depth_mm': 1500, 'stops': 6, 'usage': 'passenger'}
car: {'width_mm': 1250, 'depth_mm': 1100, 'height_mm': 2300, 'area_m2': 1.375}
door: {'width_mm': 800, 'type': 'side_opening'}
validation_report.summary: {'guideline_pass': 0, 'guideline_warning': 0, 'cns_pass': 0, 'cns_warning': 0, 'total_fail': 0}
```

- [ ] **Step 3: Smoke test case override in production**

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"mode":"B","rated_load_kg":500,"stops":6,"usage":"passenger","machine_location":"MR","caseOverride":{"clearance.front_mm":"200"}}' \
  https://elevator-configurator.redarch.dev/api/solve | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('shaft depth:', d['design']['shaft']['depth_mm'], '(expected 1550 = 1500 + 50)')
"
```

Expected: `shaft depth: 1550`

- [ ] **Step 4: Smoke test baseline violation in production**

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"mode":"B","rated_load_kg":500,"stops":6,"usage":"passenger","machine_location":"MR","caseOverride":{"clearance.side_mm":"50"}}' \
  -w "\nhttp=%{http_code}\n" \
  https://elevator-configurator.redarch.dev/api/solve
```

Expected: HTTP 400 with JSON body containing `"error": "baseline_violation"` and `"rule_key": "clearance.side_mm"`.

- [ ] **Step 5: Smoke test frontend still loads**

```bash
curl -s -o /dev/null -w "%{http_code}" https://elevator-configurator.redarch.dev/
```

Expected: `200`.

---

## Task 17: PR + merge + pull main

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/milestone-1b-solver-refactor
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat(m1b): solver refactor — consumes D1 via EffectiveConfig" --body "$(cat <<'EOF'
## Summary

Milestone 1b of the design guidance system feature. Refactors the solver layer to read design constants from D1 (via EffectiveConfig) instead of module-level constants.

## Changes

- New `src/config/` namespace: types, effective (merger + BaselineViolationError), load (D1 + static loaders), fixtures (tests)
- Added 2 new baseline rules discovered during plan.ts audit: `cwt.left_offset_mm` (250) + `rail.cwt.gap_mm` (20). Total: 46 rules
- Refactored `src/solver/clearances.ts` to strip module constants; helpers take config parameter
- Refactored `solveModeA`, `solveModeB` to accept EffectiveConfig
- Refactored `src/dxf/plan.ts` — all 13 hardcoded values (including the stealthy `frontGap = 150` and the 250 CWT offset) now read from config
- `src/dxf/generate.ts` passes config through to drawPlanView
- Rewrote `src/handlers/solve.ts` as async orchestrator using RulesLoader
- `src/worker/index.ts` uses D1RulesLoader with proper error handling for BaselineViolationError (400) and NonStandardError (400)
- `src/demo/server.ts` uses StaticRulesLoader (no D1 needed for local Bun dev)
- Refactored existing 18 solver tests to inject defaultFixtureConfig
- Added ~18 buildEffectiveConfig unit tests
- Added snapshot test for Mode B 500kg passenger regression
- Added integration tests for solver + DXF geometry consistency under case override

## Test plan

- [x] \`bun test\` all pass (~72 tests)
- [x] \`bun test --coverage\` ≥90% on src/
- [x] Production \`/api/solve\` with empty caseOverride returns byte-identical design
- [x] Production \`/api/solve\` with case override alters output correctly (clearance.front_mm 150 → 200 → shaft depth +50)
- [x] Production \`/api/solve\` with baseline violation returns 400
- [x] Production \`/\` returns 200

## Follow-up

Milestone 1c will add rules CRUD API + validation panel + rules tab UI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for auto-merge**

Poll status every ~30 seconds:
```bash
gh pr view <N> --json state,statusCheckRollup --jq '{state, checks: [.statusCheckRollup[]? | {name, status, conclusion}]}'
```

Until `state = "MERGED"`.

- [ ] **Step 4: Pull main + clean branch**

```bash
git checkout main
git fetch origin
git pull --rebase origin main
git branch -d feat/milestone-1b-solver-refactor
git log --oneline -3
```

- [ ] **Step 5: Final production verification**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://elevator-configurator.redarch.dev/
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"mode":"B","rated_load_kg":500,"stops":6,"usage":"passenger","machine_location":"MR"}' \
  https://elevator-configurator.redarch.dev/api/solve | python3 -c "import json, sys; d = json.load(sys.stdin); print(d['design']['shaft'])"
```

Expected: `200` and byte-identical shaft output.

---

## Milestone 1b Done

At this point:
- 46 rules in both local and prod D1
- Solver + DXF layers all config-driven (no hidden magic numbers)
- Worker code reads rules from D1 per request
- Case override supported end-to-end
- Baseline violation enforced at 3 layers (LLM stub + write-time + request-time)
- ~72 tests pass, ≥90% coverage on src/
- Feature branch merged, main pulled

**Next:** Milestone 1c — Rules tab + validation panel + CRUD API. Write the plan via `writing-plans`, then execute via `subagent-driven-development`.
