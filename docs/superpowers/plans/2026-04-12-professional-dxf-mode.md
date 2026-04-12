# Professional DXF Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click toggle to upgrade DXF output from draft (11 layers) to professional shop drawing (18 layers), adding 13 elevator engineering components.

**Architecture:** Add `detail_level` parameter to `/api/solve`. Refactor existing DXF code into draft/professional modules. Professional mode draws 13 new components (car sling, buffers, safety gear, multi-floor landings, etc.) across 7 new DXF layers. Frontend adds a metallic toggle with shimmer animation.

**Tech Stack:** Bun, TypeScript, dxf-writer, Cloudflare Workers, D1

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/dxf/layers.ts` | All 18 layer definitions (name, ACI color, linestyle) |
| Create | `src/dxf/primitives.ts` | Shared drawing helpers (drawRect, drawLabel, drawCircle, drawDashedLine) |
| Create | `src/dxf/plan-draft.ts` | Existing plan view logic (extracted from plan.ts) |
| Create | `src/dxf/plan-professional.ts` | 6 new plan view components |
| Create | `src/dxf/elevation-draft.ts` | Existing elevation view logic (extracted from generate.ts) |
| Create | `src/dxf/elevation-professional.ts` | 7 new elevation view components |
| Create | `src/dxf/spec-block.ts` | Spec text block (extracted from generate.ts) |
| Create | `src/dxf/professional.test.ts` | Tests for all professional drawing functions |
| Modify | `src/dxf/generate.ts` | Slim orchestrator: create Drawing, dispatch to draft or professional |
| Modify | `src/dxf/plan.ts` | Keep computeCwtPlacement + re-export from plan-draft |
| Modify | `src/dxf/plan.test.ts` | Add regression tests for draft output |
| Modify | `src/config/types.ts` | Add ProfessionalConfig to EffectiveConfig |
| Modify | `src/config/effective.ts` | Parse pro.* rules into ProfessionalConfig |
| Modify | `src/handlers/solve.ts` | Accept detail_level, pass to DXF generator |
| Modify | `src/worker/index.ts` | No change needed (solve handler already forwards body) |
| Modify | `src/demo/server.ts` | No change needed (solve handler already forwards body) |
| Modify | `seeds/generate-baseline.ts` | Add 16 professional rules |
| Modify | `public/index.html` | Toggle UI, tooltip, detail_level in POST |

---

### Pre-task: Create Feature Branch

- [ ] **Step 1: Create branch from latest main**

```bash
cd /Users/chiwenchen/Documents/repos/cns-elevator-configurator
git checkout main
git pull --rebase
git checkout -b feat/professional-dxf-mode
```

- [ ] **Step 2: Verify clean state**

```bash
bun test
```

Expected: 222 tests pass, coverage ≥ 98%.

---

### Task 1: Extract DXF Layer Definitions

**Files:**
- Create: `src/dxf/layers.ts`
- Modify: `src/dxf/generate.ts`

- [ ] **Step 1: Create layers.ts with all 18 layer definitions**

```typescript
// src/dxf/layers.ts

/**
 * DXF layer definitions — all 18 layers (11 existing + 7 new professional).
 * ACI = AutoCAD Color Index.
 */

export interface LayerDef {
  name: string
  aci: number
  lineStyle?: 'DASHED'
}

/** Draft layers — always included. */
export const DRAFT_LAYERS: LayerDef[] = [
  { name: 'SHAFT', aci: 7 },
  { name: 'WALL', aci: 8 },
  { name: 'CAR', aci: 1 },
  { name: 'CWT', aci: 3 },
  { name: 'RAIL_CAR', aci: 5 },
  { name: 'RAIL_CWT', aci: 4 },
  { name: 'DOOR', aci: 6 },
  { name: 'CENTER', aci: 1, lineStyle: 'DASHED' },
  { name: 'DIMS', aci: 2 },
  { name: 'TEXT', aci: 7 },
  { name: 'STOP', aci: 3 },
]

/** Professional layers — added when detail_level = 'professional'. */
export const PROFESSIONAL_LAYERS: LayerDef[] = [
  { name: 'SLING', aci: 14 },
  { name: 'BUFFER', aci: 34 },
  { name: 'SAFETY', aci: 174 },
  { name: 'ROPE', aci: 214 },
  { name: 'MACHINE', aci: 32 },
  { name: 'LANDING', aci: 154 },
]

/** Register layers on a dxf-writer Drawing instance. */
export function registerLayers(dw: any, layers: LayerDef[]): void {
  for (const l of layers) {
    if (l.lineStyle) {
      dw.addLineType(l.lineStyle, '_ _ ', [5, -5])
      dw.addLayer(l.name, l.aci, l.lineStyle)
    } else {
      dw.addLayer(l.name, l.aci, 'CONTINUOUS')
    }
  }
}
```

- [ ] **Step 2: Update generate.ts to use layers.ts**

Replace the inline layer registration in `src/dxf/generate.ts` (lines 6–40) with:

```typescript
// src/dxf/generate.ts — top of file
// @ts-ignore dxf-writer has no types
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'
import { drawPlanView } from './plan'
import { DRAFT_LAYERS, registerLayers } from './layers'

export function generateElevatorDXF(
  design: ElevatorDesign,
  config: EffectiveConfig,
): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')
  registerLayers(dw, DRAFT_LAYERS)
```

Keep the rest of the function body unchanged (plan view call, elevation view call, spec block, return).

- [ ] **Step 3: Run tests to verify zero regression**

```bash
bun test
```

Expected: 222 tests pass. No behavior change.

- [ ] **Step 4: Commit**

```bash
git add src/dxf/layers.ts src/dxf/generate.ts
git commit -m "refactor(dxf): extract layer definitions to layers.ts"
```

---

### Task 2: Extract Shared Drawing Primitives

**Files:**
- Create: `src/dxf/primitives.ts`

- [ ] **Step 1: Create primitives.ts with shared helpers**

```typescript
// src/dxf/primitives.ts

/**
 * Shared drawing helper functions for DXF generation.
 * Wraps dxf-writer calls with semantic naming.
 */

/** Draw a rectangle on the given layer. */
export function drawRect(
  dw: any,
  layer: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  dw.setActiveLayer(layer)
  dw.drawRect(x, y, x + w, y + h)
}

/** Draw a line on the given layer. */
export function drawLine(
  dw: any,
  layer: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  dw.setActiveLayer(layer)
  dw.drawLine(x1, y1, x2, y2)
}

/** Draw a circle on the given layer. */
export function drawCircle(
  dw: any,
  layer: string,
  cx: number,
  cy: number,
  radius: number,
): void {
  dw.setActiveLayer(layer)
  dw.drawCircle(cx, cy, radius)
}

/** Draw centered text on the given layer. */
export function drawText(
  dw: any,
  layer: string,
  x: number,
  y: number,
  height: number,
  text: string,
): void {
  dw.setActiveLayer(layer)
  dw.drawText(x, y, height, 0, text)
}

