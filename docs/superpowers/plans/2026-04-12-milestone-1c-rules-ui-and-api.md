# Milestone 1c: Rules Tab + Validation Panel + CRUD API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-visible UI for the design guidance system: rules management tab with full CRUD (list/edit/soft-delete/restore), validation panel per drawing showing rule status, case override accumulator with batch commit flow, backed by a real `/api/rules` HTTP API and real `buildValidationReport` logic.

**Architecture:** Backend adds `src/handlers/rules.ts` with 5 CRUD endpoints wired through Worker + Bun dev server. New `src/config/validation.ts` replaces the stub validation report with per-rule status logic. Frontend extends `public/index.html` with hash-routed two-view structure (`#/configurator` vs `#/rules`), a Rules Tab DOM module, a Validation Panel at configurator page bottom, and an in-memory case override accumulator. Local Bun dev gains an `InMemoryRulesStore` so CRUD works without needing wrangler dev.

**Tech Stack:** TypeScript, Cloudflare D1, bun:test, vanilla JS (no framework), dxf-writer (unchanged)

**Parent spec:** `docs/superpowers/specs/2026-04-12-guidance-system-design.md` §5 (API contracts + state machine) + §6 (UI layout) + §7 (error handling) + §8 Milestone 1c

**Workflow rule:** One PR on `feat/milestone-1c-rules-ui-and-api` branch. Sequential small-PR workflow. Do NOT start Milestone 1d until 1c PR is merged AND main is pulled AND stage-level review is clean.

---

## Scope Boundaries

### In scope
- Backend: 5 new rules CRUD endpoints (`GET /api/rules`, `GET /api/rules/deleted`, `PATCH /api/rules/:key`, `DELETE /api/rules/:key`, `POST /api/rules/:key/restore`, `POST /api/rules/commit`)
- Backend: `buildValidationReport` real logic (replaces stub in `src/handlers/solve.ts`)
- Backend: `RulesStore` interface + `D1RulesStore` (prod) + `InMemoryRulesStore` (local Bun dev) in `src/config/load.ts`
- Frontend: hash routing (`#/configurator` default, `#/rules`, `#/rules/deleted`)
- Frontend: Rules Tab UI (list grouped by category, source/status badges, filters, inline edit, soft-delete modal, deleted rules sub-view, restore)
- Frontend: Validation Panel at configurator page bottom (collapsed summary, expanded 3-section view with revert buttons)
- Frontend: in-memory case override state + `POST /api/solve` body includes `caseOverride`
- Frontend: 「收工存入團隊」 button triggering `POST /api/rules/commit`
- Tests: Layer 1 unit tests for `buildValidationReport`
- Tests: Layer 3 integration tests for rules CRUD handlers (using `InMemoryRulesStore`)
- Tests: updated snapshot test for new validation report shape
- Coverage: ≥90% on `src/**/*.ts` (user requirement)

### Out of scope (Milestone 1d)
- AI chat sidebar
- Claude API integration
- `POST /api/chat`
- Propose-action card
- Chat state machine

### Out of scope (deferred)
- Frontend JS unit tests via DOM shim (covered by `/qa` skill Playwright at the end)
- Approval workflow (`status: draft | approved` on rules)
- Real auth (CF Access)
- Audit UI (timeline view of rule changes)

---

## File Structure

**New files:**
- `src/config/validation.ts` — `buildValidationReport` real logic + types
- `src/config/validation.test.ts` — Layer 1 unit tests (~15 tests)
- `src/handlers/rules.ts` — CRUD handler functions (list/list-deleted/patch/delete/restore/commit)
- `src/handlers/rules.test.ts` — Layer 3 integration tests using `InMemoryRulesStore` (~20 tests)

**Modified files:**
- `src/config/load.ts` — Add `RulesStore` interface + `D1RulesStore` extending `D1RulesLoader` + `InMemoryRulesStore` with mutable state. `StaticRulesLoader` deprecated in favor of `InMemoryRulesStore`.
- `src/config/types.ts` — Add `AuditSource` union + `CommitResult` type + `ValidationReport` real type (move from handlers/solve.ts stub)
- `src/handlers/solve.ts` — Replace stub `validation_report` with call to `buildValidationReport`. Handler signature unchanged (still takes `RulesLoader`).
- `src/worker/index.ts` — Add routes for `/api/rules/*` dispatching to handlers/rules.ts; pass `D1RulesStore` to CRUD handlers
- `src/demo/server.ts` — Add same routes; use singleton `InMemoryRulesStore` (persists across requests within a Bun process)
- `public/index.html` — Add hash routing + Rules Tab view + Validation Panel + case override state + commit button. Existing configurator view wrapped in `#view-configurator`.
- `src/handlers/solve-snapshot.test.ts` — Update `validation_report.summary` expected shape (no longer all zeros when case override is empty — will have guideline_pass + cns_pass counts)

**Untouched files:**
- `src/solver/*.ts` — no changes (1b work complete)
- `src/dxf/*.ts` — no changes
- `migrations/*.sql` — no schema changes in 1c
- `seeds/*.ts` — no rule additions

---

## Definition of Done

- [ ] `GET /api/rules` returns 46 rules with metadata + categories array
- [ ] `GET /api/rules/deleted` returns empty array (no rules deleted yet)
- [ ] `PATCH /api/rules/:key` with valid value updates DB + writes audit row
- [ ] `PATCH /api/rules/:key` with invalid value returns 400 baseline_violation
- [ ] `PATCH /api/rules/:key` with unknown key returns 404
- [ ] `DELETE /api/rules/:key` on non-mandatory rule soft-deletes + writes audit
- [ ] `DELETE /api/rules/:key` on mandatory rule returns 403
- [ ] `POST /api/rules/:key/restore` clears deleted_at + writes audit
- [ ] `POST /api/rules/commit` partial-apply with skipped[] list for rules that can't be committed
- [ ] `/api/solve` response includes real `validation_report` (not stub) — shaped per spec §4.5
- [ ] Production URL shows Rules Tab at `#/rules` with 46 rules grouped by category
- [ ] Rules Tab filters work (category / source / status)
- [ ] Inline edit in Rules Tab PATCHes on blur with success/error feedback
- [ ] Mandatory rules have disabled delete button with tooltip
- [ ] Soft delete confirmation modal appears, deletion works, rule disappears from active list
- [ ] Deleted rules sub-view at `#/rules/deleted` lists soft-deleted rules with Restore button
- [ ] Validation Panel at configurator page bottom shows collapsed summary line
- [ ] Panel expands to 3 sections with revert buttons on case-overridden rules
- [ ] Case override applied via UI survives regeneration + updates panel warning count
- [ ] 「收工存入團隊」 button commits overrides, clears local state, rule values update
- [ ] Production smoke tests: GET /api/rules → 200 with 46 rules; PATCH valid → 200 + audit; PATCH invalid → 400; DELETE mandatory → 403; commit → applied + skipped
- [ ] `bun test` → all tests pass (expect ~150+, up from 119)
- [ ] `bun test --coverage` ≥90% line coverage on `src/`
- [ ] All commits GPG signed
- [ ] One PR merged via auto-approve + auto-merge
- [ ] Stage-level review dispatched after merge and findings addressed

---

## Pre-Task: Branch Setup

- [ ] **Step 1: Pre-flight check**

```bash
cd /Users/chiwenchen/Documents/repos/cns-elevator-configurator
git status
git checkout main
git fetch origin
git pull --rebase origin main
git log --oneline -3
```

Expected: On main, HEAD at `ffc5410` (latest after 1b stage review fix merge), working tree clean except for the uncommitted plan file at `docs/superpowers/plans/2026-04-12-milestone-1c-rules-ui-and-api.md`.

- [ ] **Step 2: Branch**

```bash
git checkout -b feat/milestone-1c-rules-ui-and-api
```

- [ ] **Step 3: Commit plan file first**

```bash
git add docs/superpowers/plans/2026-04-12-milestone-1c-rules-ui-and-api.md
git commit -S -m "docs(plans): add Milestone 1c rules UI + API implementation plan"
```

---

## Task 1: Real `buildValidationReport` logic

**Files:**
- Create: `src/config/validation.ts`
- Create: `src/config/validation.test.ts`
- Modify: `src/config/types.ts` (export `ValidationReport` + `ValidationItem` + `ValidationStatus`)

