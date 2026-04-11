# Milestone 1a Review Findings

**Date:** 2026-04-12
**Context:** Final code review of Milestone 1a (PR #8, merged as `b233bea`) found 2 IMPORTANT issues that must be addressed or at minimum tracked for Milestone 1b.

## Findings

### [IMPORTANT] Latent coupling: `src/dxf/plan.ts` has its own hardcoded `frontGap = 150`

**File:** `src/dxf/plan.ts:46`

```typescript
const frontGap = 150  // hardcoded, independent from DEFAULT_CLEARANCE.front_mm
```

**Issue:** `src/solver/clearances.ts` has `DEFAULT_CLEARANCE.front_mm = 150` which the solver uses via `carDepthToShaftDepth()` to compute shaft depth from car depth. `src/dxf/plan.ts` has its OWN `frontGap = 150` used to offset the car from the front wall when drawing the plan view. They currently have the same numeric value but are completely independent variables.

**Impact on Milestone 1b:** When the solver refactor loads `clearance.front_mm` from DB and updates the solver's effective config, `plan.ts` will still use its hardcoded 150 unless also refactored. If a user (or AI) changes `clearance.front_mm` to, say, 200 via the rules tab in Milestone 1c, the solver will correctly compute a shaft depth that gives 200 mm front clearance — but the DXF plan view will draw the car with a 150 mm gap, leaving the door to not align with the front wall. Silent geometry drift.

**Required action for Milestone 1b:**
- `src/dxf/plan.ts` must be included in the config-injection refactor scope (not just `src/solver/*`)
- Specifically: the `drawPlanView()` function signature must accept `config: EffectiveConfig` and read `frontGap` from `config.clearance.front_mm`
- Similar check needed for any other hardcoded numeric in `plan.ts` — see list below

**Other hardcoded constants in `src/dxf/plan.ts` that must be config-ized in 1b:**

```
CWT_THICKNESS_MM       = 120
CWT_WIDTH_MM           = 700
CWT_BACK_OFFSET_MM     = 40
CAR_RAIL_SIZE_MM       = 90
CAR_RAIL_GAP_MM        = 30
CWT_RAIL_SIZE_MM       = 70
DOOR_FRAME_DEPTH_MM    = 100
DOOR_LEAF_THICKNESS_MM = 30
SILL_DEPTH_MM          = 90
frontGap               = 150  ← this one is the stealthy duplicate
```

All 10 of these are already seeded as rules in D1 (cwt.*, rail.*, door.*). The refactor must switch `plan.ts` from reading module-level constants to reading from the passed config.

### [IMPORTANT] `rule_audit` has no foreign key to `rules`

**File:** `migrations/0001_initial_rules_schema.sql:57-69`

**Issue:** `rule_audit.rule_id INTEGER NOT NULL` but no `FOREIGN KEY (rule_id) REFERENCES rules(id)`. D1's SQLite also doesn't enforce `PRAGMA foreign_keys = ON` by default, so even existing FKs aren't strictly enforced at the DB layer.

**Impact:** Audit history queries could return orphan entries if a rule is hard-deleted (v1 uses soft delete, so this is theoretical). But correctness-wise, we should match the schema intent to the runtime enforcement.

**Suggested fix (Milestone 1c or follow-up):** Either:
- (a) Add a new migration `0002_audit_fk.sql` that includes `FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE SET NULL`, or
- (b) Accept as-is (SQLite audit logs commonly skip FKs for insert performance)

Lower priority than the plan.ts coupling issue.

## Minor findings (not blocking)

- The real production D1 UUID is in `wrangler.toml`. It's not a credential but could be noted as "public identifier, not a secret" in a wrangler.toml comment or README for future contributors.
- Generator test coverage for specific values is thin — `clearance.back_mm`, `clearance.front_mm`, `height.overhead.refuge_mm`, etc. don't have specific-value assertions. Milestone 1b's solver integration tests will catch any mismatches, so this is acceptable.

## Milestone 1a Done Status

- [x] D1 database created (`elevator-configurator-db`, id `907ec485-0ee5-47de-9edd-086eb82f8703`)
- [x] Schema migrated locally + production
- [x] 44 baseline rules seeded locally + production
- [x] 41 tests pass (18 solver + 23 generator)
- [x] Production `/api/solve` byte-identical to pre-milestone
- [x] One merged PR (#8, squash `b233bea`)
- [x] Feature branch deleted after merge
- [x] Final code review APPROVED with 0 critical issues

## Next up: Milestone 1b

Before the next implementation plan is written, the two findings above must be carried forward into Milestone 1b's scope. Specifically:

**Milestone 1b plan MUST include:**
1. Refactor `src/dxf/plan.ts` (not just solver) to consume `EffectiveConfig`
2. Replace all 10 hardcoded constants in `plan.ts` with reads from `config.cwt.*`, `config.rail.*`, `config.door.*`, and `config.clearance.front_mm`
3. Add an integration test that verifies solver output AND DXF geometry are consistent when clearances are tweaked

Without these, Milestone 1c's rules tab UI would let users change values that don't actually affect the drawing, creating a confusing silent-failure UX.