/** Draw a small triangle (for rail brackets in elevation view). */
export function drawTriangle(
  dw: any,
  layer: string,
  cx: number,
  cy: number,
  size: number,
  direction: 'left' | 'right',
): void {
  dw.setActiveLayer(layer)
  const half = size / 2
  const tipX = direction === 'right' ? cx + half : cx - half
  dw.drawLine(cx, cy - half, tipX, cy)
  dw.drawLine(tipX, cy, cx, cy + half)
  dw.drawLine(cx, cy + half, cx, cy - half)
}
```

- [ ] **Step 2: Run tests**

```bash
bun test
```

Expected: 222 tests pass. primitives.ts is pure utility — no existing code uses it yet.

- [ ] **Step 3: Commit**

```bash
git add src/dxf/primitives.ts
git commit -m "refactor(dxf): add shared drawing primitives"
```

---

### Task 3: Extract Elevation View and Spec Block

**Files:**
- Create: `src/dxf/elevation-draft.ts`
- Create: `src/dxf/spec-block.ts`
- Modify: `src/dxf/generate.ts`

- [ ] **Step 1: Create elevation-draft.ts**

Extract `drawElevationView` from `generate.ts` lines 91–167 into its own file:

```typescript
// src/dxf/elevation-draft.ts

import type { ElevatorDesign } from '../solver/types'

/**
 * Draw the draft elevation (side) view — simplified with zigzag break lines.
 * Origin = bottom-left of the elevation view area.
 */
export function drawElevationDraft(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
): void {
  // Copy the exact body of drawElevationView from generate.ts lines 96–167
  // (the entire function body including BREAK_HEADROOM, BREAK_GAP, TOP_MARGIN,
  // shaft outline, 1F line, zigzag break symbols, car rect, PIT text, title)
  // Replace all references to the original local variables with origin.x/origin.y aliases.
  const { shaft, car } = design
  const ox = origin.x
  const oy = origin.y

  const BREAK_HEADROOM = 600
  const BREAK_GAP = 1200
  const TOP_MARGIN = 300

  const firstStopY = oy + shaft.pit_depth_mm
  const carBottom = firstStopY
  const carTop = carBottom + car.height_mm
  const zigBot = carTop + BREAK_HEADROOM
  const zigTop = zigBot + BREAK_GAP
  const shaftBottom = oy
  const shaftTop = zigTop + TOP_MARGIN

  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, shaftBottom, ox + shaft.width_mm, shaftTop)
  dw.drawLine(ox, firstStopY, ox + shaft.width_mm, firstStopY)

  dw.setActiveLayer('STOP')
  const zigW = shaft.width_mm
  const segW = zigW / 6
  for (const baseY of [zigBot, zigTop]) {
    let px = ox
    let py = baseY
    for (let i = 0; i < 6; i++) {
      const ny = baseY + (i % 2 === 0 ? 60 : -60)
      dw.drawLine(px, py, px + segW, ny)
      px += segW
      py = ny
    }
  }

  dw.setActiveLayer('TEXT')
  dw.drawText(ox - 200, firstStopY - 60, 120, 0, '1F')

  const carW = shaft.width_mm * 0.5
  const carDx = ox + (shaft.width_mm - carW) / 2
  dw.setActiveLayer('CAR')
  dw.drawRect(carDx, carBottom, carDx + carW, carTop)

  dw.setActiveLayer('DIMS')
  const pitLabelX = ox + shaft.width_mm + 200
  dw.drawText(pitLabelX, oy + shaft.pit_depth_mm / 2 - 60, 100, 0, `PIT ${shaft.pit_depth_mm}`)

  dw.setActiveLayer('TEXT')
  const titleX = ox + shaft.width_mm / 2
  dw.drawText(titleX - 400, shaftBottom - 400, 180, 0, 'ELEVATION VIEW / 側面圖')
}
```

- [ ] **Step 2: Create spec-block.ts**

Extract the spec block from `generate.ts` lines 53–81:

```typescript
// src/dxf/spec-block.ts

import type { ElevatorDesign } from '../solver/types'

/**
 * Draw the specification text block to the right of the drawings.
 */
export function drawSpecBlock(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
): void {
  const { shaft, car, door, rated_load_kg, rated_speed_mpm, machine_location, solver_mode, generated_at } = design

  const specLines = [
    'CNS ELEVATOR DRAFT',
    '',
    `mode: ${solver_mode}`,
    `usage: ${shaft.usage}`,
    `load: ${rated_load_kg} kg`,
    `speed: ${rated_speed_mpm} m/min`,
    `stops: ${shaft.stops}`,
    `machine: ${machine_location}`,
    '',
    `shaft: ${shaft.width_mm} x ${shaft.depth_mm}`,
    `height: ${shaft.total_height_mm} mm`,
    `overhead: ${shaft.overhead_mm} mm`,
    `pit: ${shaft.pit_depth_mm} mm`,
    '',
    `car: ${car.width_mm} x ${car.depth_mm} x ${car.height_mm}`,
    `area: ${car.area_m2} m2`,
    `door: ${door.width_mm} mm (${door.type})`,
    '',
    `generated: ${generated_at}Z`,
    'status: DRAFT - engineer review required',
  ]

  dw.setActiveLayer('TEXT')
  const lineH = 220
  for (let i = 0; i < specLines.length; i++) {
    if (specLines[i]) {
      dw.drawText(origin.x, origin.y - i * lineH, 120, 0, specLines[i])
    }
  }
}
```

- [ ] **Step 3: Update generate.ts to use extracted modules**

```typescript
// src/dxf/generate.ts — complete rewrite (slim orchestrator)

// @ts-ignore dxf-writer has no types
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'
import { DRAFT_LAYERS, registerLayers } from './layers'
import { drawPlanView } from './plan'
import { drawElevationDraft } from './elevation-draft'
import { drawSpecBlock } from './spec-block'