**Rationale:** Replace the stub in `handlers/solve.ts` with real per-rule status computation. Spec §4.5 defines: `warning` if rule is in case override AND value differs from team default; `pass` otherwise; `fail` is defensive (shouldn't reach UI since baseline violation throws earlier in `buildEffectiveConfig`). Summary splits pass/warning counts by source.

- [ ] **Step 1: Add validation types to `src/config/types.ts`**

Append these to the existing file:

```typescript
// ---- ValidationReport (Milestone 1c) ----

export type ValidationStatus = 'pass' | 'warning' | 'fail'

export interface ValidationItem {
  rule_key: string
  rule_name: string
  category: string
  source: 'cns' | 'industry' | 'engineering'
  mandatory: boolean
  final_value: string
  team_default_value: string
  factory_default_value: string
  baseline_description: string
  status: ValidationStatus
  status_reason: string
}

export interface ValidationReport {
  summary: {
    guideline_pass: number
    guideline_warning: number
    cns_pass: number
    cns_warning: number
    total_fail: number
  }
  items: ValidationItem[]
}
```

- [ ] **Step 2: Write the test file first (TDD)**

Create `src/config/validation.test.ts`:

```typescript
/**
 * Unit tests for buildValidationReport.
 *
 * Coverage:
 *   - All rules pass when no case override
 *   - Override that differs from team default → warning
 *   - Override that equals team default → pass (no-op)
 *   - Summary counts split by source (cns vs non-cns)
 *   - baseline_description rendering for number vs enum
 *   - status_reason strings are meaningful Chinese
 *   - Items are stable-ordered (category then key) for UI consistency
 */

import { describe, test, expect } from 'bun:test'
import { buildValidationReport } from './validation'
import type { TeamRule, CaseOverride } from './types'

function num(key: string, value: number, opts: {
  min?: number; max?: number; category?: string; mandatory?: 0 | 1; source?: 'cns' | 'industry' | 'engineering'
} = {}): TeamRule {
  return {
    id: 0, key, name: key, description: null,
    type: 'number', value: String(value), default_value: String(value),
    unit: 'mm',
    baseline_min: opts.min ?? null, baseline_max: opts.max ?? null,
    baseline_choices: null,
    category: opts.category ?? 'shaft',
    mandatory: opts.mandatory ?? 0,
    source: opts.source ?? 'engineering',
  }
}

function enumR(key: string, value: string, choices: string[], opts: { source?: 'cns' | 'industry' | 'engineering' } = {}): TeamRule {
  return {
    id: 0, key, name: key, description: null,
    type: 'enum', value, default_value: value, unit: null,
    baseline_min: null, baseline_max: null, baseline_choices: choices,
    category: 'cwt', mandatory: 0, source: opts.source ?? 'engineering',
  }
}

function makeRules(): TeamRule[] {
  return [
    num('shaft.min_width_mm', 1400, { category: 'shaft', source: 'engineering' }),
    num('clearance.side_mm', 200, { min: 150, max: 400, category: 'clearance', mandatory: 1 }),
    num('door.default_width_mm.accessible', 900, { min: 900, max: 1400, category: 'door', source: 'cns', mandatory: 1 }),
    num('height.overhead.refuge_mm', 2000, { min: 1800, max: 2500, category: 'height', source: 'cns', mandatory: 1 }),
    enumR('cwt.position', 'back_left', ['back_left', 'back_center', 'back_right', 'side_left', 'side_right']),
  ]
}

describe('buildValidationReport', () => {
  test('no case override → all items pass', () => {
    const report = buildValidationReport(makeRules(), {})
    expect(report.items).toHaveLength(5)
    for (const item of report.items) {
      expect(item.status).toBe('pass')
    }
  })

  test('summary counts split by source when all pass', () => {
    const report = buildValidationReport(makeRules(), {})
    // 2 cns rules (door.accessible, height.overhead.refuge), 3 non-cns (shaft, clearance, cwt)
    expect(report.summary.cns_pass).toBe(2)
    expect(report.summary.guideline_pass).toBe(3)
    expect(report.summary.cns_warning).toBe(0)
    expect(report.summary.guideline_warning).toBe(0)
    expect(report.summary.total_fail).toBe(0)
  })

  test('override differs from team default → warning on that rule only', () => {
    const override: CaseOverride = { 'clearance.side_mm': '250' }
    const report = buildValidationReport(makeRules(), override)

    const warnings = report.items.filter(i => i.status === 'warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].rule_key).toBe('clearance.side_mm')
    expect(warnings[0].final_value).toBe('250')
    expect(warnings[0].team_default_value).toBe('200')
  })

  test('override equal to team default → no warning (ignored)', () => {
    const override: CaseOverride = { 'clearance.side_mm': '200' }
    const report = buildValidationReport(makeRules(), override)
    const warnings = report.items.filter(i => i.status === 'warning')
    expect(warnings).toHaveLength(0)
  })

  test('override on cns source rule → cns_warning increments', () => {
    const override: CaseOverride = { 'door.default_width_mm.accessible': '1000' }
    const report = buildValidationReport(makeRules(), override)
    expect(report.summary.cns_warning).toBe(1)
    expect(report.summary.cns_pass).toBe(1) // height.overhead still pass
    expect(report.summary.guideline_warning).toBe(0)
  })

  test('items are sorted by category then key', () => {
    const report = buildValidationReport(makeRules(), {})
    const ordered = report.items.map(i => i.rule_key)
    // Categories: clearance, cwt, door, height, shaft alphabetically
    const categories = report.items.map(i => i.category)
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i] >= categories[i - 1]).toBe(true)
    }
  })

  test('baseline_description shows range for number type', () => {
    const report = buildValidationReport(makeRules(), {})
    const clearance = report.items.find(i => i.rule_key === 'clearance.side_mm')!
    expect(clearance.baseline_description).toContain('150')
    expect(clearance.baseline_description).toContain('400')
    expect(clearance.baseline_description).toContain('mm')
  })

  test('baseline_description shows choices for enum type', () => {
    const report = buildValidationReport(makeRules(), {})
    const cwt = report.items.find(i => i.rule_key === 'cwt.position')!
    expect(cwt.baseline_description).toContain('back_left')
    expect(cwt.baseline_description).toContain('back_center')
  })

  test('status_reason is in Chinese and meaningful', () => {
    const override: CaseOverride = { 'clearance.side_mm': '250' }
    const report = buildValidationReport(makeRules(), override)
    const warning = report.items.find(i => i.status === 'warning')!
    expect(warning.status_reason).toMatch(/案子微調|override|改/)
  })

  test('unknown case override key silently ignored', () => {
    const override: CaseOverride = { 'nonexistent.rule': '999' }
    const report = buildValidationReport(makeRules(), override)
    expect(report.items).toHaveLength(5)
    expect(report.summary.total_fail).toBe(0)
  })

  test('enum override differs from team default → warning', () => {
    const override: CaseOverride = { 'cwt.position': 'back_center' }
    const report = buildValidationReport(makeRules(), override)
    const w = report.items.find(i => i.rule_key === 'cwt.position')!
    expect(w.status).toBe('warning')
    expect(w.final_value).toBe('back_center')
    expect(w.team_default_value).toBe('back_left')
  })

  test('team rule where value differs from default_value still passes when no override', () => {
    // Admin changed team default from 200 → 230
    const rules = makeRules().map(r =>
      r.key === 'clearance.side_mm' ? { ...r, value: '230' } : r,
    )
    const report = buildValidationReport(rules, {})
    const clearance = report.items.find(i => i.rule_key === 'clearance.side_mm')!
    expect(clearance.status).toBe('pass')
    expect(clearance.final_value).toBe('230')
    expect(clearance.team_default_value).toBe('230')
    expect(clearance.factory_default_value).toBe('230')
  })

  test('rule_name comes from TeamRule.name', () => {
    const report = buildValidationReport(makeRules(), {})
    const item = report.items.find(i => i.rule_key === 'shaft.min_width_mm')!
    expect(item.rule_name).toBe('shaft.min_width_mm') // in fixture, name == key
  })
})
```

- [ ] **Step 3: Run, expect fail**

```bash
bun test src/config/validation.test.ts
```

Expected: fail with module not found.

- [ ] **Step 4: Create `src/config/validation.ts`**

```typescript
/**
 * Real validation report builder — replaces the stub in handlers/solve.ts.
 *
 * Spec §4.5: for each active rule, produce a ValidationItem with status:
 *   - 'warning' if case override has key AND final value differs from team default
 *   - 'pass' otherwise
 *   - 'fail' defensive only (baseline violations throw earlier in buildEffectiveConfig)
 *
 * Summary aggregates counts split by source (cns vs guideline = industry|engineering).
 */

import type {
  TeamRule,
  CaseOverride,
  ValidationReport,
  ValidationItem,
  ValidationStatus,
} from './types'

export function buildValidationReport(
  teamRules: TeamRule[],
  caseOverride: CaseOverride,
): ValidationReport {
  const items: ValidationItem[] = teamRules.map((rule) => {
    const overrideValue = caseOverride[rule.key]
    const overridden = overrideValue !== undefined && overrideValue !== rule.value
    const finalValue = overrideValue !== undefined ? overrideValue : rule.value

    let status: ValidationStatus
    let reason: string

    if (overridden) {
      status = 'warning'
      reason = `案子微調：${rule.value} → ${overrideValue}`
    } else {
      status = 'pass'
      reason =
        rule.value === rule.default_value
          ? '使用出廠預設值'
          : `使用團隊設定（出廠值 ${rule.default_value}）`
    }

    return {
      rule_key: rule.key,
      rule_name: rule.name,
      category: rule.category,
      source: rule.source,
      mandatory: rule.mandatory === 1,
      final_value: finalValue,
      team_default_value: rule.value,
      factory_default_value: rule.default_value,
      baseline_description: describeBaseline(rule),
      status,
      status_reason: reason,
    }
  })

  // Sort: category then key, for stable UI order
  items.sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1
    return a.rule_key < b.rule_key ? -1 : 1
  })

  const summary = {
    guideline_pass: items.filter((i) => i.source !== 'cns' && i.status === 'pass').length,
    guideline_warning: items.filter((i) => i.source !== 'cns' && i.status === 'warning').length,
    cns_pass: items.filter((i) => i.source === 'cns' && i.status === 'pass').length,
    cns_warning: items.filter((i) => i.source === 'cns' && i.status === 'warning').length,
    total_fail: items.filter((i) => i.status === 'fail').length,
  }

  return { summary, items }
}

function describeBaseline(rule: TeamRule): string {
  if (rule.type === 'number') {
    const unit = rule.unit || ''
    if (rule.baseline_min !== null && rule.baseline_max !== null) {
      return `${rule.baseline_min}-${rule.baseline_max} ${unit}`.trim()
    }
    if (rule.baseline_min !== null) return `≥ ${rule.baseline_min} ${unit}`.trim()
    if (rule.baseline_max !== null) return `≤ ${rule.baseline_max} ${unit}`.trim()
    return '無限制'
  }
  if (rule.type === 'enum' && rule.baseline_choices) {
    return `[${rule.baseline_choices.join(', ')}]`
  }
  return '未知'
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
bun test src/config/validation.test.ts
```

Expected: 13 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts src/config/validation.ts src/config/validation.test.ts
git commit -S -m "feat(config): real buildValidationReport logic with TDD"
```

---

## Task 2: Wire validation report into solve handler

**Files:**
- Modify: `src/handlers/solve.ts`
- Modify: `src/handlers/solve-snapshot.test.ts` (update expected summary shape)

- [ ] **Step 1: Update `src/handlers/solve.ts`**

Find the existing stub:
```typescript
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
```

Replace with a call to the real function. At the top of the file, add:
```typescript
import { buildValidationReport } from '../config/validation'
import type { ValidationReport } from '../config/types'
```

Remove the `ValidationReportStub` interface declaration (now defined in types.ts). Update the `SolveResponse` interface to use the real `ValidationReport` type.

In the function body, replace the stub construction with:
```typescript
const validation_report: ValidationReport = buildValidationReport(teamRules, caseOverride)
```

Make sure `teamRules` (loaded earlier in the function) is available at the point of the call. If the variable is named differently, use its name.

- [ ] **Step 2: Update `src/handlers/solve-snapshot.test.ts`**

The snapshot test previously asserted `validation_report.summary.total_fail === 0` and `items === []`. Now the items array has 46 entries. Update:

```typescript
test('validation_report returns real shape with 46 items', async () => {
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

  expect(result.validation_report.items).toHaveLength(46)
  expect(result.validation_report.summary.total_fail).toBe(0)

  // All items should pass when no case override
  const passed = result.validation_report.items.filter(i => i.status === 'pass')
  expect(passed).toHaveLength(46)

  // Summary counts should sum to total
  const { guideline_pass, guideline_warning, cns_pass, cns_warning } =
    result.validation_report.summary
  expect(guideline_pass + guideline_warning + cns_pass + cns_warning).toBe(46)
})
```

Replace the existing `test('validation_report returns stub shape', ...)` with the above.

- [ ] **Step 3: Run the updated tests**

```bash
bun test src/handlers/solve-snapshot.test.ts src/handlers/solve-geometry.test.ts
```

Expected: all pass.

- [ ] **Step 4: Run full suite**

```bash
bun test
```

Expected: all pass (approximately 132 tests after adding the 13 new validation tests).

- [ ] **Step 5: Commit**

```bash
git add src/handlers/solve.ts src/handlers/solve-snapshot.test.ts
git commit -S -m "feat(handlers): wire real buildValidationReport into solve handler"
```

---

## Task 3: Extend `src/config/load.ts` with `RulesStore` interface + implementations

**Files:**
- Modify: `src/config/load.ts` (add RulesStore, D1RulesStore, InMemoryRulesStore)
- Modify: `src/config/types.ts` (add AuditSource, CommitResult)

**Rationale:** CRUD handlers need a write-capable interface. Production uses D1, local Bun dev needs an in-memory equivalent so developers can test the full rules tab flow without `wrangler dev`. Both implement the same interface.

- [ ] **Step 1: Add types to `src/config/types.ts`**

Append:

```typescript
// ---- Audit + Commit (Milestone 1c) ----

export type AuditSource = 'migration' | 'ai' | 'user' | 'admin'

export interface CommitResult {
  applied: Array<{
    key: string
    old_value: string
    new_value: string
    audit_id: number
  }>
  skipped: Array<{
    key: string
    reason: 'rule_deleted' | 'baseline_violation' | 'unchanged' | 'unknown_key'
  }>
}

export class RuleNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Rule not found: ${key}`)
    this.name = 'RuleNotFoundError'
  }
}

export class RuleMandatoryError extends Error {
  constructor(public readonly key: string) {
    super(`Cannot delete mandatory rule: ${key}`)
    this.name = 'RuleMandatoryError'
  }
}
```

- [ ] **Step 2: Extend `src/config/load.ts` with `RulesStore` interface**

Add after the existing `RulesLoader` interface:

```typescript
import type {
  TeamRule, RawRule,
  CaseOverride,
  AuditSource, CommitResult,
} from './types'
import { RuleNotFoundError, RuleMandatoryError } from './types'
import { assertValueWithinBaseline, BaselineViolationError } from './effective'

/**
 * Write-capable rules store. Used by rules CRUD handlers.
 */
export interface RulesStore extends RulesLoader {
  listDeleted(): Promise<TeamRule[]>
  updateRuleValue(key: string, value: string, source: AuditSource): Promise<TeamRule>
  softDeleteRule(key: string, source: AuditSource): Promise<TeamRule>
  restoreRule(key: string, source: AuditSource): Promise<TeamRule>
  commitCaseOverride(override: CaseOverride, source: AuditSource): Promise<CommitResult>
}
```

- [ ] **Step 3: Add `D1RulesStore` class**

Append to `src/config/load.ts`:

```typescript
// ---- D1 write-capable store ----

interface D1Statement {
  bind(...values: unknown[]): D1Statement
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { last_row_id: number } }>
}

interface D1DatabaseWithWrite extends D1Database {
  prepare(query: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown[]>
}

export class D1RulesStore extends D1RulesLoader implements RulesStore {
  constructor(private readonly writeDb: D1DatabaseWithWrite) {
    super(writeDb as any)
  }

  async listDeleted(): Promise<TeamRule[]> {
    const result = await this.writeDb
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE deleted_at IS NOT NULL
         ORDER BY category, key`,
      )
      .all<RawRuleRow>()

    return result.results.map(parseRuleRow)
  }

  async updateRuleValue(
    key: string,
    value: string,
    source: AuditSource,
  ): Promise<TeamRule> {
    const rule = await this.findActiveRule(key)
    if (!rule) throw new RuleNotFoundError(key)

    assertValueWithinBaseline(rule, value)

    const now = Math.floor(Date.now() / 1000)
    await this.writeDb.batch([
      this.writeDb
        .prepare(`UPDATE rules SET value = ?, updated_at = ? WHERE key = ?`)
        .bind(value, now, key),
      this.writeDb
        .prepare(
          `INSERT INTO rule_audit
           (rule_id, rule_key, action, old_value, new_value, source, timestamp)
           VALUES (?, ?, 'update', ?, ?, ?, ?)`,
        )
        .bind(rule.id, rule.key, rule.value, value, source, now),
    ])

    return { ...rule, value }
  }

  async softDeleteRule(key: string, source: AuditSource): Promise<TeamRule> {
    const rule = await this.findActiveRule(key)
    if (!rule) throw new RuleNotFoundError(key)
    if (rule.mandatory === 1) throw new RuleMandatoryError(key)

    const now = Math.floor(Date.now() / 1000)
    await this.writeDb.batch([
      this.writeDb
        .prepare(`UPDATE rules SET deleted_at = ?, updated_at = ? WHERE key = ?`)
        .bind(now, now, key),
      this.writeDb
        .prepare(
          `INSERT INTO rule_audit
           (rule_id, rule_key, action, old_value, new_value, source, timestamp)
           VALUES (?, ?, 'delete', ?, NULL, ?, ?)`,
        )
        .bind(rule.id, rule.key, rule.value, source, now),
    ])

    return rule
  }

  async restoreRule(key: string, source: AuditSource): Promise<TeamRule> {
    const result = await this.writeDb
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE key = ? AND deleted_at IS NOT NULL`,
      )
      .bind(key)
      .all<RawRuleRow>()

    if (result.results.length === 0) throw new RuleNotFoundError(key)
    const rule = parseRuleRow(result.results[0]!)

    const now = Math.floor(Date.now() / 1000)
    await this.writeDb.batch([
      this.writeDb
        .prepare(`UPDATE rules SET deleted_at = NULL, updated_at = ? WHERE key = ?`)
        .bind(now, key),
      this.writeDb
        .prepare(
          `INSERT INTO rule_audit
           (rule_id, rule_key, action, old_value, new_value, source, timestamp)
           VALUES (?, ?, 'restore', NULL, ?, ?, ?)`,
        )
        .bind(rule.id, rule.key, rule.value, source, now),
    ])

    return rule
  }

  async commitCaseOverride(
    override: CaseOverride,
    source: AuditSource,
  ): Promise<CommitResult> {
    const rules = await this.loadActiveRules()
    const byKey = new Map(rules.map((r) => [r.key, r]))
    const applied: CommitResult['applied'] = []
    const skipped: CommitResult['skipped'] = []

    for (const [key, newValue] of Object.entries(override)) {
      const rule = byKey.get(key)
      if (!rule) {
        skipped.push({ key, reason: 'unknown_key' })
        continue
      }
      if (newValue === rule.value) {
        skipped.push({ key, reason: 'unchanged' })
        continue
      }
      try {
        assertValueWithinBaseline(rule, newValue)
      } catch (e) {
        if (e instanceof BaselineViolationError) {
          skipped.push({ key, reason: 'baseline_violation' })
          continue
        }
        throw e
      }

      const now = Math.floor(Date.now() / 1000)
      await this.writeDb.batch([
        this.writeDb
          .prepare(`UPDATE rules SET value = ?, updated_at = ? WHERE key = ?`)
          .bind(newValue, now, key),
        this.writeDb
          .prepare(
            `INSERT INTO rule_audit
             (rule_id, rule_key, action, old_value, new_value, source, timestamp)
             VALUES (?, ?, 'update', ?, ?, ?, ?)`,
          )
          .bind(rule.id, rule.key, rule.value, newValue, source, now),
      ])
      applied.push({
        key,
        old_value: rule.value,
        new_value: newValue,
        audit_id: 0, // D1 batch doesn't give us row IDs; acceptable for v1
      })
    }

    return { applied, skipped }
  }

  private async findActiveRule(key: string): Promise<TeamRule | null> {
    const result = await this.writeDb
      .prepare(
        `SELECT id, key, name, description, type, value, default_value, unit,
                baseline_min, baseline_max, baseline_choices, category, mandatory, source
         FROM rules
         WHERE key = ? AND deleted_at IS NULL`,
      )
      .bind(key)
      .all<RawRuleRow>()

    if (result.results.length === 0) return null
    return parseRuleRow(result.results[0]!)
  }
}
```

- [ ] **Step 4: Add `InMemoryRulesStore` class**

Append to `src/config/load.ts`:

```typescript
// ---- In-memory store (local Bun dev + tests) ----

interface InMemoryRule extends TeamRule {
  deleted_at: number | null
  updated_at: number
}

let nextAuditId = 1

/**
 * Mutable in-memory rules store. Seeded from seeds/generate-baseline.ts.
 * Used by src/demo/server.ts and Layer 3 handler tests.
 *
 * NOT a singleton — each instance has its own state. The demo server holds
 * one singleton; tests create fresh instances per test.
 */
export class InMemoryRulesStore implements RulesStore {
  private rules: Map<string, InMemoryRule>
  private auditLog: Array<{
    id: number
    rule_id: number
    rule_key: string
    action: 'create' | 'update' | 'delete' | 'restore'
    old_value: string | null
    new_value: string | null
    source: AuditSource
    timestamp: number
  }> = []

  constructor() {
    this.rules = new Map()
    const raw = buildBaselineRules()
    let idCounter = 1
    for (const r of raw) {
      const now = Math.floor(Date.now() / 1000)
      this.rules.set(r.key, {
        ...rawToTeamRule(r),
        id: idCounter++,
        deleted_at: null,
        updated_at: now,
      })
    }
  }

  async loadActiveRules(): Promise<TeamRule[]> {
    return Array.from(this.rules.values())
      .filter((r) => r.deleted_at === null)
      .sort((a, b) => {
        if (a.category !== b.category) return a.category < b.category ? -1 : 1
        return a.key < b.key ? -1 : 1
      })
      .map(stripInternalFields)
  }

  async listDeleted(): Promise<TeamRule[]> {
    return Array.from(this.rules.values())
      .filter((r) => r.deleted_at !== null)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map(stripInternalFields)
  }

  async updateRuleValue(
    key: string,
    value: string,
    source: AuditSource,
  ): Promise<TeamRule> {
    const rule = this.rules.get(key)
    if (!rule || rule.deleted_at !== null) throw new RuleNotFoundError(key)
    assertValueWithinBaseline(rule, value)

    const now = Math.floor(Date.now() / 1000)
    const oldValue = rule.value
    rule.value = value
    rule.updated_at = now
    this.auditLog.push({
      id: nextAuditId++,
      rule_id: rule.id,
      rule_key: key,
      action: 'update',
      old_value: oldValue,
      new_value: value,
      source,
      timestamp: now,
    })
    return stripInternalFields(rule)
  }

  async softDeleteRule(key: string, source: AuditSource): Promise<TeamRule> {
    const rule = this.rules.get(key)
    if (!rule || rule.deleted_at !== null) throw new RuleNotFoundError(key)
    if (rule.mandatory === 1) throw new RuleMandatoryError(key)

    const now = Math.floor(Date.now() / 1000)
    rule.deleted_at = now
    rule.updated_at = now
    this.auditLog.push({
      id: nextAuditId++,
      rule_id: rule.id,
      rule_key: key,
      action: 'delete',
      old_value: rule.value,
      new_value: null,
      source,
      timestamp: now,
    })
    return stripInternalFields(rule)
  }

  async restoreRule(key: string, source: AuditSource): Promise<TeamRule> {
    const rule = this.rules.get(key)
    if (!rule || rule.deleted_at === null) throw new RuleNotFoundError(key)

    const now = Math.floor(Date.now() / 1000)
    rule.deleted_at = null
    rule.updated_at = now
    this.auditLog.push({
      id: nextAuditId++,
      rule_id: rule.id,
      rule_key: key,
      action: 'restore',
      old_value: null,
      new_value: rule.value,
      source,
      timestamp: now,
    })
    return stripInternalFields(rule)
  }

  async commitCaseOverride(
    override: CaseOverride,
    source: AuditSource,
  ): Promise<CommitResult> {
    const applied: CommitResult['applied'] = []
    const skipped: CommitResult['skipped'] = []

    for (const [key, newValue] of Object.entries(override)) {
      const rule = this.rules.get(key)
      if (!rule || rule.deleted_at !== null) {
        skipped.push({ key, reason: 'unknown_key' })
        continue
      }
      if (newValue === rule.value) {
        skipped.push({ key, reason: 'unchanged' })
        continue
      }
      try {
        assertValueWithinBaseline(rule, newValue)
      } catch (e) {
        if (e instanceof BaselineViolationError) {
          skipped.push({ key, reason: 'baseline_violation' })
          continue
        }
        throw e
      }

      const now = Math.floor(Date.now() / 1000)
      const oldValue = rule.value
      rule.value = newValue
      rule.updated_at = now
      const auditId = nextAuditId++
      this.auditLog.push({
        id: auditId,
        rule_id: rule.id,
        rule_key: key,
        action: 'update',
        old_value: oldValue,
        new_value: newValue,
        source,
        timestamp: now,
      })
      applied.push({ key, old_value: oldValue, new_value: newValue, audit_id: auditId })
    }

    return { applied, skipped }
  }

  /** Test helper: expose audit log for assertions */
  _getAuditLog() {
    return [...this.auditLog]
  }
}

function stripInternalFields(rule: InMemoryRule): TeamRule {
  const { deleted_at, updated_at, ...publicFields } = rule
  return publicFields
}
```

Also update the existing `StaticRulesLoader` — mark it deprecated with a comment pointing at `InMemoryRulesStore`:

```typescript
/**
 * @deprecated Use InMemoryRulesStore for full CRUD support.
 * Kept temporarily for backwards compatibility with snapshot tests.
 */
export class StaticRulesLoader implements RulesLoader {
  // ... existing impl unchanged
}
```

Actually — don't deprecate yet. The snapshot test still uses it via `new StaticRulesLoader()`. Leave it in place; tests can migrate in a later task.

- [ ] **Step 5: Verify types compile**

```bash
bun -e "import { D1RulesStore, InMemoryRulesStore, RulesStore } from './src/config/load'; const s = new InMemoryRulesStore(); s.loadActiveRules().then(r => console.log('loaded', r.length, 'rules'))"
```

Expected: `loaded 46 rules`

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts src/config/load.ts
git commit -S -m "feat(config): add RulesStore interface + D1RulesStore + InMemoryRulesStore"
```

---

## Task 4: Create `src/handlers/rules.ts` with all 5 CRUD handlers

**Files:**
- Create: `src/handlers/rules.ts`

**Rationale:** Handlers are runtime-neutral (take `RulesStore` + request body, return JSON shapes). Worker + Bun server both call into them.

- [ ] **Step 1: Create the file**

```typescript
/**
 * /api/rules handlers — runtime-neutral.
 *
 * All handlers take a RulesStore (D1 in production, InMemory for local dev + tests)
 * and return plain response shapes. The caller (worker or Bun server) converts
 * them to HTTP responses and handles errors.
 */

import type {
  TeamRule,
  CaseOverride,
  CommitResult,
  AuditSource,
} from '../config/types'
import { RuleNotFoundError, RuleMandatoryError } from '../config/types'
import { BaselineViolationError } from '../config/effective'
import type { RulesStore } from '../config/load'

export interface ListRulesResponse {
  rules: TeamRule[]
  categories: RuleCategory[]
}

export interface RuleCategory {
  id: string
  display_name: string
  sort_order: number
}

// Hardcoded category metadata — matches migrations/0001_initial_rules_schema.sql
const RULE_CATEGORIES: RuleCategory[] = [
  { id: 'shaft', display_name: '坑道', sort_order: 10 },
  { id: 'clearance', display_name: '間隙', sort_order: 20 },
  { id: 'car', display_name: '車廂', sort_order: 30 },
  { id: 'cwt', display_name: '配重', sort_order: 40 },
  { id: 'rail', display_name: '導軌', sort_order: 50 },
  { id: 'door', display_name: '門', sort_order: 60 },
  { id: 'height', display_name: '高度 / 速度', sort_order: 70 },
  { id: 'usage', display_name: '用途預設', sort_order: 80 },
]

export async function handleListRules(store: RulesStore): Promise<ListRulesResponse> {
  const rules = await store.loadActiveRules()
  return { rules, categories: RULE_CATEGORIES }
}

export async function handleListDeletedRules(
  store: RulesStore,
): Promise<{ rules: TeamRule[] }> {
  const rules = await store.listDeleted()
  return { rules }
}

export interface PatchRuleRequest {
  value: string
  reason?: string
}

export interface PatchRuleResponse {
  rule: TeamRule
}

export async function handlePatchRule(
  store: RulesStore,
  key: string,
  body: unknown,
): Promise<PatchRuleResponse> {
  const parsed = parsePatchBody(body)
  const source: AuditSource = 'user'
  const rule = await store.updateRuleValue(key, parsed.value, source)
  return { rule }
}

function parsePatchBody(raw: unknown): PatchRuleRequest {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidRulesBodyError('Request body must be a JSON object')
  }
  const b = raw as Record<string, unknown>
  if (typeof b.value !== 'string') {
    throw new InvalidRulesBodyError('value must be a string')
  }
  return { value: b.value, reason: typeof b.reason === 'string' ? b.reason : undefined }
}