export function generateElevatorDXF(
  design: ElevatorDesign,
  config: EffectiveConfig,
): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')
  registerLayers(dw, DRAFT_LAYERS)

  // Plan view at origin
  drawPlanView(dw, design, { x: 0, y: 0 }, config)

  // Elevation view offset to the right
  const elevOX = design.shaft.width_mm + 4000
  const elevOY = 0
  drawElevationDraft(dw, design, { x: elevOX, y: elevOY })

  // Spec block further right
  const specX = elevOX + design.shaft.width_mm + 3500
  const specY = design.shaft.depth_mm + 500
  drawSpecBlock(dw, design, { x: specX, y: specY })

  return dw.toDxfString()
}
```

- [ ] **Step 4: Run tests**

```bash
bun test
```

Expected: 222 tests pass. Zero behavior change — same DXF output.

- [ ] **Step 5: Commit**

```bash
git add src/dxf/elevation-draft.ts src/dxf/spec-block.ts src/dxf/generate.ts
git commit -m "refactor(dxf): extract elevation view and spec block into separate files"
```

---

### Task 4: Add 16 Professional Rules to DB Seed

**Files:**
- Modify: `seeds/generate-baseline.ts`

- [ ] **Step 1: Add professional rules to buildBaselineRules()**

In `seeds/generate-baseline.ts`, add a new `professional` category section at the end of the `buildBaselineRules()` function (before the final `return`):

```typescript
    // ── professional detail parameters ──────────────────────
    num('pro.sling_offset_mm', '車架外擴距離', 75, {
      min: 50, max: 120, category: 'professional', mandatory: 0, source: 'engineering',
      description: '車廂框架（sling）比車廂外擴的距離',
    }),
    num('pro.sling_thickness_mm', '車架鋼材寬度', 12, {
      min: 4, max: 20, category: 'professional', mandatory: 0, source: 'engineering',
      description: '車架結構鋼材的繪圖寬度',
    }),
    num('pro.guide_shoe_width_mm', '導靴寬度', 100, {
      min: 60, max: 150, category: 'professional', mandatory: 0, source: 'engineering',
      description: '導靴在平面圖中的寬度（示意）',
    }),
    num('pro.guide_shoe_depth_mm', '導靴深度', 60, {
      min: 30, max: 100, category: 'professional', mandatory: 0, source: 'engineering',
      description: '導靴在平面圖中的深度（示意）',
    }),
    num('pro.wall_thickness_mm', '井道壁厚', 200, {
      min: 120, max: 300, category: 'professional', mandatory: 0, source: 'engineering',
      description: '鋼筋混凝土井道壁厚',
    }),
    enumRule('pro.buffer_type', '緩衝器類型', 'auto', ['auto', 'spring', 'oil'], {
      category: 'professional', mandatory: 0, source: 'engineering',
      description: 'auto = 依速度自動選型（≤60mpm 彈簧，>60 油壓）',
    }),
    num('pro.buffer_width_mm', '緩衝器寬度', 200, {
      min: 100, max: 400, category: 'professional', mandatory: 0, source: 'engineering',
      description: '緩衝器在側面圖中的寬度',
    }),
    num('pro.buffer_height_spring_mm', '彈簧緩衝器高度', 300, {
      min: 150, max: 500, category: 'professional', mandatory: 0, source: 'engineering',
      description: '彈簧式緩衝器的高度',
    }),
    num('pro.buffer_height_oil_mm', '油壓緩衝器高度', 450, {
      min: 250, max: 800, category: 'professional', mandatory: 0, source: 'engineering',
      description: '油壓式緩衝器的高度',
    }),
    num('pro.machine_width_mm', '曳引機寬度', 600, {
      min: 300, max: 1000, category: 'professional', mandatory: 0, source: 'engineering',
      description: '曳引機在側面圖中的寬度（示意）',
    }),
    num('pro.machine_height_mm', '曳引機高度', 400, {
      min: 200, max: 700, category: 'professional', mandatory: 0, source: 'engineering',
      description: '曳引機在側面圖中的高度（示意）',
    }),
    num('pro.sheave_diameter_mm', '曳引輪直徑', 400, {
      min: 200, max: 600, category: 'professional', mandatory: 0, source: 'engineering',
      description: '曳引輪在側面圖中的直徑（示意）',
    }),
    num('pro.safety_gear_width_mm', '安全鉗寬度', 150, {
      min: 80, max: 250, category: 'professional', mandatory: 0, source: 'engineering',
      description: '安全鉗在側面圖中的寬度（示意）',
    }),
    num('pro.safety_gear_height_mm', '安全鉗高度', 80, {
      min: 40, max: 150, category: 'professional', mandatory: 0, source: 'engineering',
      description: '安全鉗在側面圖中的高度（示意）',
    }),
    num('pro.governor_diameter_mm', '調速器輪直徑', 300, {
      min: 150, max: 500, category: 'professional', mandatory: 0, source: 'engineering',
      description: '調速器輪在側面圖中的直徑（示意）',
    }),
    num('pro.rail_bracket_spacing_mm', '導軌支架間距', 2500, {
      min: 1500, max: 3500, category: 'professional', mandatory: 0, source: 'engineering',
      description: '導軌固定支架在側面圖中的垂直間距',
    }),
```

- [ ] **Step 2: Regenerate SQL and verify**

```bash
bun seeds/generate-baseline.ts > /tmp/baseline-check.sql
grep -c 'INSERT' /tmp/baseline-check.sql
```

Expected: Output should show the INSERT with 62 value tuples (46 existing + 16 new).

- [ ] **Step 3: Apply to local D1**

```bash
wrangler d1 execute elevator-configurator-db --local --command="DELETE FROM rules WHERE category='professional'"
bun seeds/generate-baseline.ts | wrangler d1 execute elevator-configurator-db --local --file=-
```

- [ ] **Step 4: Commit**

```bash
git add seeds/generate-baseline.ts
git commit -m "feat(rules): add 16 professional detail rules to baseline seed"
```

---

### Task 5: Extend EffectiveConfig with ProfessionalConfig

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/effective.ts`
- Test: `src/config/effective.test.ts` (existing, add cases)

- [ ] **Step 1: Add ProfessionalConfig type**

In `src/config/types.ts`, add before the `EffectiveConfig` interface:

```typescript
/** Buffer type for professional mode — auto selects by speed. */
export type BufferType = 'auto' | 'spring' | 'oil'

/** Professional detail parameters for shop drawing generation. */
export interface ProfessionalConfig {
  sling_offset_mm: number
  sling_thickness_mm: number
  guide_shoe_width_mm: number
  guide_shoe_depth_mm: number
  wall_thickness_mm: number
  buffer_type: BufferType
  buffer_width_mm: number
  buffer_height_spring_mm: number
  buffer_height_oil_mm: number
  machine_width_mm: number
  machine_height_mm: number
  sheave_diameter_mm: number
  safety_gear_width_mm: number
  safety_gear_height_mm: number
  governor_diameter_mm: number
  rail_bracket_spacing_mm: number
}
```

Add `professional` to `EffectiveConfig`:

```typescript
export interface EffectiveConfig {
  // ... existing fields unchanged ...
  usage_constraints: { ... }
  /** Professional detail params — only populated when detail_level = 'professional'. */
  professional?: ProfessionalConfig
}
```

- [ ] **Step 2: Parse pro.* rules in effective.ts**

In `src/config/effective.ts`, in the `parseIntoStructuredConfig` function, add after the `usage_constraints` block (before the closing `return`):

```typescript
    // Professional detail params — optional, only present if pro.* rules exist in the map
    const hasPro = values.has('pro.sling_offset_mm')
    professional: hasPro ? {
      sling_offset_mm: num('pro.sling_offset_mm'),
      sling_thickness_mm: num('pro.sling_thickness_mm'),
      guide_shoe_width_mm: num('pro.guide_shoe_width_mm'),
      guide_shoe_depth_mm: num('pro.guide_shoe_depth_mm'),
      wall_thickness_mm: num('pro.wall_thickness_mm'),
      buffer_type: str('pro.buffer_type') as BufferType,
      buffer_width_mm: num('pro.buffer_width_mm'),
      buffer_height_spring_mm: num('pro.buffer_height_spring_mm'),
      buffer_height_oil_mm: num('pro.buffer_height_oil_mm'),
      machine_width_mm: num('pro.machine_width_mm'),
      machine_height_mm: num('pro.machine_height_mm'),
      sheave_diameter_mm: num('pro.sheave_diameter_mm'),
      safety_gear_width_mm: num('pro.safety_gear_width_mm'),
      safety_gear_height_mm: num('pro.safety_gear_height_mm'),
      governor_diameter_mm: num('pro.governor_diameter_mm'),
      rail_bracket_spacing_mm: num('pro.rail_bracket_spacing_mm'),
    } : undefined,
```

Import `BufferType` at the top of effective.ts.

- [ ] **Step 3: Add test for professional config parsing**

In the existing effective test file, add a test that seeds pro.* rules and verifies `config.professional` is populated:

```typescript
test('parseIntoStructuredConfig includes professional config when pro.* rules present', () => {
  // Create a rules set that includes pro.* keys
  const proRules = [
    ...existingBaselineRules,
    { key: 'pro.sling_offset_mm', value: '75', type: 'number' },
    { key: 'pro.sling_thickness_mm', value: '12', type: 'number' },
    // ... all 16 pro.* rules with default values
  ]
  const config = buildEffectiveConfig(proRules, {})
  expect(config.professional).toBeDefined()
  expect(config.professional!.sling_offset_mm).toBe(75)
  expect(config.professional!.buffer_type).toBe('auto')
})

test('parseIntoStructuredConfig omits professional config when no pro.* rules', () => {
  const config = buildEffectiveConfig(existingBaselineRules, {})
  expect(config.professional).toBeUndefined()
})
```

- [ ] **Step 4: Run tests**

```bash
bun test
```

Expected: All tests pass including new ones.

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts src/config/effective.ts src/config/effective.test.ts
git commit -m "feat(config): extend EffectiveConfig with ProfessionalConfig for pro.* rules"
```

---

### Task 6: Wire detail_level Through API

**Files:**
- Modify: `src/handlers/solve.ts`
- Modify: `src/dxf/generate.ts`

- [ ] **Step 1: Add detail_level to parseSolveBody**

In `src/handlers/solve.ts`, add to `ValidatedSolveBody` interface:

```typescript
export interface ValidatedSolveBody {
  // ... existing fields ...
  detail_level: 'draft' | 'professional'
}
```

In `parseSolveBody`, add after the `caseOverride` extraction:

```typescript
  const VALID_DETAIL_LEVELS = ['draft', 'professional'] as const
  const rawDetail = (body as any).detail_level
  const detail_level: 'draft' | 'professional' =
    typeof rawDetail === 'string' && VALID_DETAIL_LEVELS.includes(rawDetail as any)
      ? (rawDetail as 'draft' | 'professional')
      : 'draft'
```

Include `detail_level` in the returned object.

- [ ] **Step 2: Pass detail_level to generateElevatorDXF**

In `handleSolve`, update the DXF generation call:

```typescript
  const dxf_string = generateElevatorDXF(design, config, validated.detail_level)
```

- [ ] **Step 3: Update generateElevatorDXF signature**

In `src/dxf/generate.ts`:

```typescript
import { DRAFT_LAYERS, PROFESSIONAL_LAYERS, registerLayers } from './layers'

export type DetailLevel = 'draft' | 'professional'

export function generateElevatorDXF(
  design: ElevatorDesign,
  config: EffectiveConfig,
  detailLevel: DetailLevel = 'draft',
): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')
  registerLayers(dw, DRAFT_LAYERS)
  if (detailLevel === 'professional') {
    registerLayers(dw, PROFESSIONAL_LAYERS)
  }

  // Plan view
  drawPlanView(dw, design, { x: 0, y: 0 }, config)

  // Elevation view
  const elevOX = design.shaft.width_mm + 4000
  if (detailLevel === 'professional') {
    // TODO: Task 8 will add drawElevationProfessional here
    drawElevationDraft(dw, design, { x: elevOX, y: 0 })
  } else {
    drawElevationDraft(dw, design, { x: elevOX, y: 0 })
  }

  // Spec block
  const specX = elevOX + design.shaft.width_mm + 3500
  const specY = design.shaft.depth_mm + 500
  drawSpecBlock(dw, design, { x: specX, y: specY })

  return dw.toDxfString()
}
```

- [ ] **Step 4: Add test for detail_level parsing**

In solve.test.ts, add:

```typescript
test('parseSolveBody defaults detail_level to draft', () => {
  const result = parseSolveBody({ mode: 'A', stops: 6, usage: 'passenger', width_mm: 2000, depth_mm: 2200, total_height_mm: 18000, overhead_mm: 4200, pit_depth_mm: 1600 })
  expect(result.detail_level).toBe('draft')
})

test('parseSolveBody accepts professional detail_level', () => {
  const result = parseSolveBody({ mode: 'A', stops: 6, usage: 'passenger', width_mm: 2000, depth_mm: 2200, total_height_mm: 18000, overhead_mm: 4200, pit_depth_mm: 1600, detail_level: 'professional' })
  expect(result.detail_level).toBe('professional')
})

test('parseSolveBody ignores invalid detail_level', () => {
  const result = parseSolveBody({ mode: 'A', stops: 6, usage: 'passenger', width_mm: 2000, depth_mm: 2200, total_height_mm: 18000, overhead_mm: 4200, pit_depth_mm: 1600, detail_level: 'ultra' })
  expect(result.detail_level).toBe('draft')
})
```

- [ ] **Step 5: Run tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/solve.ts src/dxf/generate.ts
git commit -m "feat(api): wire detail_level parameter through /api/solve to DXF generator"
```

---

### Task 7: Professional Plan View Components

**Files:**
- Create: `src/dxf/plan-professional.ts`
- Create: `src/dxf/professional.test.ts`
- Modify: `src/dxf/generate.ts`

- [ ] **Step 1: Write tests for plan professional components**

```typescript
// src/dxf/professional.test.ts

import { describe, test, expect } from 'bun:test'
import { drawPlanProfessional } from './plan-professional'

// Mock dxf-writer that records calls
function createMockDw() {
  const calls: Array<{ method: string; args: any[] }> = []
  return {
    calls,
    setActiveLayer(name: string) { calls.push({ method: 'setActiveLayer', args: [name] }) },
    drawRect(x1: number, y1: number, x2: number, y2: number) { calls.push({ method: 'drawRect', args: [x1, y1, x2, y2] }) },
    drawLine(x1: number, y1: number, x2: number, y2: number) { calls.push({ method: 'drawLine', args: [x1, y1, x2, y2] }) },
    drawCircle(cx: number, cy: number, r: number) { calls.push({ method: 'drawCircle', args: [cx, cy, r] }) },
    drawText(x: number, y: number, h: number, r: number, t: string) { calls.push({ method: 'drawText', args: [x, y, h, r, t] }) },
  }
}

const DESIGN = {
  shaft: { width_mm: 2000, depth_mm: 2200, total_height_mm: 18000, overhead_mm: 4200, pit_depth_mm: 1600, stops: 6, usage: 'passenger' as const },
  car: { width_mm: 1400, depth_mm: 1500, height_mm: 2400, area_m2: 2.1 },
  door: { width_mm: 900, type: 'center_opening' as const },
  rated_load_kg: 800,
  rated_speed_mpm: 60,
  machine_location: 'MRL' as const,
  solver_mode: 'A' as const,
  generated_at: '2026-04-12T00:00:00',
}

const CONFIG_PRO = {
  sling_offset_mm: 75,
  sling_thickness_mm: 12,
  guide_shoe_width_mm: 100,
  guide_shoe_depth_mm: 60,
  wall_thickness_mm: 200,
  buffer_type: 'auto' as const,
  buffer_width_mm: 200,
  buffer_height_spring_mm: 300,
  buffer_height_oil_mm: 450,
  machine_width_mm: 600,
  machine_height_mm: 400,
  sheave_diameter_mm: 400,
  safety_gear_width_mm: 150,
  safety_gear_height_mm: 80,
  governor_diameter_mm: 300,
  rail_bracket_spacing_mm: 2500,
}

describe('drawPlanProfessional', () => {
  test('draws car sling on SLING layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { clearance: { side_mm: 200, back_mm: 250, front_mm: 150 }, door: { frame_depth_mm: 80, sill_depth_mm: 30, leaf_thickness_mm: 40 } } as any)
    const slingCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'SLING')
    expect(slingCalls.length).toBeGreaterThan(0)
  })

  test('draws wall thickness on WALL layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { clearance: { side_mm: 200, back_mm: 250, front_mm: 150 }, door: { frame_depth_mm: 80, sill_depth_mm: 30, leaf_thickness_mm: 40 } } as any)
    const wallCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'WALL')
    expect(wallCalls.length).toBeGreaterThan(0)
  })

  test('draws landing door on LANDING layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { clearance: { side_mm: 200, back_mm: 250, front_mm: 150 }, door: { frame_depth_mm: 80, sill_depth_mm: 30, leaf_thickness_mm: 40 } } as any)
    const landingCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'LANDING')
    expect(landingCalls.length).toBeGreaterThan(0)
  })

  test('draws 4 guide shoes', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { clearance: { side_mm: 200, back_mm: 250, front_mm: 150 }, door: { frame_depth_mm: 80, sill_depth_mm: 30, leaf_thickness_mm: 40 }, rail: { car_size_mm: 90, car_gap_mm: 30, cwt_size_mm: 70, cwt_gap_mm: 20 } } as any)
    // Guide shoes are drawn as rects on SLING layer — count drawRect calls after SLING activation
    const slingRects = dw.calls.filter((c, i) => {
      if (c.method !== 'drawRect') return false
      // Find the last setActiveLayer before this call
      for (let j = i - 1; j >= 0; j--) {
        if (dw.calls[j].method === 'setActiveLayer') {
          return dw.calls[j].args[0] === 'SLING'
        }
      }
      return false
    })
    // 4 sling frame lines + 4 guide shoes = at least 4 rects
    expect(slingRects.length).toBeGreaterThanOrEqual(4)
  })

  test('draws rope position circles on ROPE layer', () => {
    const dw = createMockDw()
    drawPlanProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { clearance: { side_mm: 200, back_mm: 250, front_mm: 150 }, door: { frame_depth_mm: 80, sill_depth_mm: 30, leaf_thickness_mm: 40 }, rail: { car_size_mm: 90, car_gap_mm: 30, cwt_size_mm: 70, cwt_gap_mm: 20 } } as any)
    const ropeCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'ROPE')
    expect(ropeCalls.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/dxf/professional.test.ts
```