export async function handleDeleteRule(
  store: RulesStore,
  key: string,
): Promise<{ rule: TeamRule }> {
  const rule = await store.softDeleteRule(key, 'user')
  return { rule }
}

export async function handleRestoreRule(
  store: RulesStore,
  key: string,
): Promise<{ rule: TeamRule }> {
  const rule = await store.restoreRule(key, 'user')
  return { rule }
}

export interface CommitRequest {
  session_id?: string
  case_override: CaseOverride
}

export async function handleCommit(
  store: RulesStore,
  body: unknown,
): Promise<CommitResult> {
  const parsed = parseCommitBody(body)
  return store.commitCaseOverride(parsed.case_override, 'user')
}

function parseCommitBody(raw: unknown): CommitRequest {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidRulesBodyError('Request body must be a JSON object')
  }
  const b = raw as Record<string, unknown>
  if (!b.case_override || typeof b.case_override !== 'object') {
    throw new InvalidRulesBodyError('case_override must be an object')
  }
  for (const v of Object.values(b.case_override as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new InvalidRulesBodyError('case_override values must all be strings')
    }
  }
  return {
    case_override: b.case_override as CaseOverride,
    session_id: typeof b.session_id === 'string' ? b.session_id : undefined,
  }
}

export class InvalidRulesBodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRulesBodyError'
  }
}

// Re-exports for callers
export { RuleNotFoundError, RuleMandatoryError, BaselineViolationError }
```

- [ ] **Step 2: Verify it compiles**

```bash
bun -e "import { handleListRules, handlePatchRule } from './src/handlers/rules'; console.log(typeof handleListRules, typeof handlePatchRule)"
```

Expected: `function function`

- [ ] **Step 3: Commit**

```bash
git add src/handlers/rules.ts
git commit -S -m "feat(handlers): add rules CRUD handlers (list/patch/delete/restore/commit)"
```

---

## Task 5: Integration tests for rules handlers (Layer 3)

**Files:**
- Create: `src/handlers/rules.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
/**
 * Layer 3 integration tests for rules CRUD handlers.
 *
 * Uses InMemoryRulesStore (no real D1) so tests run fast and deterministic.
 * A fresh store is constructed per test.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { InMemoryRulesStore } from '../config/load'
import {
  handleListRules,
  handleListDeletedRules,
  handlePatchRule,
  handleDeleteRule,
  handleRestoreRule,
  handleCommit,
  InvalidRulesBodyError,
  RuleNotFoundError,
  RuleMandatoryError,
  BaselineViolationError,
} from './rules'

let store: InMemoryRulesStore

beforeEach(() => {
  store = new InMemoryRulesStore()
})

describe('handleListRules', () => {
  test('returns 46 rules + 8 categories', async () => {
    const result = await handleListRules(store)
    expect(result.rules).toHaveLength(46)
    expect(result.categories).toHaveLength(8)
  })

  test('categories are sorted by sort_order', async () => {
    const result = await handleListRules(store)
    const orders = result.categories.map(c => c.sort_order)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]!)
    }
  })

  test('rules are sorted by category then key', async () => {
    const result = await handleListRules(store)
    for (let i = 1; i < result.rules.length; i++) {
      const prev = result.rules[i - 1]!
      const curr = result.rules[i]!
      if (prev.category !== curr.category) {
        expect(curr.category > prev.category).toBe(true)
      } else {
        expect(curr.key > prev.key).toBe(true)
      }
    }
  })
})

describe('handleListDeletedRules', () => {
  test('empty initially', async () => {
    const result = await handleListDeletedRules(store)
    expect(result.rules).toHaveLength(0)
  })

  test('shows deleted rules after softDeleteRule', async () => {
    await handleDeleteRule(store, 'cwt.position')
    const result = await handleListDeletedRules(store)
    expect(result.rules).toHaveLength(1)
    expect(result.rules[0]!.key).toBe('cwt.position')
  })
})

describe('handlePatchRule', () => {
  test('updates rule value with valid input', async () => {
    const result = await handlePatchRule(store, 'clearance.side_mm', { value: '250' })
    expect(result.rule.value).toBe('250')

    // Verify persistence
    const listed = await handleListRules(store)
    const clearance = listed.rules.find(r => r.key === 'clearance.side_mm')!
    expect(clearance.value).toBe('250')
  })

  test('rejects value below baseline_min', async () => {
    await expect(
      handlePatchRule(store, 'clearance.side_mm', { value: '50' }),
    ).rejects.toThrow(BaselineViolationError)
  })

  test('rejects value above baseline_max', async () => {
    await expect(
      handlePatchRule(store, 'clearance.side_mm', { value: '999' }),
    ).rejects.toThrow(BaselineViolationError)
  })

  test('rejects non-existent rule key', async () => {
    await expect(
      handlePatchRule(store, 'nonexistent.key', { value: '1' }),
    ).rejects.toThrow(RuleNotFoundError)
  })

  test('rejects invalid body shape', async () => {
    await expect(
      handlePatchRule(store, 'clearance.side_mm', { wrong: 'field' }),
    ).rejects.toThrow(InvalidRulesBodyError)
  })

  test('rejects enum value not in baseline_choices', async () => {
    await expect(
      handlePatchRule(store, 'cwt.position', { value: 'moon_base' }),
    ).rejects.toThrow(BaselineViolationError)
  })

  test('accepts enum value in baseline_choices', async () => {
    const result = await handlePatchRule(store, 'cwt.position', { value: 'back_center' })
    expect(result.rule.value).toBe('back_center')
  })

  test('audit log receives update entry', async () => {
    await handlePatchRule(store, 'clearance.side_mm', { value: '250' })
    const log = store._getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0]!.action).toBe('update')
    expect(log[0]!.rule_key).toBe('clearance.side_mm')
    expect(log[0]!.old_value).toBe('200')
    expect(log[0]!.new_value).toBe('250')
    expect(log[0]!.source).toBe('user')
  })
})

describe('handleDeleteRule', () => {
  test('soft-deletes non-mandatory rule', async () => {
    const result = await handleDeleteRule(store, 'cwt.position')
    expect(result.rule.key).toBe('cwt.position')

    const active = await handleListRules(store)
    expect(active.rules.find(r => r.key === 'cwt.position')).toBeUndefined()
    const deleted = await handleListDeletedRules(store)
    expect(deleted.rules.find(r => r.key === 'cwt.position')).toBeDefined()
  })

  test('rejects mandatory rule with RuleMandatoryError', async () => {
    await expect(
      handleDeleteRule(store, 'clearance.side_mm'), // mandatory=1
    ).rejects.toThrow(RuleMandatoryError)
  })

  test('rejects non-existent rule', async () => {
    await expect(
      handleDeleteRule(store, 'nonexistent.key'),
    ).rejects.toThrow(RuleNotFoundError)
  })

  test('audit log receives delete entry', async () => {
    await handleDeleteRule(store, 'cwt.position')
    const log = store._getAuditLog()
    const deleteEntry = log.find(e => e.action === 'delete')
    expect(deleteEntry).toBeDefined()
    expect(deleteEntry!.rule_key).toBe('cwt.position')
  })
})

describe('handleRestoreRule', () => {
  test('restores a soft-deleted rule', async () => {
    await handleDeleteRule(store, 'cwt.position')
    const result = await handleRestoreRule(store, 'cwt.position')
    expect(result.rule.key).toBe('cwt.position')

    const active = await handleListRules(store)
    expect(active.rules.find(r => r.key === 'cwt.position')).toBeDefined()
    const deleted = await handleListDeletedRules(store)
    expect(deleted.rules).toHaveLength(0)
  })

  test('rejects rule that is not deleted', async () => {
    await expect(handleRestoreRule(store, 'cwt.position')).rejects.toThrow(
      RuleNotFoundError,
    )
  })
})

describe('handleCommit', () => {
  test('applies valid override and writes audit', async () => {
    const result = await handleCommit(store, {
      case_override: { 'clearance.side_mm': '250' },
    })
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0]!.key).toBe('clearance.side_mm')
    expect(result.applied[0]!.old_value).toBe('200')
    expect(result.applied[0]!.new_value).toBe('250')
    expect(result.skipped).toHaveLength(0)

    // Verify persistence
    const listed = await handleListRules(store)
    expect(listed.rules.find(r => r.key === 'clearance.side_mm')!.value).toBe('250')
  })

  test('skips unchanged values', async () => {
    const result = await handleCommit(store, {
      case_override: { 'clearance.side_mm': '200' }, // already 200
    })
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('unchanged')
  })

  test('skips baseline violations', async () => {
    const result = await handleCommit(store, {
      case_override: { 'clearance.side_mm': '50' }, // below min 150
    })
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('baseline_violation')
  })

  test('skips unknown keys', async () => {
    const result = await handleCommit(store, {
      case_override: { 'ghost.rule': '1' },
    })
    expect(result.applied).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toBe('unknown_key')
  })

  test('partial apply — mix of success and skipped', async () => {
    const result = await handleCommit(store, {
      case_override: {
        'clearance.side_mm': '250', // valid
        'clearance.back_mm': '50', // baseline violation
        'ghost.rule': '1', // unknown
        'clearance.front_mm': '150', // unchanged
      },
    })
    expect(result.applied).toHaveLength(1)
    expect(result.skipped).toHaveLength(3)
    const reasons = result.skipped.map(s => s.reason).sort()
    expect(reasons).toEqual(['baseline_violation', 'unchanged', 'unknown_key'])
  })

  test('rejects invalid body shape', async () => {
    await expect(
      handleCommit(store, { no: 'case_override' }),
    ).rejects.toThrow(InvalidRulesBodyError)
  })
})
```

- [ ] **Step 2: Run tests, verify pass**

```bash
bun test src/handlers/rules.test.ts
```

Expected: ~22 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add src/handlers/rules.test.ts
git commit -S -m "test(handlers): Layer 3 integration tests for rules CRUD"
```

---

## Task 6: Wire rules routes into Worker + Bun server

**Files:**
- Modify: `src/worker/index.ts`
- Modify: `src/demo/server.ts`

- [ ] **Step 1: Add rules routes to `src/worker/index.ts`**

Add imports near the top:
```typescript
import {
  handleListRules,
  handleListDeletedRules,
  handlePatchRule,
  handleDeleteRule,
  handleRestoreRule,
  handleCommit,
  InvalidRulesBodyError,
  RuleNotFoundError,
  RuleMandatoryError,
} from '../handlers/rules'
import { D1RulesStore } from '../config/load'
```

Add a helper at the top of the fetch method to convert the `RuleNotFoundError`/`RuleMandatoryError`/`InvalidRulesBodyError` to HTTP responses. Place the rules routes BEFORE `/api/solve`:

```typescript
// --- Rules routes ---
if (url.pathname === '/api/rules' && request.method === 'GET') {
  try {
    const store = new D1RulesStore(env.DB as any)
    const result = await handleListRules(store)
    return jsonResponse(result)
  } catch (err) {
    return handleRulesError(err)
  }
}

if (url.pathname === '/api/rules/deleted' && request.method === 'GET') {
  try {
    const store = new D1RulesStore(env.DB as any)
    const result = await handleListDeletedRules(store)
    return jsonResponse(result)
  } catch (err) {
    return handleRulesError(err)
  }
}

if (url.pathname === '/api/rules/commit' && request.method === 'POST') {
  try {
    const body = await request.json()
    const store = new D1RulesStore(env.DB as any)
    const result = await handleCommit(store, body)
    return jsonResponse(result)
  } catch (err) {
    return handleRulesError(err)
  }
}

// /api/rules/:key/restore (POST)
const restoreMatch = url.pathname.match(/^\/api\/rules\/([^/]+)\/restore$/)
if (restoreMatch && request.method === 'POST') {
  try {
    const key = decodeURIComponent(restoreMatch[1]!)
    const store = new D1RulesStore(env.DB as any)
    const result = await handleRestoreRule(store, key)
    return jsonResponse(result)
  } catch (err) {
    return handleRulesError(err)
  }
}

// /api/rules/:key (PATCH/DELETE)
const keyMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/)
if (keyMatch) {
  const key = decodeURIComponent(keyMatch[1]!)
  const store = new D1RulesStore(env.DB as any)
  if (request.method === 'PATCH') {
    try {
      const body = await request.json()
      const result = await handlePatchRule(store, key, body)
      return jsonResponse(result)
    } catch (err) {
      return handleRulesError(err)
    }
  }
  if (request.method === 'DELETE') {
    try {
      const result = await handleDeleteRule(store, key)
      return jsonResponse(result)
    } catch (err) {
      return handleRulesError(err)
    }
  }
}
```

Add the error helper function (near the bottom, before `export default`):

```typescript
function handleRulesError(err: unknown): Response {
  if (err instanceof InvalidRulesBodyError) {
    return jsonResponse({ error: 'invalid_request', message: err.message }, { status: 400 })
  }
  if (err instanceof RuleNotFoundError) {
    return jsonResponse({ error: 'not_found', message: err.message, key: (err as any).key }, { status: 404 })
  }
  if (err instanceof RuleMandatoryError) {
    return jsonResponse(
      { error: 'mandatory_rule', message: err.message, key: (err as any).key },
      { status: 403 },
    )
  }
  if (err instanceof BaselineViolationError) {
    return jsonResponse(
      {
        error: 'baseline_violation',
        message: err.message,
        rule_key: err.ruleKey,
        attempted_value: err.attemptedValue,
        baseline: err.baseline,
      },
      { status: 400 },
    )
  }
  return jsonResponse(
    { error: 'internal_error', message: String(err) },
    { status: 500 },
  )
}
```

Also add `BaselineViolationError` to the import if not already there.

- [ ] **Step 2: Add rules routes to `src/demo/server.ts`**

Import handlers + InMemoryRulesStore. Create a singleton store at module level:

```typescript
import {
  handleListRules,
  handleListDeletedRules,
  handlePatchRule,
  handleDeleteRule,
  handleRestoreRule,
  handleCommit,
  InvalidRulesBodyError,
  RuleNotFoundError,
  RuleMandatoryError,
} from '../handlers/rules'
import { InMemoryRulesStore } from '../config/load'
// ... existing imports

// Singleton store for local dev (persists across requests within this Bun process)
const rulesStore = new InMemoryRulesStore()
```

Update the /api/solve handler to use `rulesStore` instead of creating a new `StaticRulesLoader()` each time:

```typescript
if (url.pathname === '/api/solve' && req.method === 'POST') {
  try {
    const body = await req.json()
    const result = await handleSolve(body, rulesStore)
    return Response.json(result)
  } catch (err) {
    // ... existing error handling
  }
}
```

Then add the rules routes (same structure as the worker, but using `Response.json` and `rulesStore`):

```typescript
if (url.pathname === '/api/rules' && req.method === 'GET') {
  try {
    return Response.json(await handleListRules(rulesStore))
  } catch (err) {
    return handleRulesErrorBun(err)
  }
}

if (url.pathname === '/api/rules/deleted' && req.method === 'GET') {
  try {
    return Response.json(await handleListDeletedRules(rulesStore))
  } catch (err) {
    return handleRulesErrorBun(err)
  }
}

if (url.pathname === '/api/rules/commit' && req.method === 'POST') {
  try {
    const body = await req.json()
    return Response.json(await handleCommit(rulesStore, body))
  } catch (err) {
    return handleRulesErrorBun(err)
  }
}

const restoreMatch = url.pathname.match(/^\/api\/rules\/([^/]+)\/restore$/)
if (restoreMatch && req.method === 'POST') {
  try {
    const key = decodeURIComponent(restoreMatch[1]!)
    return Response.json(await handleRestoreRule(rulesStore, key))
  } catch (err) {
    return handleRulesErrorBun(err)
  }
}

const keyMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/)
if (keyMatch) {
  const key = decodeURIComponent(keyMatch[1]!)
  if (req.method === 'PATCH') {
    try {
      const body = await req.json()
      return Response.json(await handlePatchRule(rulesStore, key, body))
    } catch (err) {
      return handleRulesErrorBun(err)
    }
  }
  if (req.method === 'DELETE') {
    try {
      return Response.json(await handleDeleteRule(rulesStore, key))
    } catch (err) {
      return handleRulesErrorBun(err)
    }
  }
}
```

Add the error helper:

```typescript
function handleRulesErrorBun(err: unknown): Response {
  if (err instanceof InvalidRulesBodyError) {
    return Response.json({ error: 'invalid_request', message: err.message }, { status: 400 })
  }
  if (err instanceof RuleNotFoundError) {
    return Response.json({ error: 'not_found', message: err.message, key: (err as any).key }, { status: 404 })
  }
  if (err instanceof RuleMandatoryError) {
    return Response.json(
      { error: 'mandatory_rule', message: err.message, key: (err as any).key },
      { status: 403 },
    )
  }
  if (err instanceof BaselineViolationError) {
    return Response.json(
      {
        error: 'baseline_violation',
        message: err.message,
        rule_key: err.ruleKey,
        attempted_value: err.attemptedValue,
        baseline: err.baseline,
      },
      { status: 400 },
    )
  }
  return Response.json({ error: 'internal_error', message: String(err) }, { status: 500 })
}
```

Import `BaselineViolationError` from `../handlers/solve` (already re-exported there).

- [ ] **Step 3: Smoke test local Bun server**

```bash
pkill -f "bun src/demo/server" 2>/dev/null; sleep 1
bun src/demo/server.ts > /tmp/m1c.log 2>&1 &
disown
sleep 2
echo "--- GET /api/rules ---"
curl -s http://localhost:3000/api/rules | python3 -c "import json, sys; d = json.load(sys.stdin); print('rules:', len(d['rules']), 'cats:', len(d['categories']))"
echo "--- PATCH valid ---"
curl -s -X PATCH -H 'Content-Type: application/json' -d '{"value":"250"}' http://localhost:3000/api/rules/clearance.side_mm | python3 -c "import json, sys; d = json.load(sys.stdin); print('updated:', d['rule']['value'])"
echo "--- PATCH invalid ---"
curl -s -w "\nhttp=%{http_code}\n" -X PATCH -H 'Content-Type: application/json' -d '{"value":"50"}' http://localhost:3000/api/rules/clearance.side_mm
echo "--- DELETE mandatory ---"
curl -s -w "\nhttp=%{http_code}\n" -X DELETE http://localhost:3000/api/rules/clearance.side_mm
echo "--- DELETE non-mandatory ---"
curl -s -X DELETE http://localhost:3000/api/rules/cwt.position | python3 -c "import json, sys; d = json.load(sys.stdin); print('deleted:', d['rule']['key'])"
echo "--- GET /api/rules/deleted ---"
curl -s http://localhost:3000/api/rules/deleted | python3 -c "import json, sys; d = json.load(sys.stdin); print('deleted count:', len(d['rules']))"
echo "--- POST /api/rules/cwt.position/restore ---"
curl -s -X POST http://localhost:3000/api/rules/cwt.position/restore | python3 -c "import json, sys; d = json.load(sys.stdin); print('restored:', d['rule']['key'])"
echo "--- POST /api/rules/commit ---"
curl -s -X POST -H 'Content-Type: application/json' -d '{"case_override":{"cwt.position":"back_center","ghost.key":"x"}}' http://localhost:3000/api/rules/commit | python3 -c "import json, sys; d = json.load(sys.stdin); print('applied:', len(d['applied']), 'skipped:', len(d['skipped']))"
pkill -f "bun src/demo/server" 2>/dev/null
```

Expected:
```
--- GET /api/rules ---
rules: 46 cats: 8
--- PATCH valid ---
updated: 250
--- PATCH invalid ---
{"error":"baseline_violation",...}
http=400
--- DELETE mandatory ---
{"error":"mandatory_rule",...}
http=403
--- DELETE non-mandatory ---
deleted: cwt.position
--- GET /api/rules/deleted ---
deleted count: 1
--- POST /api/rules/cwt.position/restore ---
restored: cwt.position
--- POST /api/rules/commit ---
applied: 1 skipped: 1
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts src/demo/server.ts
git commit -S -m "feat(worker): wire /api/rules CRUD routes (Worker + Bun dev)"
```

---

## Task 7: Frontend hash routing + view scaffold

**Files:**
- Modify: `public/index.html`

**Rationale:** Establish two top-level views (`#/configurator` default, `#/rules`) with a simple router. The existing configurator content is wrapped in `<section id="view-configurator">`. A new `<section id="view-rules">` is added but empty until Task 8. Nav links in the header switch hashes.

- [ ] **Step 1: Wrap existing content in a configurator view**

In `public/index.html`, find the `<main>` section containing the solver form + DXF viewer + validation panel area. Wrap the entire existing `<main>` content in a new `<section id="view-configurator" class="view">`. Add a sibling `<section id="view-rules" class="view hidden"></section>` right after it (empty for now).

Add CSS:
```css
.view { display: block; }
.view.hidden { display: none; }
```

- [ ] **Step 2: Add top nav links for view switching**

In the header, add below the existing title:
```html
<nav class="app-nav">
  <a href="#/configurator" class="nav-link" data-view="configurator">配件器</a>
  <a href="#/rules" class="nav-link" data-view="rules">規則管理</a>
</nav>
```

Add CSS for nav:
```css
.app-nav {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
}
.app-nav .nav-link {
  color: var(--fg-muted);
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 4px;
}
.app-nav .nav-link.active {
  color: var(--fg);
  background: var(--bg-panel);
}
```

- [ ] **Step 3: Add router JS**

Inside the existing `<script>` block, near the top (before any existing initialization), add:

```javascript
// ---- Hash router ----
function currentRoute() {
  const hash = window.location.hash || '#/configurator'
  if (hash.startsWith('#/rules/deleted')) return 'rules-deleted'
  if (hash.startsWith('#/rules')) return 'rules'
  return 'configurator'
}

function renderRoute() {
  const route = currentRoute()
  const configuratorView = document.getElementById('view-configurator')
  const rulesView = document.getElementById('view-rules')
  const navLinks = document.querySelectorAll('.nav-link')

  if (route === 'configurator') {
    configuratorView.classList.remove('hidden')
    rulesView.classList.add('hidden')
  } else {
    configuratorView.classList.add('hidden')
    rulesView.classList.remove('hidden')
  }

  navLinks.forEach(link => {
    const isActive = link.dataset.view === (route === 'configurator' ? 'configurator' : 'rules')
    link.classList.toggle('active', isActive)
  })

  // Dispatch event so individual views can refresh
  document.dispatchEvent(new CustomEvent('route-change', { detail: { route } }))
}

window.addEventListener('hashchange', renderRoute)
window.addEventListener('DOMContentLoaded', renderRoute)
```

- [ ] **Step 4: Smoke test locally**

```bash
pkill -f "bun src/demo/server" 2>/dev/null; sleep 1
bun src/demo/server.ts > /tmp/m1c-ui.log 2>&1 &
disown
sleep 2
# Manual verification: open http://localhost:3000 in a browser, click nav links, verify hash changes + views switch
echo "Server running at http://localhost:3000 — manual verification needed"
pkill -f "bun src/demo/server" 2>/dev/null
```

Since bun test can't DOM-test, manual verification is acceptable for this task. Look at the HTML in a browser or via `curl http://localhost:3000 | grep -E 'view-configurator|view-rules'` to verify the HTML structure is right.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -S -m "feat(ui): add hash router + two-view structure (configurator / rules)"
```

---

## Task 8: Rules Tab UI (list + filters + inline edit + delete modal + deleted view)

**Files:**
- Modify: `public/index.html`

**Rationale:** This is the biggest frontend task. It delivers the full rules management UI within `#view-rules`. ~400 lines of HTML/CSS/JS added. The structure:

1. Sticky filter bar (category, source, status)
2. Active rules list grouped by category (when status=active)
3. Deleted rules list (when status=deleted)
4. Per-rule row with: name, key, source badge, mandatory lock icon, editable value, reset button, delete button
5. Soft-delete confirmation modal
6. Toast notifications for success / error

- [ ] **Step 1: Add CSS for Rules Tab**

Inside the existing `<style>` block, add:

```css
/* ---- Rules Tab ---- */
#view-rules { padding: 20px; max-width: 1200px; margin: 0 auto; }
.rules-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.rules-title { font-size: 18px; font-weight: 600; }