Expected: FAIL — `drawPlanProfessional` not found.

- [ ] **Step 3: Implement plan-professional.ts**

```typescript
// src/dxf/plan-professional.ts

import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, ProfessionalConfig } from '../config/types'

/**
 * Draw professional plan view components on top of the draft plan view.
 * Adds: car sling, guide shoes, landing door, wall thickness, rope marks, cable mark.
 */
export function drawPlanProfessional(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  pro: ProfessionalConfig,
  config: EffectiveConfig,
): void {
  const { shaft, car, door } = design
  const ox = origin.x
  const oy = origin.y
  const { side_mm, back_mm, front_mm } = config.clearance

  // Car position (same math as plan-draft)
  const carDx = ox + (shaft.width_mm - car.width_mm) / 2
  const carDy = oy + back_mm

  // ── 1. Wall thickness (WALL layer) ──
  const wt = pro.wall_thickness_mm
  dw.setActiveLayer('WALL')
  // Outer wall rectangle
  dw.drawRect(ox - wt, oy - wt, ox + shaft.width_mm + wt, oy + shaft.depth_mm + wt)

  // ── 2. Car sling / frame (SLING layer) ──
  const so = pro.sling_offset_mm
  const st = pro.sling_thickness_mm
  const slingX0 = carDx - so
  const slingY0 = carDy - so
  const slingX1 = carDx + car.width_mm + so
  const slingY1 = carDy + car.depth_mm + so

  dw.setActiveLayer('SLING')
  // Crosshead (top beam)
  dw.drawRect(slingX0, slingY1 - st, slingX1, slingY1)
  // Bolster (bottom beam)
  dw.drawRect(slingX0, slingY0, slingX1, slingY0 + st)
  // Left stile
  dw.drawRect(slingX0, slingY0, slingX0 + st, slingY1)
  // Right stile
  dw.drawRect(slingX1 - st, slingY0, slingX1, slingY1)

  // ── 3. Guide shoes ×4 (SLING layer) ──
  const gsW = pro.guide_shoe_width_mm
  const gsD = pro.guide_shoe_depth_mm
  const railX_left = carDx - config.rail.car_gap_mm - config.rail.car_size_mm
  const railX_right = carDx + car.width_mm + config.rail.car_gap_mm
  const railCX_left = railX_left + config.rail.car_size_mm / 2
  const railCX_right = railX_right + config.rail.car_size_mm / 2

  // Top-left guide shoe
  dw.drawRect(railCX_left - gsW / 2, slingY1 - gsD, railCX_left + gsW / 2, slingY1)
  // Top-right guide shoe
  dw.drawRect(railCX_right - gsW / 2, slingY1 - gsD, railCX_right + gsW / 2, slingY1)
  // Bottom-left guide shoe
  dw.drawRect(railCX_left - gsW / 2, slingY0, railCX_left + gsW / 2, slingY0 + gsD)
  // Bottom-right guide shoe
  dw.drawRect(railCX_right - gsW / 2, slingY0, railCX_right + gsW / 2, slingY0 + gsD)

  // ── 4. Landing door (LANDING layer) ──
  const doorW = door.width_mm
  const doorX0 = ox + (shaft.width_mm - doorW) / 2
  const doorFrameD = config.door.frame_depth_mm
  const doorSillD = config.door.sill_depth_mm
  // Landing door is on the outer side of the shaft wall (front wall = y = shaft.depth_mm)
  const landingDoorY = oy + shaft.depth_mm

  dw.setActiveLayer('LANDING')
  // Left frame post
  dw.drawRect(doorX0 - doorFrameD, landingDoorY, doorX0, landingDoorY + doorFrameD)
  // Right frame post
  dw.drawRect(doorX0 + doorW, landingDoorY, doorX0 + doorW + doorFrameD, landingDoorY + doorFrameD)
  // Sill line
  dw.drawLine(doorX0, landingDoorY + doorSillD, doorX0 + doorW, landingDoorY + doorSillD)
  // "LANDING DOOR" label
  dw.drawText(doorX0, landingDoorY + doorFrameD + 60, 60, 0, 'LANDING DOOR')

  // ── 5. Rope position marks (ROPE layer) ──
  const ropeCount = design.rated_load_kg <= 1000 ? 3 : 4
  const ropeSymbolR = 10
  const ropeSpacing = 40
  const ropeCenterX = carDx + car.width_mm / 2
  const ropeY = slingY1 + 30

  dw.setActiveLayer('ROPE')
  const ropeStartX = ropeCenterX - ((ropeCount - 1) * ropeSpacing) / 2
  for (let i = 0; i < ropeCount; i++) {
    dw.drawCircle(ropeStartX + i * ropeSpacing, ropeY, ropeSymbolR)
  }

  // ── 6. Traveling cable mark (ROPE layer) ──
  const tcX = slingX0 - 30
  const tcY = carDy + car.depth_mm / 2
  dw.drawCircle(tcX, tcY, 15)
  dw.drawText(tcX - 40, tcY - 40, 50, 0, 'TC')

  // ── SCHEMATIC labels for medium-confidence components ──
  dw.setActiveLayer('TEXT')
  dw.drawText(railCX_left - 30, slingY1 + 20, 40, 0, '示意')
  dw.drawText(tcX - 50, tcY + 30, 40, 0, '示意')
}
```