.rules-filters {
  display: flex; gap: 12px; flex-wrap: wrap;
  padding: 12px; background: var(--bg-panel); border-radius: 6px;
  margin-bottom: 20px; position: sticky; top: 0; z-index: 10;
}
.filter-group { display: flex; gap: 4px; align-items: center; }
.filter-label { font-size: 11px; color: var(--fg-muted); text-transform: uppercase; }
.filter-btn {
  padding: 4px 10px; font-size: 11px;
  background: transparent; color: var(--fg-muted);
  border: 1px solid var(--border); border-radius: 4px;
  cursor: pointer; font-family: inherit;
}
.filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

.rule-category-group { margin-bottom: 24px; }
.rule-category-header {
  font-size: 13px; font-weight: 600; color: var(--fg);
  margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border);
}

.rule-row {
  display: grid; grid-template-columns: 1fr auto auto auto;
  gap: 12px; padding: 10px 12px; margin-bottom: 4px;
  background: var(--bg-panel); border-radius: 4px;
  font-size: 12px; align-items: center;
}
.rule-row.deleted { opacity: 0.6; }
.rule-name { font-weight: 500; color: var(--fg); }
.rule-key { font-size: 10px; color: var(--fg-muted); font-family: var(--mono); }
.rule-meta { display: flex; gap: 6px; align-items: center; font-size: 10px; color: var(--fg-muted); }
.source-badge {
  display: inline-block; padding: 2px 6px; border-radius: 3px;
  font-size: 9px; text-transform: uppercase; font-weight: 600;
}
.source-badge.cns { background: #3a4a5e; color: #e7e9ec; }
.source-badge.industry { background: #6b5a20; color: #ffd54f; }
.source-badge.engineering { background: #3a5233; color: #8aa680; }
.mandatory-icon { color: var(--fg-muted); font-size: 11px; }

.rule-value-input {
  padding: 4px 8px; font-size: 12px;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 3px;
  width: 100px; font-family: var(--mono);
}
.rule-value-input:focus { border-color: var(--accent); outline: none; }
.rule-value-input.updated { border-color: var(--accent); animation: flash 0.8s; }
@keyframes flash {
  0% { background: rgba(232, 115, 78, 0.3); }
  100% { background: var(--bg); }
}

.rule-action-btn {
  padding: 4px 8px; font-size: 10px;
  background: transparent; color: var(--fg-muted);
  border: 1px solid var(--border); border-radius: 3px;
  cursor: pointer; font-family: inherit;
}
.rule-action-btn:hover:not(:disabled) { color: var(--fg); border-color: var(--accent); }
.rule-action-btn:disabled { cursor: not-allowed; opacity: 0.4; }
.rule-action-btn.danger:hover:not(:disabled) { color: #e8734e; border-color: #e8734e; }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal-backdrop.hidden { display: none; }
.modal {
  background: var(--bg-panel); border-radius: 8px;
  padding: 24px; max-width: 480px; width: 90%;
  border: 1px solid var(--border);
}
.modal h3 { margin: 0 0 12px 0; font-size: 14px; }
.modal-body { font-size: 12px; color: var(--fg-muted); margin-bottom: 16px; }
.modal-body ul { margin: 8px 0 8px 16px; padding: 0; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.modal-btn {
  padding: 8px 16px; font-size: 12px;
  border: 1px solid var(--border); border-radius: 4px;
  background: transparent; color: var(--fg); cursor: pointer;
}
.modal-btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
.modal-btn.danger:hover { border-color: #e8734e; color: #e8734e; }

/* Toast */
.toast-container {
  position: fixed; bottom: 20px; right: 20px; z-index: 200;
  display: flex; flex-direction: column; gap: 8px;
}
.toast {
  padding: 10px 16px; border-radius: 4px; font-size: 12px;
  background: var(--bg-panel); border-left: 3px solid var(--accent);
  color: var(--fg); animation: toast-in 0.3s;
}
.toast.error { border-left-color: #e8734e; }
@keyframes toast-in { from { transform: translateX(100%); opacity: 0; } to { transform: none; opacity: 1; } }
```

- [ ] **Step 2: Add Rules Tab HTML structure**

Inside `<section id="view-rules" class="view hidden">`, add:

```html
<div class="rules-header">
  <span class="rules-title">規則管理</span>
  <div>
    <a href="#/rules/deleted" class="rule-action-btn">查看已刪規則</a>
  </div>
</div>

<div class="rules-filters">
  <div class="filter-group">
    <span class="filter-label">類別</span>
    <button class="filter-btn active" data-filter="category" data-value="">全部</button>
    <!-- Filled dynamically -->
  </div>
  <div class="filter-group">
    <span class="filter-label">來源</span>
    <button class="filter-btn active" data-filter="source" data-value="">全部</button>
    <button class="filter-btn" data-filter="source" data-value="cns">CNS</button>
    <button class="filter-btn" data-filter="source" data-value="industry">產業</button>
    <button class="filter-btn" data-filter="source" data-value="engineering">工程</button>
  </div>
  <div class="filter-group">
    <span class="filter-label">狀態</span>
    <button class="filter-btn active" data-filter="status" data-value="active">啟用</button>
    <button class="filter-btn" data-filter="status" data-value="deleted">已刪除</button>
  </div>
</div>

<div id="rules-list"></div>

<!-- Delete confirmation modal -->
<div id="delete-modal" class="modal-backdrop hidden">
  <div class="modal">
    <h3>確認刪除設計指引</h3>
    <div class="modal-body">
      <div id="delete-modal-rule-info"></div>
      <p>刪除後：</p>
      <ul>
        <li>此規則立刻從所有案子消失</li>
        <li>Solver 會 fallback 到系統預設</li>
        <li>可在「查看已刪規則」頁面還原</li>
        <li>此動作會記錄到 audit log</li>
      </ul>
    </div>
    <div class="modal-actions">
      <button class="modal-btn" id="delete-cancel">取消</button>
      <button class="modal-btn danger" id="delete-confirm">確認刪除</button>
    </div>
  </div>
</div>

<div class="toast-container" id="toast-container"></div>
```

- [ ] **Step 3: Add Rules Tab JS — state + fetch + render**

Inside the existing `<script>` block, add (after the router):

```javascript
// ---- Rules Tab State ----
const rulesState = {
  rules: [],
  deletedRules: [],
  categories: [],
  filters: { category: '', source: '', status: 'active' },
  pendingDelete: null, // { key, name } when modal open
}

async function fetchRules() {
  const [activeRes, deletedRes] = await Promise.all([
    fetch('/api/rules').then(r => r.json()),
    fetch('/api/rules/deleted').then(r => r.json()),
  ])
  rulesState.rules = activeRes.rules
  rulesState.categories = activeRes.categories
  rulesState.deletedRules = deletedRes.rules
  populateCategoryFilter()
  renderRulesList()
}

function populateCategoryFilter() {
  const filterGroup = document.querySelector('[data-filter="category"]').parentElement
  // Clear existing category buttons except "全部"
  Array.from(filterGroup.querySelectorAll('[data-filter="category"]'))
    .slice(1) // keep "全部"
    .forEach(btn => btn.remove())
  for (const cat of rulesState.categories) {
    const btn = document.createElement('button')
    btn.className = 'filter-btn'
    btn.dataset.filter = 'category'
    btn.dataset.value = cat.id
    btn.textContent = cat.display_name
    filterGroup.appendChild(btn)
  }
  // Re-bind all filter buttons (since we added new ones)
  bindFilters()
}

function bindFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
      const filter = btn.dataset.filter
      const value = btn.dataset.value
      rulesState.filters[filter] = value
      // Update active state on the same filter group
      document.querySelectorAll(`[data-filter="${filter}"]`).forEach(b => {
        b.classList.toggle('active', b.dataset.value === value)
      })
      renderRulesList()
    }
  })
}

function renderRulesList() {
  const container = document.getElementById('rules-list')
  container.innerHTML = ''

  const source = rulesState.filters.source
  const category = rulesState.filters.category
  const status = rulesState.filters.status

  const sourceRules = status === 'active' ? rulesState.rules : rulesState.deletedRules
  const filtered = sourceRules.filter(r => {
    if (source && r.source !== source) return false
    if (category && r.category !== category) return false
    return true
  })

  // Group by category
  const groups = new Map()
  for (const rule of filtered) {
    if (!groups.has(rule.category)) groups.set(rule.category, [])
    groups.get(rule.category).push(rule)
  }

  if (groups.size === 0) {
    container.innerHTML = '<div style="padding:20px;color:var(--fg-muted);">無符合條件的規則</div>'
    return
  }

  for (const [categoryId, rules] of groups.entries()) {
    const catMeta = rulesState.categories.find(c => c.id === categoryId)
    const group = document.createElement('div')
    group.className = 'rule-category-group'

    const header = document.createElement('div')
    header.className = 'rule-category-header'
    header.textContent = `${catMeta ? catMeta.display_name : categoryId} (${rules.length})`
    group.appendChild(header)

    for (const rule of rules) {
      group.appendChild(renderRuleRow(rule, status === 'deleted'))
    }
    container.appendChild(group)
  }
}

function renderRuleRow(rule, isDeleted) {
  const row = document.createElement('div')
  row.className = 'rule-row' + (isDeleted ? ' deleted' : '')

  // Column 1: name + key + meta
  const info = document.createElement('div')
  info.innerHTML = `
    <div class="rule-name">${escapeHtml(rule.name)} ${rule.mandatory ? '<span class="mandatory-icon" title="結構性必要，不可刪">🔒</span>' : ''}</div>
    <div class="rule-key">${escapeHtml(rule.key)}</div>
    <div class="rule-meta">
      <span class="source-badge ${rule.source}">${rule.source}</span>
      ${baselineDescText(rule)}
    </div>
  `
  row.appendChild(info)

  // Column 2: value editor
  const valueCell = document.createElement('div')
  if (isDeleted) {
    valueCell.innerHTML = `<span class="rule-key">${escapeHtml(rule.value)}${rule.unit ? ' ' + rule.unit : ''}</span>`
  } else if (rule.type === 'number') {
    const input = document.createElement('input')
    input.type = 'number'
    input.className = 'rule-value-input'
    input.value = rule.value
    if (rule.baseline_min !== null) input.min = rule.baseline_min
    if (rule.baseline_max !== null) input.max = rule.baseline_max
    input.onblur = () => handleRuleEdit(rule.key, input.value, input)
    valueCell.appendChild(input)
  } else if (rule.type === 'enum') {
    const select = document.createElement('select')
    select.className = 'rule-value-input'
    for (const choice of rule.baseline_choices || []) {
      const opt = document.createElement('option')
      opt.value = choice
      opt.textContent = choice
      if (choice === rule.value) opt.selected = true
      select.appendChild(opt)
    }
    select.onchange = () => handleRuleEdit(rule.key, select.value, select)
    valueCell.appendChild(select)
  }
  row.appendChild(valueCell)

  // Column 3: reset to factory
  const resetCell = document.createElement('div')
  if (!isDeleted && rule.value !== rule.default_value) {
    const btn = document.createElement('button')
    btn.className = 'rule-action-btn'
    btn.textContent = '重設'
    btn.title = `重設為出廠值 ${rule.default_value}`
    btn.onclick = () => handleRuleEdit(rule.key, rule.default_value, null)
    resetCell.appendChild(btn)
  }
  row.appendChild(resetCell)

  // Column 4: delete / restore
  const deleteCell = document.createElement('div')
  if (isDeleted) {
    const btn = document.createElement('button')
    btn.className = 'rule-action-btn'
    btn.textContent = '還原'
    btn.onclick = () => handleRestore(rule.key)
    deleteCell.appendChild(btn)
  } else {
    const btn = document.createElement('button')
    btn.className = 'rule-action-btn danger'
    btn.textContent = '刪除'
    btn.disabled = rule.mandatory
    if (rule.mandatory) btn.title = '此規則為結構性必要，不可刪除'
    btn.onclick = () => openDeleteModal(rule)
    deleteCell.appendChild(btn)
  }
  row.appendChild(deleteCell)

  return row
}

function baselineDescText(rule) {
  if (rule.type === 'number') {
    const unit = rule.unit || ''
    if (rule.baseline_min !== null && rule.baseline_max !== null)
      return `${rule.baseline_min}-${rule.baseline_max} ${unit}`.trim()
    if (rule.baseline_min !== null) return `≥ ${rule.baseline_min} ${unit}`.trim()
    if (rule.baseline_max !== null) return `≤ ${rule.baseline_max} ${unit}`.trim()
    return ''
  }
  return `(${(rule.baseline_choices || []).length} 選項)`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

async function handleRuleEdit(key, newValue, inputEl) {
  try {
    const res = await fetch(`/api/rules/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newValue }),
    })
    if (!res.ok) {
      const err = await res.json()
      showToast(`更新失敗：${err.message || err.error}`, 'error')
      return
    }
    const data = await res.json()
    // Update state
    const idx = rulesState.rules.findIndex(r => r.key === key)
    if (idx >= 0) rulesState.rules[idx] = data.rule
    showToast(`已更新 ${key}`)
    if (inputEl) {
      inputEl.classList.add('updated')
      setTimeout(() => inputEl.classList.remove('updated'), 800)
    } else {
      renderRulesList()
    }
  } catch (e) {
    showToast(`錯誤：${e.message}`, 'error')
  }
}

function openDeleteModal(rule) {
  rulesState.pendingDelete = rule
  const modal = document.getElementById('delete-modal')
  document.getElementById('delete-modal-rule-info').innerHTML = `
    <div style="background:var(--bg);padding:10px;border-radius:4px;margin-bottom:12px;">
      <div><strong>${escapeHtml(rule.key)}</strong></div>
      <div style="font-size:11px;">${escapeHtml(rule.name)}</div>
      <div style="font-size:11px;color:var(--fg-muted);">目前值：${escapeHtml(rule.value)}</div>
      <div style="font-size:11px;color:var(--fg-muted);">來源：${rule.source}</div>
    </div>
  `
  modal.classList.remove('hidden')
}

document.getElementById('delete-cancel').onclick = () => {
  document.getElementById('delete-modal').classList.add('hidden')
  rulesState.pendingDelete = null
}

document.getElementById('delete-confirm').onclick = async () => {
  const rule = rulesState.pendingDelete
  if (!rule) return
  try {
    const res = await fetch(`/api/rules/${encodeURIComponent(rule.key)}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json()
      showToast(`刪除失敗：${err.message || err.error}`, 'error')
      return
    }
    await fetchRules()
    showToast(`已刪除 ${rule.key}`)
  } catch (e) {
    showToast(`錯誤：${e.message}`, 'error')
  } finally {
    document.getElementById('delete-modal').classList.add('hidden')
    rulesState.pendingDelete = null
  }
}

async function handleRestore(key) {
  try {
    const res = await fetch(`/api/rules/${encodeURIComponent(key)}/restore`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json()
      showToast(`還原失敗：${err.message}`, 'error')
      return
    }
    await fetchRules()
    showToast(`已還原 ${key}`)
  } catch (e) {
    showToast(`錯誤：${e.message}`, 'error')
  }
}

function showToast(message, variant = 'success') {
  const container = document.getElementById('toast-container')
  const toast = document.createElement('div')
  toast.className = 'toast' + (variant === 'error' ? ' error' : '')
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

// Fetch rules when entering rules view
document.addEventListener('route-change', (ev) => {
  const route = ev.detail.route
  if (route === 'rules' || route === 'rules-deleted') {
    if (rulesState.rules.length === 0) fetchRules()
    // Handle #/rules/deleted — switch to deleted filter
    if (route === 'rules-deleted') {
      rulesState.filters.status = 'deleted'
      document.querySelectorAll('[data-filter="status"]').forEach(b => {
        b.classList.toggle('active', b.dataset.value === 'deleted')
      })
      renderRulesList()
    }
  }
})
```

- [ ] **Step 4: Smoke test**

```bash
pkill -f "bun src/demo/server" 2>/dev/null; sleep 1
bun src/demo/server.ts > /tmp/m1c-rules-tab.log 2>&1 &
disown
sleep 2
# Manual: open http://localhost:3000#/rules in browser
echo "Manual verify: http://localhost:3000#/rules"
pkill -f "bun src/demo/server" 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -S -m "feat(ui): Rules Tab with list, filters, inline edit, delete modal, restore"
```

---

## Task 9: Validation Panel UI at configurator page bottom

**Files:**
- Modify: `public/index.html`

**Rationale:** Add a collapsible panel at the bottom of the configurator view that shows the current drawing's rule validation status. Summary bar when collapsed, 3 expandable sections when expanded. Revert buttons on case-overridden rows clear the case override for that key and re-solve.

- [ ] **Step 1: Add CSS for Validation Panel**

Append to the `<style>` block:

```css
/* ---- Validation Panel ---- */
.validation-panel {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--bg-panel); border-top: 1px solid var(--border);
  font-size: 12px; z-index: 50;
  max-height: 50vh; display: flex; flex-direction: column;
}
.validation-panel.collapsed .validation-body { display: none; }
.validation-summary {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; cursor: pointer;
}
.validation-summary:hover { background: var(--bg); }
.validation-counts { display: flex; gap: 20px; font-family: var(--mono); }
.count-pass { color: #8aa680; }
.count-warning { color: #ffd54f; }
.count-cns { color: #e7e9ec; }
.count-fail { color: #e8734e; }
.validation-toggle { font-size: 10px; color: var(--fg-muted); }

.validation-body {
  overflow-y: auto; padding: 16px 20px; border-top: 1px solid var(--border);
}
.validation-section { margin-bottom: 16px; }
.validation-section-header {
  font-size: 13px; font-weight: 600; margin-bottom: 8px;
  display: flex; justify-content: space-between; cursor: pointer;
}
.validation-section-header.collapsed + .validation-section-body { display: none; }

.validation-item {
  display: grid; grid-template-columns: 20px 1fr auto auto auto;
  gap: 10px; padding: 6px 10px; align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.validation-item .status-icon { text-align: center; }
.validation-item.warning .status-icon { color: #ffd54f; }
.validation-item.pass .status-icon { color: #8aa680; }
.validation-item .item-info .item-name { color: var(--fg); font-weight: 500; }
.validation-item .item-info .item-key { color: var(--fg-muted); font-family: var(--mono); font-size: 10px; }
.validation-item .item-value { font-family: var(--mono); color: var(--fg); }
.validation-item .item-default { font-family: var(--mono); color: var(--fg-muted); }
.validation-item .item-revert { font-size: 10px; }
```

- [ ] **Step 2: Add Validation Panel HTML**

Inside `<section id="view-configurator">`, at the very bottom (after the existing viewer area), add:

```html
<div class="validation-panel collapsed" id="validation-panel">
  <div class="validation-summary" id="validation-summary">
    <div class="validation-counts" id="validation-counts">
      <span>載入中...</span>
    </div>
    <span class="validation-toggle" id="validation-toggle">[展開 ▲]</span>
  </div>
  <div class="validation-body" id="validation-body"></div>
</div>
```

- [ ] **Step 3: Add Validation Panel JS**

Append to the `<script>` block:

```javascript
// ---- Validation Panel ----
let lastValidationReport = null

function renderValidationSummary(report) {
  lastValidationReport = report
  const container = document.getElementById('validation-counts')
  if (!report) {
    container.innerHTML = '<span style="color:var(--fg-muted);">尚未生成</span>'
    return
  }
  const { guideline_pass, guideline_warning, cns_pass, cns_warning, total_fail } = report.summary
  const totalPass = guideline_pass + cns_pass
  container.innerHTML = `
    <span class="count-pass">✅ ${guideline_pass + cns_pass} PASS</span>
    <span class="count-warning">⚠ ${guideline_warning} WARNING</span>
    <span class="count-cns">🏛 ${cns_pass} CNS 合規</span>
    ${total_fail > 0 ? `<span class="count-fail">❌ ${total_fail} FAIL</span>` : ''}
  `
  renderValidationBody(report)
}

function renderValidationBody(report) {
  const body = document.getElementById('validation-body')
  if (!report) { body.innerHTML = ''; return }

  const warnings = report.items.filter(i => i.status === 'warning')
  const cnsItems = report.items.filter(i => i.source === 'cns')
  const guidelines = report.items.filter(i => i.source !== 'cns' && i.status === 'pass')

  body.innerHTML = `
    <div class="validation-section">
      <div class="validation-section-header">
        <span>⚠ 案子微調 (${warnings.length})</span>
      </div>
      <div class="validation-section-body">
        ${warnings.length === 0 ? '<div style="color:var(--fg-muted);padding:10px;">無微調</div>' : warnings.map(renderValidationItem).join('')}
      </div>
    </div>
    <div class="validation-section">
      <div class="validation-section-header collapsed">
        <span>🏛 CNS 法規合規 (${cnsItems.length})</span>
      </div>
      <div class="validation-section-body">
        ${cnsItems.map(renderValidationItem).join('')}
      </div>
    </div>
    <div class="validation-section">
      <div class="validation-section-header collapsed">
        <span>✅ 設計指引 (${guidelines.length})</span>
      </div>
      <div class="validation-section-body">
        ${guidelines.map(renderValidationItem).join('')}
      </div>
    </div>
  `

  // Wire up collapse toggles
  body.querySelectorAll('.validation-section-header').forEach(h => {
    h.onclick = () => h.classList.toggle('collapsed')
  })
  // Wire up revert buttons
  body.querySelectorAll('[data-revert-key]').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.revertKey
      revertCaseOverride(key)
    }
  })
}

function renderValidationItem(item) {
  const icon = item.status === 'warning' ? '⚠' : (item.status === 'pass' ? '✓' : '❌')
  const revertBtn = item.status === 'warning'
    ? `<button class="rule-action-btn item-revert" data-revert-key="${escapeHtml(item.rule_key)}">revert</button>`
    : ''
  return `
    <div class="validation-item ${item.status}">
      <div class="status-icon">${icon}</div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.rule_name)} <span class="source-badge ${item.source}">${item.source}</span></div>
        <div class="item-key">${escapeHtml(item.rule_key)}</div>
      </div>
      <div class="item-value">${escapeHtml(item.final_value)}</div>
      <div class="item-default">${item.status === 'warning' ? '(預設 ' + escapeHtml(item.team_default_value) + ')' : ''}</div>
      <div>${revertBtn}</div>
    </div>
  `
}

document.getElementById('validation-summary').onclick = () => {
  const panel = document.getElementById('validation-panel')
  panel.classList.toggle('collapsed')
  document.getElementById('validation-toggle').textContent =
    panel.classList.contains('collapsed') ? '[展開 ▲]' : '[收起 ▼]'
}
```

Note: `revertCaseOverride` is defined in Task 10. It will clear `caseOverrideState[key]` and re-call `submitSolve`.

- [ ] **Step 4: Hook existing solve flow to call `renderValidationSummary`**

Find the existing `submitSolve` function or wherever the /api/solve response is processed. Add:

```javascript
// After receiving solve response
renderValidationSummary(data.validation_report)
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -S -m "feat(ui): validation panel at configurator bottom (3 sections + revert)"
```

---

## Task 10: Case override state + commit button

**Files:**
- Modify: `public/index.html`

**Rationale:** The solver already accepts `caseOverride` in the request body. Now the frontend needs to actually ACCUMULATE overrides (from the revert button in Task 9, or future chat in 1d) and SEND them in requests. Plus a "收工存入團隊" button that commits the accumulated override to team defaults via `POST /api/rules/commit`.

- [ ] **Step 1: Add case override state + helper functions**

In the script, add:

```javascript
// ---- Case Override Accumulator ----
const caseOverrideState = {}

function setOverride(key, value) {
  caseOverrideState[key] = value
  updateOverrideCountBadge()
}

function revertCaseOverride(key) {
  delete caseOverrideState[key]
  updateOverrideCountBadge()
  // Re-solve with updated state
  resolveCurrentCase()
}

function clearAllOverrides() {
  for (const k of Object.keys(caseOverrideState)) delete caseOverrideState[k]
  updateOverrideCountBadge()
}

function updateOverrideCountBadge() {
  const count = Object.keys(caseOverrideState).length
  const badge = document.getElementById('override-count-badge')
  const commitBtn = document.getElementById('commit-team-btn')
  if (!badge) return
  if (count === 0) {
    badge.textContent = ''
    commitBtn.disabled = true
  } else {
    badge.textContent = `(${count} 條微調)`
    commitBtn.disabled = false
  }
}

async function resolveCurrentCase() {
  // Find the currently active solver form (Mode A or B) and re-submit with current overrides
  const modeBTab = document.querySelector('[data-mode="B"]')
  const activeMode = modeBTab && modeBTab.classList.contains('active') ? 'B' : 'A'
  const form = document.getElementById(`form-mode-${activeMode.toLowerCase()}`)
  if (form) {
    // Trigger the existing submit handler by calling submitSolve with current state
    const payload = collectSolverFormPayload(activeMode)
    await submitSolve(activeMode, payload)
  }
}

function collectSolverFormPayload(mode) {
  const formId = mode === 'A' ? 'form-mode-a' : 'form-mode-b'
  const form = document.getElementById(formId)
  if (!form) return {}
  const data = {}
  for (const input of form.querySelectorAll('input, select')) {
    if (input.name) data[input.name] = input.value
  }
  return data
}
```

- [ ] **Step 2: Modify `submitSolve` (existing function) to include `caseOverride`**

Find the existing `submitSolve(mode, payload)` function in the script. Add caseOverride to its POST body:

```javascript
// In the body of submitSolve where fetch is called
const body = {
  mode,
  ...payload,
  caseOverride: { ...caseOverrideState },
}
const res = await fetch('/api/solve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
```

- [ ] **Step 3: Add commit button to the configurator UI**

In the sidebar next to the solver form (or wherever feels right — probably near the solve button), add:

```html
<div class="commit-section">
  <div class="override-label">
    案子微調 <span id="override-count-badge"></span>
  </div>
  <button id="commit-team-btn" class="rule-action-btn" disabled>收工存入團隊</button>
</div>
```

CSS:
```css
.commit-section {
  margin-top: 12px; padding: 12px;
  background: var(--bg-panel); border-radius: 4px;
  display: flex; justify-content: space-between; align-items: center;
}
.commit-section button { font-size: 11px; padding: 6px 12px; }
.override-label { font-size: 11px; color: var(--fg-muted); }
#override-count-badge { color: #ffd54f; font-weight: 600; }
```

- [ ] **Step 4: Wire commit button**

```javascript
document.getElementById('commit-team-btn').onclick = async () => {
  const override = { ...caseOverrideState }
  if (Object.keys(override).length === 0) return
  try {
    const res = await fetch('/api/rules/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_override: override }),
    })
    if (!res.ok) {
      const err = await res.json()
      showToast(`提交失敗：${err.message || err.error}`, 'error')
      return
    }
    const data = await res.json()
    clearAllOverrides()
    // Reload rules if on rules tab
    if (rulesState.rules.length > 0) await fetchRules()
    // Re-solve current case with now-empty override
    await resolveCurrentCase()
    showToast(`已提交 ${data.applied.length} 條規則，跳過 ${data.skipped.length} 條`)
    if (data.skipped.length > 0) {
      for (const s of data.skipped) {
        showToast(`跳過 ${s.key}：${s.reason}`, 'error')
      }
    }
  } catch (e) {
    showToast(`錯誤：${e.message}`, 'error')
  }
}
```

- [ ] **Step 5: Smoke test full flow**

```bash
pkill -f "bun src/demo/server" 2>/dev/null; sleep 1
bun src/demo/server.ts > /tmp/m1c-full.log 2>&1 &
disown
sleep 2

# Manual verification required:
# 1. Open http://localhost:3000 — configurator view
# 2. Run Mode B with 500kg, verify validation panel shows all PASS
# 3. Switch to #/rules, edit clearance.side_mm → 250, verify PATCH works
# 4. Back to configurator, run solve again, verify validation panel still shows PASS (it's now the team default)
# 5. Open rules tab, verify clearance.side_mm shows 250
# 6. DELETE cwt.position (non-mandatory), check deleted view, restore it
# 7. Try DELETE on clearance.side_mm (mandatory) — button should be disabled
echo "Manual smoke test: http://localhost:3000"
pkill -f "bun src/demo/server" 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -S -m "feat(ui): case override accumulator + commit button + /api/rules/commit wiring"
```

---

## Task 11: Full test suite + coverage check

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: all pass. Approximate count: 119 + 13 validation + 22 rules CRUD = ~154 tests.

- [ ] **Step 2: Run with coverage**

```bash
bun test --coverage 2>&1 | tail -40
```

Expected: ≥90% line coverage on every src/ file. If anything is below, add targeted tests.

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck 2>&1 | tail -30
```

Expected: No NEW errors (pre-existing errors in src/solver/ are tolerated).

---

## Task 12: Deploy + production smoke tests

- [ ] **Step 1: Deploy Worker**

```bash
wrangler deploy 2>&1 | tail -15
```

Expected: successful deploy, new Version ID.

- [ ] **Step 2: Smoke test all 5 CRUD endpoints on production**

```bash
# GET /api/rules
curl -s https://elevator-configurator.redarch.dev/api/rules | python3 -c "import json, sys; d = json.load(sys.stdin); print('rules:', len(d['rules']), 'cats:', len(d['categories']))"
# Expected: rules: 46 cats: 8

# GET /api/rules/deleted
curl -s https://elevator-configurator.redarch.dev/api/rules/deleted | python3 -c "import json, sys; d = json.load(sys.stdin); print('deleted:', len(d['rules']))"
# Expected: deleted: 0

# PATCH valid
curl -s -X PATCH -H 'Content-Type: application/json' -d '{"value":"250"}' https://elevator-configurator.redarch.dev/api/rules/clearance.side_mm | python3 -c "import json, sys; d = json.load(sys.stdin); print('new value:', d['rule']['value'])"
# Expected: new value: 250

# PATCH reverts (for clean state)
curl -s -X PATCH -H 'Content-Type: application/json' -d '{"value":"200"}' https://elevator-configurator.redarch.dev/api/rules/clearance.side_mm | python3 -c "import json, sys; d = json.load(sys.stdin); print('reverted:', d['rule']['value'])"

# PATCH invalid
curl -s -w "\nhttp=%{http_code}\n" -X PATCH -H 'Content-Type: application/json' -d '{"value":"50"}' https://elevator-configurator.redarch.dev/api/rules/clearance.side_mm
# Expected: http=400

# DELETE mandatory
curl -s -w "\nhttp=%{http_code}\n" -X DELETE https://elevator-configurator.redarch.dev/api/rules/clearance.side_mm
# Expected: http=403

# DELETE non-mandatory + restore
curl -s -X DELETE https://elevator-configurator.redarch.dev/api/rules/cwt.position | python3 -c "import json, sys; d = json.load(sys.stdin); print('deleted')"
curl -s -X POST https://elevator-configurator.redarch.dev/api/rules/cwt.position/restore | python3 -c "import json, sys; d = json.load(sys.stdin); print('restored')"

# POST /api/rules/commit
curl -s -X POST -H 'Content-Type: application/json' -d '{"case_override":{"ghost.key":"1"}}' https://elevator-configurator.redarch.dev/api/rules/commit | python3 -c "import json, sys; d = json.load(sys.stdin); print('applied:', len(d['applied']), 'skipped:', len(d['skipped']))"
# Expected: applied: 0 skipped: 1

# /api/solve with caseOverride (should show real validation report)
curl -s -X POST -H 'Content-Type: application/json' -d '{"mode":"B","rated_load_kg":500,"stops":6,"usage":"passenger","machine_location":"MR","caseOverride":{}}' https://elevator-configurator.redarch.dev/api/solve | python3 -c "import json, sys; d = json.load(sys.stdin); r = d['validation_report']; print('items:', len(r['items']), 'summary:', r['summary'])"
# Expected: items: 46, all pass

# Frontend loads
curl -s -o /dev/null -w "%{http_code}" https://elevator-configurator.redarch.dev/
# Expected: 200
```

If any smoke test fails, STOP and report BLOCKED.

---

## Task 13: PR + merge + pull main

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/milestone-1c-rules-ui-and-api
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --title "feat(m1c): Rules Tab + Validation Panel + CRUD API" --body "$(cat <<'EOF'
## Summary

Milestone 1c of the design guidance system. Ships the user-visible rules management UI + backing CRUD API + real validation report logic.

## Changes

**Backend**
- Real \`buildValidationReport\` in \`src/config/validation.ts\` (replaces stub in solve.ts)
- Rules CRUD handlers in \`src/handlers/rules.ts\` (list / list-deleted / patch / delete / restore / commit)
- \`RulesStore\` interface in \`src/config/load.ts\` + \`D1RulesStore\` + \`InMemoryRulesStore\`
- Worker routes for \`/api/rules/*\` with error → HTTP mapping
- Bun dev server routes + singleton in-memory store

**Frontend**
- Hash routing (\`#/configurator\`, \`#/rules\`, \`#/rules/deleted\`)
- Rules Tab: category-grouped list, filter bar (category / source / status), inline edit with PATCH-on-blur, soft-delete confirmation modal, toast notifications
- Deleted rules sub-view with restore button
- Validation Panel at configurator bottom (collapsed summary + 3 expandable sections + revert buttons)
- Case override accumulator + 「收工存入團隊」 button

**Tests**
- Layer 1 unit tests for \`buildValidationReport\` (~13 tests)
- Layer 3 integration tests for rules CRUD handlers (~22 tests, using InMemoryRulesStore)
- Updated \`solve-snapshot.test.ts\` for new validation report shape

## Test plan

- [x] \`bun test\` all pass (~154 tests)
- [x] \`bun test --coverage\` ≥90% on src/
- [x] Production GET /api/rules → 46 rules + 8 categories
- [x] Production PATCH valid → 200, PATCH invalid → 400
- [x] Production DELETE mandatory → 403, DELETE non-mandatory + restore works
- [x] Production /api/solve validation_report has 46 items
- [x] Production frontend \`/\` loads and shows nav
- [x] Manual smoke: rules tab filters, inline edit, delete modal all work

## Follow-up

Milestone 1d will add AI chat sidebar with Claude Sonnet 4.6 integration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for auto-merge**

Poll every ~30 seconds until merged.

- [ ] **Step 4: Pull main + clean up**

```bash
git checkout main
git fetch origin
git pull --rebase origin main
git branch -d feat/milestone-1c-rules-ui-and-api
git log --oneline -3
```

---

## Milestone 1c Done

At this point:
- Full rules management UI live on production
- 5 CRUD endpoints working in production
- Real validation report on every `/api/solve` response
- ~154 tests passing, ≥90% coverage
- Feature branch merged, main pulled

**Next:** Stage-level review dispatch. After findings are addressed, Milestone 1d (AI chat).