- [ ] **Step 4: Wire into generate.ts**

In `generate.ts`, import and call `drawPlanProfessional` after `drawPlanView` when `detailLevel === 'professional'`:

```typescript
import { drawPlanProfessional } from './plan-professional'

// Inside generateElevatorDXF, after drawPlanView:
if (detailLevel === 'professional' && config.professional) {
  drawPlanProfessional(dw, design, { x: 0, y: 0 }, config.professional, config)
}
```

- [ ] **Step 5: Run tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/dxf/plan-professional.ts src/dxf/professional.test.ts src/dxf/generate.ts
git commit -m "feat(dxf): add professional plan view components (sling, shoes, wall, landing door, ropes)"
```

---

### Task 8: Professional Elevation View Components

**Files:**
- Create: `src/dxf/elevation-professional.ts`
- Modify: `src/dxf/professional.test.ts`
- Modify: `src/dxf/generate.ts`

- [ ] **Step 1: Add elevation professional tests**

Append to `src/dxf/professional.test.ts`:

```typescript
import { drawElevationProfessional } from './elevation-professional'

describe('drawElevationProfessional', () => {
  test('draws multi-floor landing lines on LANDING layer', () => {
    const dw = createMockDw()
    drawElevationProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    const landingCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'LANDING')
    expect(landingCalls.length).toBeGreaterThan(0)
  })

  test('draws buffers on BUFFER layer', () => {
    const dw = createMockDw()
    drawElevationProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    const bufferCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'BUFFER')
    expect(bufferCalls.length).toBeGreaterThan(0)
  })

  test('draws machine on MACHINE layer', () => {
    const dw = createMockDw()
    drawElevationProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    const machineCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'MACHINE')
    expect(machineCalls.length).toBeGreaterThan(0)
  })

  test('draws safety gear + governor on SAFETY layer', () => {
    const dw = createMockDw()
    drawElevationProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    const safetyCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'SAFETY')
    expect(safetyCalls.length).toBeGreaterThan(0)
  })

  test('draws ropes on ROPE layer', () => {
    const dw = createMockDw()
    drawElevationProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    const ropeCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'ROPE')
    expect(ropeCalls.length).toBeGreaterThan(0)
  })

  test('selects spring buffer when speed <= 60 mpm', () => {
    const dw = createMockDw()
    const slowDesign = { ...DESIGN, rated_speed_mpm: 60 }
    drawElevationProfessional(dw, slowDesign, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    // Spring buffers have zigzag lines — look for drawLine calls after BUFFER layer
    const bufferLines = dw.calls.filter((c, i) => {
      if (c.method !== 'drawLine') return false
      for (let j = i - 1; j >= 0; j--) {
        if (dw.calls[j].method === 'setActiveLayer') return dw.calls[j].args[0] === 'BUFFER'
      }
      return false
    })
    expect(bufferLines.length).toBeGreaterThan(0)
  })

  test('draws rail brackets on WALL layer', () => {
    const dw = createMockDw()
    drawElevationProfessional(dw, DESIGN, { x: 0, y: 0 }, CONFIG_PRO, { height: { floor_default_mm: 3000, overhead: { refuge_mm: 600, machine_buffer_mm: 400, bounce_coef: 0.5 } } } as any)
    const wallCalls = dw.calls.filter(c => c.method === 'setActiveLayer' && c.args[0] === 'WALL')
    expect(wallCalls.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/dxf/professional.test.ts
```

Expected: FAIL — `drawElevationProfessional` not found.

- [ ] **Step 3: Implement elevation-professional.ts**

```typescript
// src/dxf/elevation-professional.ts

import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig, ProfessionalConfig, BufferType } from '../config/types'

/**
 * Resolve actual buffer type from config (auto → speed-based selection).
 */
function resolveBufferType(configType: BufferType, speed_mpm: number): 'spring' | 'oil' {
  if (configType === 'auto') {
    return speed_mpm <= 60 ? 'spring' : 'oil'
  }
  return configType
}

/**
 * Draw professional elevation (side) view — full multi-floor with all components.
 * Replaces the draft zigzag view entirely.
 */
export function drawElevationProfessional(
  dw: any,
  design: ElevatorDesign,
  origin: { x: number; y: number },
  pro: ProfessionalConfig,
  config: EffectiveConfig,
): void {
  const { shaft, car, rated_speed_mpm } = design
  const ox = origin.x
  const oy = origin.y

  const floorH = config.height.floor_default_mm
  const pitBottom = oy
  const firstFloorY = oy + shaft.pit_depth_mm
  const topFloorY = firstFloorY + floorH * (shaft.stops - 1)
  const shaftTop = topFloorY + shaft.overhead_mm
  const shaftW = shaft.width_mm

  // ── Shaft outline (full height, no zigzag) ──
  dw.setActiveLayer('SHAFT')
  dw.drawRect(ox, pitBottom, ox + shaftW, shaftTop)

  // ── 1. Multi-floor landing lines + door openings (LANDING layer) ──
  const doorH = 2100
  dw.setActiveLayer('LANDING')
  for (let i = 0; i < shaft.stops; i++) {
    const floorY = firstFloorY + i * floorH
    // Floor line
    dw.drawLine(ox, floorY, ox + shaftW, floorY)
    // Floor label
    dw.drawText(ox - 300, floorY - 60, 100, 0, `${i + 1}F`)
    // Door opening (left side gap)
    dw.drawLine(ox, floorY, ox, floorY + doorH)
    dw.drawLine(ox, floorY + doorH, ox + 100, floorY + doorH)
  }

  // ── Car at 1F ──
  const carW = shaftW * 0.5
  const carDx = ox + (shaftW - carW) / 2
  dw.setActiveLayer('CAR')
  dw.drawRect(carDx, firstFloorY, carDx + carW, firstFloorY + car.height_mm)

  // ── 2. Buffers (BUFFER layer) ──
  const bufferType = resolveBufferType(pro.buffer_type, rated_speed_mpm)
  const bufferH = bufferType === 'spring' ? pro.buffer_height_spring_mm : pro.buffer_height_oil_mm
  const bufferW = pro.buffer_width_mm

  dw.setActiveLayer('BUFFER')
  // Car buffer (centered under car)
  const carBufX = ox + shaftW / 2 - bufferW / 2
  dw.drawRect(carBufX, pitBottom, carBufX + bufferW, pitBottom + bufferH)

  if (bufferType === 'spring') {
    // Draw zigzag spring inside
    const segments = 6
    const segH = bufferH / segments
    for (let i = 0; i < segments; i++) {
      const y0 = pitBottom + i * segH
      const y1 = pitBottom + (i + 1) * segH
      const x0 = i % 2 === 0 ? carBufX + 20 : carBufX + bufferW - 20
      const x1 = i % 2 === 0 ? carBufX + bufferW - 20 : carBufX + 20
      dw.drawLine(x0, y0, x1, y1)
    }
  } else {
    dw.drawText(carBufX + 20, pitBottom + bufferH / 2 - 30, 60, 0, 'OIL')
  }

  // CWT buffer (right side of shaft)
  const cwtBufX = ox + shaftW * 0.75 - bufferW / 2
  dw.drawRect(cwtBufX, pitBottom, cwtBufX + bufferW, pitBottom + bufferH)

  // ── 3. MRL traction machine (MACHINE layer) ──
  const machY = shaftTop - pro.machine_height_mm - 100
  const machX = ox + shaftW - pro.machine_width_mm - 100

  dw.setActiveLayer('MACHINE')
  dw.drawRect(machX, machY, machX + pro.machine_width_mm, machY + pro.machine_height_mm)
  // Sheave circle
  const sheaveR = pro.sheave_diameter_mm / 2
  dw.drawCircle(machX + pro.machine_width_mm / 2, machY + pro.machine_height_mm / 2, sheaveR)
  dw.drawText(machX, machY - 80, 60, 0, 'MACHINE (示意)')

  // ── 4. Overhead breakdown (DIMS layer) ──
  const ohParams = config.height.overhead
  const v_mps = rated_speed_mpm / 60
  const bounceVal = Math.round(ohParams.bounce_coef * v_mps * v_mps * 1000)
  const refugeVal = ohParams.refuge_mm
  const machBufVal = ohParams.machine_buffer_mm
  const dimX = ox + shaftW + 300

  dw.setActiveLayer('DIMS')
  let segY = topFloorY + car.height_mm
  // Refuge
  dw.drawLine(dimX, segY, dimX + 200, segY)
  dw.drawText(dimX + 250, segY - 30, 80, 0, `避難 ${refugeVal}`)
  segY += refugeVal
  // Bounce
  dw.drawLine(dimX, segY, dimX + 200, segY)
  dw.drawText(dimX + 250, segY - 30, 80, 0, `彈跳 ${bounceVal}`)
  segY += bounceVal
  // Machine buffer
  dw.drawLine(dimX, segY, dimX + 200, segY)
  dw.drawText(dimX + 250, segY - 30, 80, 0, `機器 ${machBufVal}`)

  // ── 5. Rail brackets (WALL layer) ──
  const bracketSpacing = pro.rail_bracket_spacing_mm
  const bracketSize = 80

  dw.setActiveLayer('WALL')
  for (let y = pitBottom + bracketSpacing; y < shaftTop; y += bracketSpacing) {
    // Left wall bracket (triangle pointing right)
    dw.drawLine(ox, y - bracketSize / 2, ox + bracketSize, y)
    dw.drawLine(ox + bracketSize, y, ox, y + bracketSize / 2)
    dw.drawLine(ox, y + bracketSize / 2, ox, y - bracketSize / 2)
    // Right wall bracket (triangle pointing left)
    dw.drawLine(ox + shaftW, y - bracketSize / 2, ox + shaftW - bracketSize, y)
    dw.drawLine(ox + shaftW - bracketSize, y, ox + shaftW, y + bracketSize / 2)
    dw.drawLine(ox + shaftW, y + bracketSize / 2, ox + shaftW, y - bracketSize / 2)
  }

  // ── 6. Safety gear + governor (SAFETY layer) ──
  const sgW = pro.safety_gear_width_mm
  const sgH = pro.safety_gear_height_mm
  const govR = pro.governor_diameter_mm / 2

  dw.setActiveLayer('SAFETY')
  // Safety gear blocks at car sling bottom (left + right)
  const sgY = firstFloorY - sgH
  dw.drawRect(carDx, sgY, carDx + sgW, sgY + sgH)
  dw.drawRect(carDx + carW - sgW, sgY, carDx + carW, sgY + sgH)
  // Governor wheel at top of shaft
  const govY = shaftTop - 200
  const govX = ox + 200
  dw.drawCircle(govX, govY, govR)
  dw.drawText(govX - 100, govY + govR + 40, 50, 0, 'GOV (示意)')
  // Governor rope (dashed vertical line)
  dw.drawLine(govX, govY - govR, govX, sgY + sgH)

  // ── 7. Suspension ropes + traveling cable (ROPE layer) ──
  dw.setActiveLayer('ROPE')
  // Suspension ropes: car top → sheave → CWT
  const ropeCarY = firstFloorY + car.height_mm
  const sheaveY = machY + pro.machine_height_mm / 2
  const sheaveX = machX + pro.machine_width_mm / 2
  const cwtTopY = topFloorY - 500 // approximate CWT position
  // Car side rope
  dw.drawLine(carDx + carW / 2 - 20, ropeCarY, sheaveX - 20, sheaveY)
  dw.drawLine(carDx + carW / 2 + 20, ropeCarY, sheaveX + 20, sheaveY)
  // CWT side rope
  dw.drawLine(sheaveX - 20, sheaveY, ox + shaftW * 0.75 - 20, cwtTopY)
  dw.drawLine(sheaveX + 20, sheaveY, ox + shaftW * 0.75 + 20, cwtTopY)

  // Traveling cable (approximate curve as polyline)
  const tcStartX = carDx - 50
  const tcStartY = firstFloorY
  const tcLowestY = pitBottom + bufferH + 200
  const tcWallX = ox + 100
  dw.drawLine(tcStartX, tcStartY, tcStartX, tcLowestY)
  dw.drawLine(tcStartX, tcLowestY, tcWallX, tcLowestY)
  dw.drawLine(tcWallX, tcLowestY, tcWallX, firstFloorY + floorH)
  dw.drawText(tcWallX + 30, tcLowestY + 30, 50, 0, 'TC (示意)')

  // ── PIT dimension ──
  dw.setActiveLayer('DIMS')
  dw.drawText(dimX, pitBottom + shaft.pit_depth_mm / 2 - 30, 100, 0, `PIT ${shaft.pit_depth_mm}`)

  // ── Title ──
  dw.setActiveLayer('TEXT')
  dw.drawText(ox + shaftW / 2 - 500, pitBottom - 400, 180, 0, 'ELEVATION VIEW / 側面圖 (PROFESSIONAL)')
}
```

- [ ] **Step 4: Wire into generate.ts**

Update the elevation dispatch in `generate.ts`:

```typescript
import { drawElevationProfessional } from './elevation-professional'

// Replace the elevation section:
if (detailLevel === 'professional' && config.professional) {
  drawElevationProfessional(dw, design, { x: elevOX, y: 0 }, config.professional, config)
} else {
  drawElevationDraft(dw, design, { x: elevOX, y: 0 })
}
```

- [ ] **Step 5: Run tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/dxf/elevation-professional.ts src/dxf/professional.test.ts src/dxf/generate.ts
git commit -m "feat(dxf): add professional elevation view (landings, buffers, machine, safety, ropes)"
```

---

### Task 9: Frontend Toggle UI

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add CSS for metallic toggle**

In the `<style>` section of `index.html`, add:

```css
/* Professional mode toggle */
.pro-toggle-wrap {
  display: inline-flex; align-items: center; gap: 8px;
}
.pro-toggle-track {
  width: 36px; height: 20px;
  border-radius: 10px; position: relative;
  overflow: hidden; cursor: pointer;
  transition: all 0.3s ease;
  background: linear-gradient(135deg, #2a2f38 0%, #363c47 50%, #2a2f38 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.2);
}
.pro-toggle-track.on {
  background: linear-gradient(135deg, #3a4a5e 0%, #5a6a80 30%, #8090a8 50%, #5a6a80 70%, #3a4a5e 100%);
  box-shadow: 0 0 8px rgba(138,147,160,0.2),
    inset 0 1px 0 rgba(255,255,255,0.15),
    inset 0 -1px 0 rgba(0,0,0,0.2);
}
.pro-toggle-track.on::after {
  content: '';
  position: absolute; top: 0; left: -100%;
  width: 60%; height: 100%;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 40%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.25) 60%, transparent 100%);
  animation: pro-shimmer 3s ease-in-out infinite;
  border-radius: 10px;
}
@keyframes pro-shimmer {
  0% { left: -100%; }
  50% { left: 140%; }
  100% { left: 140%; }
}
.pro-toggle-knob {
  width: 16px; height: 16px; border-radius: 50%;
  position: absolute; top: 2px; left: 2px;
  background: linear-gradient(180deg, #bbb, #999);
  box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  transition: all 0.3s ease;
}
.pro-toggle-track.on .pro-toggle-knob {
  left: 18px;
  background: linear-gradient(180deg, #fff, #e8eaf0);
}
.pro-toggle-label { font-size: 12px; color: var(--fg-muted); }
.pro-toggle-track.on + .pro-toggle-label { color: var(--fg); }

/* Info tooltip */
.pro-info {
  position: relative; display: inline-flex; align-items: center;
  cursor: help; color: var(--fg-muted); font-size: 13px;
}
.pro-info .tooltip {
  display: none; position: absolute; bottom: 100%; left: 50%;
  transform: translateX(-50%); margin-bottom: 8px;
  background: var(--bg-panel); border: 1px solid var(--border-strong);
  border-radius: 6px; padding: 10px 14px;
  font-size: 11px; color: var(--fg-muted); line-height: 1.5;
  width: 280px; z-index: 100; white-space: normal;
}
.pro-info:hover .tooltip { display: block; }
```

- [ ] **Step 2: Add toggle HTML to both forms**

Above each form's button row (line ~959 for Mode A, ~1000 for Mode B), add:

```html
<div class="pro-toggle-wrap" style="margin-bottom: 10px;">
  <div class="pro-toggle-track" id="pro-toggle-a" onclick="toggleProfessional('a')">
    <div class="pro-toggle-knob"></div>
  </div>
  <span class="pro-toggle-label">專業施工圖</span>
  <span class="pro-info">ⓘ
    <span class="tooltip">專業施工圖模式：新增 13 個工程部件（車架、緩衝器、安全裝置、多樓層標記等），輸出 18 圖層 DXF，可在 AutoCAD 中逐層控制可見度。</span>
  </span>
</div>
```

(Repeat for Mode B with `id="pro-toggle-b"` and `toggleProfessional('b')`)

- [ ] **Step 3: Add JavaScript toggle logic**

```javascript
let professionalMode = { a: false, b: false }

function toggleProfessional(mode) {
  professionalMode[mode] = !professionalMode[mode]
  const track = document.getElementById('pro-toggle-' + mode)
  const btn = document.querySelector('#form-' + mode + ' .btn-primary')
  if (professionalMode[mode]) {
    track.classList.add('on')
    btn.textContent = '產生 DXF 施工圖'
  } else {
    track.classList.remove('on')
    btn.textContent = '產生 DXF 草稿'
  }
}
```

- [ ] **Step 4: Update submitSolve to include detail_level**

In the `submitSolve` function, update the fetch body:

```javascript
body: JSON.stringify({
  mode,
  ...payload,
  caseOverride: { ...caseOverrideState },
  detail_level: professionalMode[mode.toLowerCase()] ? 'professional' : 'draft',
}),
```

- [ ] **Step 5: Update downloadDxf filename**

In the `downloadDxf` function, include professional in the filename:

```javascript
const proTag = professionalMode[design.solver_mode.toLowerCase()] ? '-professional' : ''
const fname = `elevator-${design.solver_mode}-${usage}${proTag}-${load}kg-${dateStr}.dxf`
```

- [ ] **Step 6: Run tests + manual verification**

```bash
bun test
```

Start local server and verify toggle works:

```bash
bun run dev
# Open http://localhost:3000
# Toggle professional mode → button text changes
# Submit → verify DXF downloads with 'professional' in filename
```

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): add professional mode toggle with metallic shimmer animation"
```

---

### Task 10: Regression + Integration Tests

**Files:**
- Modify: `src/dxf/plan.test.ts`
- Modify: `src/handlers/solve.test.ts` (if exists)

- [ ] **Step 1: Add draft regression test**

In `plan.test.ts`, add:

```typescript
import { generateElevatorDXF } from './generate'

test('generateElevatorDXF draft mode does not include professional layers', () => {
  const design = { /* full ElevatorDesign test fixture */ }
  const config = { /* EffectiveConfig without professional */ }
  const dxf = generateElevatorDXF(design, config, 'draft')
  expect(dxf).toContain('SHAFT')
  expect(dxf).toContain('CAR')
  expect(dxf).not.toContain('SLING')
  expect(dxf).not.toContain('BUFFER')
  expect(dxf).not.toContain('SAFETY')
  expect(dxf).not.toContain('MACHINE')
})

test('generateElevatorDXF professional mode includes all 18 layers', () => {
  const design = { /* full ElevatorDesign test fixture */ }
  const config = { /* EffectiveConfig WITH professional */ }
  const dxf = generateElevatorDXF(design, config, 'professional')
  expect(dxf).toContain('SLING')
  expect(dxf).toContain('BUFFER')
  expect(dxf).toContain('SAFETY')
  expect(dxf).toContain('ROPE')
  expect(dxf).toContain('MACHINE')
  expect(dxf).toContain('LANDING')
})
```

- [ ] **Step 2: Run full test suite + coverage**

```bash
bun test --coverage
```

Expected: All tests pass. Coverage ≥ 90%.

- [ ] **Step 3: Commit**

```bash
git add src/dxf/plan.test.ts
git commit -m "test: add regression + integration tests for draft/professional DXF modes"
```

---

### Task 11: Apply Seed to Production D1 + Deploy

- [ ] **Step 1: Seed production D1**

```bash
bun seeds/generate-baseline.ts | wrangler d1 execute elevator-configurator-db --remote --file=-
```

- [ ] **Step 2: Deploy**

```bash
wrangler deploy
```

- [ ] **Step 3: Verify production**

Open https://elevator-configurator.redarch.dev, toggle professional mode, generate DXF, download and verify it contains professional layers.

- [ ] **Step 4: Final commit (if any changes)**

```bash
git add -A
git commit -m "chore: finalize professional DXF mode deployment"
```

---

## Self-Review Checklist

| Spec Section | Task |
|-------------|------|
| §4.1 API Change (detail_level) | Task 6 |
| §4.2 Layer Structure (18 layers) | Task 1 |
| §4.3 File Structure | Tasks 1-3 (refactor), 7-8 (new files) |
| §5.1 Plan components (6) | Task 7 |
| §5.2 Elevation components (7) | Task 8 |
| §5.3 SCHEMATIC labels | Tasks 7, 8 (inline in drawing code) |
| §6 New rules (16) | Task 4 |
| §7.1 Toggle design | Task 9 |
| §7.2 Toggle behavior | Task 9 |
| §7.3 Info tooltip | Task 9 |
| §7.4 No badge | Task 9 |
| §8 Testing | Tasks 5, 7, 8, 10 |
