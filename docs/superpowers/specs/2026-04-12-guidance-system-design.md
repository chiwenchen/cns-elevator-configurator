# Design Guidance System — Design Spec

**Date**: 2026-04-12
**Status**: Draft, awaiting user review
**Author**: Brainstorm session on cns-elevator-configurator

## Summary

Build a self-improving design guidance system for the CNS Elevator Configurator. Sales users generate elevator draft drawings, spot issues, and fix them by chatting with an AI that proposes rule changes. Rule changes accumulate as per-case overrides, and can be "committed" to the team default ruleset. All design constants (currently hardcoded across `src/solver/*.ts` and `src/dxf/*.ts`) migrate into a Cloudflare D1 database. A rules management tab lets users browse, edit, soft-delete, and restore rules. A validation panel on every drawing shows which rules are at team default vs. overridden.

Phase 1 ships with zero auth and Claude Sonnet 4.6 as the chat brain. Phase 2 adds real auth, approval workflow, case persistence, and rule versioning.

## Goals

- Move all design constants into DB as first-class rules, visible and editable by sales users
- Enable natural-language rule adjustment via AI chat without bypassing safety constraints
- Keep CNS regulatory constraints untouchable (baseline ranges enforced in code + DB)
- Provide transparency: every drawing shows which rules are default vs. overridden
- Make Phase 2 (approval flow, real auth) a drop-in extension, not a rewrite

## Non-goals (v1)

- Creating new rule keys via UI or AI (schema is fixed in v1)
- Editing ISO 8100-1 Table 6 or other regulatory lookup tables
- Editing solver/DXF formulas themselves (only the constants inside them)
- Multi-user auth with per-user permissions
- Persisting drawing cases across sessions or browser tabs
- Real-time multi-user collaboration
- Approval workflow (Phase 2)
- Real Claude API regression tests in CI (mocked for v1, TODO for Phase 2)

---

## §1 Architecture

### High-level components

```
                          ┌─────────────────────────┐
                          │  Browser (public/*.html) │
                          │                          │
                          │  ┌────────┐  ┌────────┐  │
                          │  │ Solver │  │  AI    │  │
                          │  │  Form  │  │ Chat   │  │
                          │  └───┬────┘  └───┬────┘  │
                          │      │           │       │
                          │  ┌───┴───────────┴───┐   │
                          │  │  Case Override    │   │
                          │  │  (in-memory state)│   │
                          │  └─────────┬─────────┘   │
                          │            │             │
                          │  ┌─────────┴─────────┐   │
                          │  │  DXF Viewer +     │   │
                          │  │  Validation Panel │   │
                          │  └───────────────────┘   │
                          └───────────┬──────────────┘
                                      │
                                      │ HTTPS
                                      ▼
                          ┌─────────────────────────┐
                          │  Cloudflare Worker      │
                          │  src/worker/index.ts    │
                          └───┬──────────┬──────┬───┘
                              │          │      │
                     /api/solve  /api/chat  /api/rules
                              │          │      │
                              ▼          ▼      ▼
            ┌─────────────┐ ┌──────────┐ ┌─────────────┐
            │  solver +   │ │  LLM     │ │  Rules CRUD │
            │  DXF gen    │ │ bridge   │ │  handler    │
            │             │ │          │ │             │
            │  consumes   │ │ Sonnet   │ │  read/write │
            │  effective  │ │ 4.6 via  │ │  D1         │
            │  config     │ │ Anthropic│ │             │
            └──────┬──────┘ └────┬─────┘ └──────┬──────┘
                   │             │              │
                   │             ▼              │
                   │   ┌──────────────────┐    │
                   └──►│ buildEffective   │◄───┘
                       │ Config(          │
                       │   baseline,      │
                       │   teamDefaults,  │
                       │   caseOverride   │
                       │ )                │
                       └────────┬─────────┘
                                │
                                ▼
                       ┌────────────────┐
                       │  D1 database   │
                       │                │
                       │  rules         │
                       │  rule_audit    │
                       │  chat_sessions │
                       │  rule_categories│
                       └────────────────┘
```

### Component responsibilities

| Component | Responsibility | New or changed |
|---|---|---|
| `src/worker/index.ts` | Route dispatcher for the three API groups | changed |
| `src/handlers/solve.ts` | Merge case override + DB rules into effective config, run solver | changed |
| `src/handlers/chat.ts` | LLM bridge + structured rule proposal parsing | new |
| `src/handlers/chat-prompt.ts` | Static system prompt + dynamic context builder | new |
| `src/handlers/rules.ts` | Rules CRUD (list, edit, soft-delete, restore, commit case) | new |
| `src/config/baseline.ts` | Hardcoded CNS baseline ranges (`min/max` constraints per rule key) | new |
| `src/config/effective.ts` | `buildEffectiveConfig()` — merge three layers with baseline validation | new |
| `src/config/types.ts` | Shared types for `TeamRule`, `CaseOverride`, `EffectiveConfig`, `ValidationReport` | new |
| `src/solver/clearances.ts` | Remove module-level constants; helpers take config parameter | changed |
| `src/solver/mode-a.ts`, `mode-b.ts` | Accept `EffectiveConfig` parameter | changed |
| `src/dxf/plan.ts`, `src/dxf/generate.ts` | Accept `EffectiveConfig` parameter | changed |
| `public/index.html` | Add chat sidebar, validation panel, rules tab (hash-routed) | changed |
| `migrations/*.sql` | D1 schema via `wrangler d1 migrations` | new |
| `seeds/generate-baseline.ts` | TS script that emits `seeds/*.sql` from existing hardcoded constants | new |

### API routes (RESTful, three groups)

```
POST /api/solve                    — run solver with merged config
POST /api/chat                     — LLM chat turn; returns structured action
GET  /api/rules                    — list active rules
GET  /api/rules/deleted            — list soft-deleted rules
PATCH /api/rules/:key              — edit team default value
DELETE /api/rules/:key             — soft delete (fails if mandatory=1)
POST /api/rules/:key/restore       — restore soft-deleted rule
POST /api/rules/commit             — flush case override → team default (batch)
```

Worker is stateless. All persistent state lives in D1. Browser holds the per-session case override.

---

## §2 Data Model + Rule Migration

### DDL

```sql
-- Rule definitions (the main table)
CREATE TABLE rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL CHECK (type IN ('number', 'enum')),
  value           TEXT NOT NULL,
  default_value   TEXT NOT NULL,
  unit            TEXT,
  baseline_min    REAL,
  baseline_max    REAL,
  baseline_choices TEXT,                 -- JSON array for enum rules
  category        TEXT NOT NULL,
  mandatory       INTEGER NOT NULL DEFAULT 0 CHECK (mandatory IN (0, 1)),
  source          TEXT NOT NULL CHECK (source IN ('cns', 'industry', 'engineering')),
  deleted_at      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (category) REFERENCES rule_categories(id)
);

CREATE INDEX idx_rules_category ON rules(category) WHERE deleted_at IS NULL;
CREATE INDEX idx_rules_active   ON rules(key) WHERE deleted_at IS NULL;

-- Category metadata for UI grouping
CREATE TABLE rule_categories (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  sort_order    INTEGER NOT NULL
);

-- Audit log
CREATE TABLE rule_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id       INTEGER NOT NULL,
  rule_key      TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  old_value     TEXT,
  new_value     TEXT,
  source        TEXT NOT NULL CHECK (source IN ('migration', 'ai', 'user', 'admin')),
  ai_reasoning  TEXT,
  timestamp     INTEGER NOT NULL
);

CREATE INDEX idx_audit_rule ON rule_audit(rule_id, timestamp DESC);

-- Chat sessions (phase 2 uses; v1 can defer writes)
CREATE TABLE chat_sessions (
  id            TEXT PRIMARY KEY,
  case_snapshot TEXT NOT NULL,
  messages      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active', 'committed', 'abandoned')),
  created_at    INTEGER NOT NULL,
  committed_at  INTEGER
);
```

### What stays out of the rules table

Not every hardcoded constant belongs in DB. Keep these in code:

| Type | Stays in | Why |
|---|---|---|
| Numeric thresholds + defaults (clearance, min shaft, CWT dims, door dims…) | `rules` table | Sales adjustable, AI can modify |
| Categorical choices (CWT position, default door type) | `rules` table (type=enum) | Same |
| **ISO 8100-1 Table 6** (28-row load↔area lookup) | `src/solver/table.ts` | International standard, changing = illegal, per-row DB storage is noise |
| **Formula structures** (overhead = 2000 + 0.035v² + 2000, pit = 1000 + 500 + bonus) | `src/config/baseline.ts` | Formula shape is code; only the *constants inside* become rules (refuge_mm, buffer_mm, bounce_coef) |
| **DXF drawing aesthetics** (break headroom, zigzag gap, top margin) | `src/dxf/generate.ts` | Pure visual, no engineering impact |
| **CNS 13627 hard minimums** | `rules` table with `baseline_min` locked | Visible to users but un-crossable |

### Categories (8 initial)

```sql
INSERT INTO rule_categories (id, display_name, sort_order) VALUES
  ('shaft',     '坑道',       10),
  ('clearance', '間隙',       20),
  ('car',       '車廂',       30),
  ('cwt',       '配重',       40),
  ('rail',      '導軌',       50),
  ('door',      '門',         60),
  ('height',    '高度 / 速度', 70),
  ('usage',     '用途預設',   80);
```

### Rule migration — approximately 55 rules

Full list generated by `seeds/generate-baseline.ts` from existing hardcoded constants. Approximate breakdown:

| Category | Count | Example keys |
|---|---|---|
| shaft | 2 | `shaft.min_width_mm`, `shaft.min_depth_mm` |
| clearance | 3 | `clearance.side_mm`, `clearance.back_mm`, `clearance.front_mm` |
| car | 10 | `car.aspect_ratio.passenger_w`, `car.aspect_ratio.accessible_d`, `car.height_mm.passenger`, `car.height_mm.bed`, … |
| cwt | 4 | `cwt.position` (enum), `cwt.width_mm`, `cwt.thickness_mm`, `cwt.back_offset_mm` |
| rail | 3 | `rail.car.size_mm`, `rail.car.gap_mm`, `rail.cwt.size_mm` |
| door | 7 | `door.frame_depth_mm`, `door.leaf_thickness_mm`, `door.sill_depth_mm`, `door.default_width_mm.passenger`, `door.default_width_mm.accessible`, … |
| height | 8 | `height.floor_default_mm`, `height.overhead.refuge_mm`, `height.overhead.bounce_coef`, `height.pit.refuge_mm`, … |
| usage | ~15 | Accessible minimum dims (from CNS 13627), bed minimum depth, etc. |

The precise list will be finalized during the `generate-baseline.ts` implementation (Milestone 1a).

### Source × Mandatory matrix

Two orthogonal axes determine what users can do to a rule:

- **`source`** — where did this value come from?
  - `cns` — CNS / ISO / EN regulation (~10 rules). Changing may create legal liability.
  - `industry` — Taiwan/Japan industry convention (~20 rules). Non-standard if changed, engineers will question.
  - `engineering` — internal defaults, craft choices (~25 rules). Adjust freely within baseline.
- **`mandatory`** — does the solver structurally require this rule?
  - `1` — solver cannot run without it; cannot be soft-deleted; can still be value-edited within baseline range.
  - `0` — solver has a fallback; can be soft-deleted; free to adjust.

| source | mandatory | Can user edit value? | Can user delete? |
|---|---|---|---|
| cns | 1 | Yes, within `baseline_min/max` (often min-locked) | No |
| cns | 0 | Yes, within baseline | Yes |
| industry | 1 | Yes, within baseline | No |
| industry | 0 | Yes | Yes |
| engineering | 1 | Yes, generous baseline | No |
| engineering | 0 | Yes | Yes |

### Rule row examples

```json
// Example 1: enum, engineering source, optional (deletable)
{
  "key": "cwt.position",
  "name": "配重位置",
  "type": "enum",
  "value": "back_left",
  "default_value": "back_left",
  "baseline_choices": ["back_left", "back_center", "back_right", "side_left", "side_right"],
  "category": "cwt",
  "mandatory": 0,
  "source": "engineering"
}

// Example 2: number, engineering source, mandatory (not deletable)
{
  "key": "clearance.side_mm",
  "name": "車廂側向間隙",
  "type": "number",
  "value": "200",
  "default_value": "200",
  "unit": "mm",
  "baseline_min": 150,
  "baseline_max": 400,
  "category": "clearance",
  "mandatory": 1,
  "source": "engineering"
}

// Example 3: number, CNS source, mandatory (locked minimum)
{
  "key": "door.default_width_mm.accessible",
  "name": "無障礙電梯預設門寬",
  "type": "number",
  "value": "900",
  "default_value": "900",
  "unit": "mm",
  "baseline_min": 900,
  "baseline_max": 1400,
  "category": "door",
  "mandatory": 1,
  "source": "cns",
  "description": "CNS 13627 規定無障礙電梯門淨寬不得小於 900 mm"
}
```

### Per-usage variants are separate rows

Rules that vary by usage (passenger / freight / bed / accessible) become separate rows with distinct keys, e.g., `car.height_mm.passenger`, `car.height_mm.bed`. Rationale: simpler SQL queries, clearer validation, trivial UI grouping. JSON-in-value is explicitly rejected.

---

## §3 AI Chat Contract

The LLM is Claude Sonnet 4.6 via Anthropic API (`ANTHROPIC_API_KEY` as Wrangler secret). The prompt is the safety boundary of the system — not a separate nicety.

### Two-layer prompt structure

```
Static system prompt (version-controlled in src/handlers/chat-prompt.ts)
  • Role definition
  • Rule schema column semantics
  • Safety tier explanation (cns / industry / engineering)
  • Mandatory flag meaning
  • Allowed actions (tool use enumeration)
  • Forbidden actions list
  • Response language + style
  ~1200 tokens, rarely changes

Dynamic context (per-request)
  • Active rules dump (compact format, ~55 rows, ~1100 tokens)
  • Case input (solver Mode A/B input)
  • Current case override state
  • Recent N chat history turns
  ~800-1500 tokens
```

### System prompt (outline — full text in `src/handlers/chat-prompt.ts`)

Key sections:

1. **Role** — "Design guideline assistant for CNS Elevator Configurator, used by sales team at a Taiwanese elevator manufacturer"
2. **Forbidden** — no code writing, no drawing, no off-topic, no translation
3. **Rule schema table** — every column explained with meaning and constraints
4. **Safety tiers** — explicit escalation behavior per `source` value:
   - `cns` — always confirm user understands before proposing changes; remind of baseline ranges
   - `industry` — warn user this is non-standard practice
   - `engineering` — change freely within baseline
5. **Mandatory / deletable** — `mandatory=1` means solver structurally requires it; never propose deletion
6. **Allowed actions** — enumerated, tool-use format
7. **Forbidden actions** — explicit list (no new keys, no Table 6 edits, no baseline violations, no mandatory deletion, no free-form actions)
8. **Language** — reply in Traditional Chinese; internal reasoning in English is OK

### Tool definitions (strict JSON schema via Anthropic tool use)

```typescript
const CHAT_TOOLS = [
  {
    name: "propose_update",
    description: "Propose changing the value of an existing rule",
    input_schema: {
      type: "object",
      required: ["key", "new_value", "reasoning"],
      properties: {
        key: { type: "string" },
        new_value: { type: "string" },
        reasoning: { type: "string" }
      }
    }
  },
  {
    name: "propose_soft_delete",
    description: "Propose soft-deleting a mandatory=0 rule",
    input_schema: { /* ... */ }
  },
  {
    name: "ask_clarification",
    description: "Ask user a clarifying question before proposing changes",
    input_schema: {
      type: "object",
      required: ["question", "choices"],
      properties: {
        question: { type: "string" },
        choices: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "out_of_scope",
    description: "Explain that the request cannot be handled",
    input_schema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" } }
    }
  }
]
```

`tool_choice: { type: "any" }` forces Claude to always emit a tool call.

### Compact rules dump format

To save tokens, the dynamic rules context uses a terse single-line-per-rule format:

```
RULES (key | type | value | min-max/choices | src | mand | name)
cwt.position | enum | back_left | [back_left,back_center,back_right,side_left,side_right] | eng | 0 | 配重位置
clearance.side_mm | num | 200 | 150-400mm | eng | 1 | 車廂側向間隙
door.default_width_mm.accessible | num | 900 | 900-1400mm | cns | 1 | 無障礙電梯預設門寬
...
```

~80 chars × 55 rules ≈ 1100 tokens.

### Prompt version control

- `SYSTEM_PROMPT_VERSION` constant in `chat-prompt.ts`, bumped on every change
- Version written into `rule_audit.ai_reasoning` when commit happens via AI
- Prompt stays in code (not DB) — security + code review + rollback safety

### Safety tests

Four categories of regression tests (see §7):

1. Refuse to propose values below `baseline_min`
2. Warn when user asks to change `source=cns` rule
3. Refuse to delete `mandatory=1` rule
4. Correctly classify ambiguous requests and ask clarifying questions

**v1 uses mocked Claude responses.** Real API regression tests are deferred to Phase 2 (see `docs/TODO.md` entry).

### Cost budget

- Per chat turn: ~3000 input + 800 output tokens ≈ $0.021
- Demo usage (50 turns/day): ~$30/month
- Small team production (200 turns/day): ~$120/month

---

## §4 Effective Config + Solver Integration

### Merge order

```
POST /api/solve
  ↓
loadActiveRules(db)              # SELECT * FROM rules WHERE deleted_at IS NULL
  ↓
buildEffectiveConfig(team, override)
  ↓
solveModeA/B(input, config)
  ↓
generateElevatorDXF(design, config)
  ↓
buildValidationReport(design, config, rules, override)
  ↓
analyzeGeneratedDxf(dxf, ...)    # existing analysis pass
  ↓
{ design, dxf_string, analysis, validation_report }
```

Rules are read from D1 **every request**. No caching (see design decision log: rejected 60s per-isolate cache as premature optimization given D1 free tier and current scale).

### Core types

```typescript
// src/config/types.ts

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

export interface CaseOverride {
  [key: string]: string  // flat key → new value map
}

export interface EffectiveConfig {
  shaft:     { min_width_mm: number; min_depth_mm: number }
  clearance: { side_mm: number; back_mm: number; front_mm: number }
  car:       { aspect_ratio: Record<Usage, { w: number; d: number }>
             ; height_mm: Record<Usage, number> }
  cwt:       { position: CwtPosition
             ; width_mm: number
             ; thickness_mm: number
             ; back_offset_mm: number }
  rail:      { car_size_mm: number; car_gap_mm: number; cwt_size_mm: number }
  door:      { frame_depth_mm: number
             ; leaf_thickness_mm: number
             ; sill_depth_mm: number
             ; default_width_mm: Record<Usage, number>
             ; default_type: Record<Usage, DoorType> }
  height:    { floor_default_mm: number
             ; overhead: OverheadFormulaParams
             ; pit: PitFormulaParams }
  usage_constraints: {
    accessible_min_car_width_mm: number
    accessible_min_car_depth_mm: number
    bed_min_car_depth_mm: number
    // ...
  }
}

export type CwtPosition = 'back_left' | 'back_center' | 'back_right' | 'side_left' | 'side_right'
```

### `buildEffectiveConfig` contract

```typescript
// src/config/effective.ts

export class BaselineViolationError extends Error {
  constructor(
    public readonly ruleKey: string,
    public readonly attemptedValue: string,
    public readonly reason: string,
    public readonly baseline: { min?: number; max?: number; choices?: string[] },
  ) {
    super(`Baseline violation on ${ruleKey}: ${reason}`)
  }
}

export function buildEffectiveConfig(
  teamRules: TeamRule[],
  caseOverride: CaseOverride,
): EffectiveConfig {
  // For each rule:
  //   1. final_value = caseOverride[key] ?? rule.value
  //   2. Check baseline constraints (number: min/max; enum: choices)
  //   3. Parse string → typed (parseFloat for number)
  //   4. Group into structured EffectiveConfig namespace
  //
  // Throw BaselineViolationError on any violation (fail fast).
  // Silently ignore case override keys that don't exist in rules (stale client state).
}
```

### Solver refactor pattern

**Before** (current state):
```typescript
// src/solver/clearances.ts
const DEFAULT_CLEARANCE: ShaftClearance = {
  side_each_mm: 200, back_mm: 250, front_mm: 150,
}

// src/solver/mode-a.ts
const MIN_SHAFT_WIDTH_MM = 1400
export function solveModeA(input: ModeAInput): ElevatorDesign { /* reads const */ }
```

**After**:
```typescript
// src/solver/clearances.ts — module-level const removed

// src/solver/mode-a.ts
export function solveModeA(
  input: ModeAInput,
  config: EffectiveConfig,
): ElevatorDesign {
  if (input.width_mm < config.shaft.min_width_mm) { /* ... */ }
  const side = config.clearance.side_mm
  // ...
}
```

### Validation Report

```typescript
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
  status: 'pass' | 'warning' | 'fail'
  status_reason: string
}

export interface ValidationReport {
  summary: {
    guideline_pass: number
    guideline_warning: number
    cns_pass: number
    cns_warning: number     // should always be 0
    total_fail: number      // should always be 0 (baseline violation throws earlier)
  }
  items: ValidationItem[]
}
```

Logic:
- `status = 'warning'` if `caseOverride[key]` is present and differs from `rule.value`
- `status = 'pass'` otherwise
- `status = 'fail'` is reserved for defensive error paths (shouldn't reach UI normally)

---

## §5 Chat Flow + API Contracts

### Frontend state machine

```
IDLE → CHAT_OPEN → THINKING → (response routing)
  → ask_clarification → CHAT_OPEN (with multi-choice)
  → propose_update → AWAITING_CONFIRM → user accepts/rejects
      → accept: apply to caseOverride, refetch /api/solve, back to CHAT_OPEN
      → reject: discard action, back to CHAT_OPEN
  → propose_soft_delete → AWAITING_CONFIRM (same)
  → out_of_scope → CHAT_OPEN (show message)

CHAT_OPEN → user clicks "收工存入團隊" → COMMITTING
  → POST /api/rules/commit with accumulated case override
  → success: case override cleared, team default updated, back to CHAT_OPEN / IDLE
```

### POST /api/chat contract

```typescript
interface ChatRequest {
  session_id: string
  messages: ChatMessage[]            // full history (stateless server)
  case_context: {
    solver_input: ModeAInput | ModeBInput
    current_case_override: CaseOverride
  }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tool_call?: ToolCall
  timestamp: number
}

interface ChatResponse {
  assistant_message: string          // Traditional Chinese
  action: ChatAction                 // always present
  session_id: string
  prompt_version: string
}

type ChatAction =
  | { type: 'ask_clarification';   question: string; choices: string[] }
  | { type: 'propose_update';      rule_key: string; current_value: string; new_value: string; reasoning: string }
  | { type: 'propose_soft_delete'; rule_key: string; reasoning: string }
  | { type: 'out_of_scope';        message: string }
  | { type: 'none' }
```

### Rules CRUD contracts

```typescript
// GET /api/rules
interface ListRulesResponse {
  rules: TeamRule[]
  categories: RuleCategory[]
}

// PATCH /api/rules/:key
interface PatchRuleRequest { value: string; reason?: string }
interface PatchRuleResponse { rule: TeamRule }
// audit_id not returned in v1; audit history queryable separately (phase 2)
// 400: baseline violation | 404: not found or deleted

// DELETE /api/rules/:key
interface DeleteRuleResponse { rule: TeamRule }
// 403: mandatory=1 | 404: not found or already deleted

// POST /api/rules/:key/restore
interface RestoreRuleResponse { rule: TeamRule }

// POST /api/rules/commit
interface CommitRequest {
  session_id: string
  case_override: CaseOverride
}
interface CommitResponse {
  applied: Array<{ key: string; old_value: string; new_value: string }>
  skipped: Array<{ key: string; reason: 'rule_deleted' | 'baseline_violation' | 'unchanged' }>
}
```

Commit is **partial-apply** — individual rule violations don't fail the whole batch. Skipped rules are returned for UI to display.

### Three-layer baseline enforcement

1. **LLM in-prompt** (weakest) — Claude is instructed to never propose baseline violations. Behavioral, not enforced.
2. **`/api/chat` server validation** — after Claude returns a tool call, re-validate against baseline. Malformed / violating responses are downgraded to `ask_clarification`.
3. **Write-time validation** (`/api/solve`, `/api/rules/*`) — every path that touches state runs `assertValueWithinBaseline`. This is the integrity floor; even with compromised layers 1+2, DB cannot be poisoned.

All three layers are required. Layer 3 is non-negotiable (protects against client tampering).

### Frontend state shape

```typescript
interface AppState {
  modeAForm: ModeAInput
  modeBForm: ModeBInput
  activeMode: 'A' | 'B'
  currentDesign: ElevatorDesign | null
  currentDxf: string | null
  currentValidationReport: ValidationReport | null
  caseOverride: CaseOverride
  chatSessionId: string | null
  chatMessages: ChatMessage[]
  chatStatus: 'idle' | 'thinking' | 'awaiting_confirm'
  pendingAction: ChatAction | null
  chatSidebarOpen: boolean
  validationPanelExpanded: boolean
  currentPage: 'configurator' | 'rules'
}
```

v1 does not persist `caseOverride` or `chatMessages` to localStorage. A page refresh clears them. Explicit decision for simplicity.

---

## §6 UI: Validation Panel + Rules Tab + Chat Sidebar

### Configurator page layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ CNS 電梯配件器  Solver Mode B — 需求 → 空間      [資料來源 ▼]  [★ AI]     │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  [Solver Input]   [DXF Viewer]                        [Sidebar summary]   │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│ ▼ ✅ 37 條設計指引 PASS · ⚠ 2 條 WARNING · 🏛 10 條 CNS 合規   [展開]     │
└───────────────────────────────────────────────────────────────────────────┘
```

Clicking the AI star button slides the chat sidebar in from the right. Chat is full-height on the right side, pushing the solver form + DXF viewer to accommodate.

### Validation panel expanded

Three sections in priority order:
1. **⚠ 案子微調** (warnings, expanded by default) — one row per overridden rule
2. **🏛 CNS 法規合規** (collapsed by default)
3. **✅ 設計指引** (collapsed by default, grouped by category)

Each row shows: status icon, name, key, current value, source badge (`🏛 cns` / `🔧 industry` / `⚙ engineering`), team default value, action buttons. Warning rows have a `[revert]` button that clears the case override for that key.

### Rules tab (hash-routed: `#/rules`)

```
規則管理                                    [查看已刪規則] [+ 新增]*
─────────
[搜尋規則 key / 名稱...]
類別篩選: [全部] [坑道] [間隙] [車廂] [配重] [導軌] [門] [高度] [用途]
來源篩選: [全部] [🏛 CNS] [🔧 產業] [⚙ 工程]
狀態篩選: [啟用] [已刪除]

▼ 坑道 (2)
  🔒 shaft.min_width_mm — 坑道最小寬度
     🔧 industry · mandatory · 1400 mm (範圍 1400-)
     [1400] mm   [重設預設值] [刪除 🚫]

▼ 配重 (4)
  cwt.position — 配重位置
  ⚙ engineering · 可刪 · enum
  [back_left ▼]   [重設預設值] [刪除]
  選項: back_left · back_center · back_right · side_left · side_right
```

- **[+ 新增]** is disabled in v1 with a tooltip explaining the schema is locked
- Editing a value PATCHes immediately on blur; UI badge flashes "已更新"
- Soft delete goes through a confirmation modal listing: rule info, consequences, restore path, audit note

### Deleted rules page

List of rules with `deleted_at IS NOT NULL`. Each row shows deletion time, actor (v1: always `(anonymous)`), reason (v1: always empty), last value before deletion, and a `[還原]` button.

### Chat sidebar — propose action card

When AI emits `propose_update`, the chat renders a card with:
- The rule key and source badge
- A `old_value → new_value` diff
- Explanation text
- `[✕ 不要]` / `[✓ 套用並重畫]` buttons

Accept → merge into `caseOverride`, call `/api/solve` with new override, update viewer + validation panel. Reject → discard action, stay in chat.

### Design tokens

Colors match the existing DXF layer palette for visual continuity:

| Purpose | Color | DXF layer origin |
|---|---|---|
| CNS compliance badge | `#e7e9ec` | SHAFT |
| Engineering default badge | `#8aa680` | STOP |
| Industry convention badge | `#ffd54f` | DIMS |
| WARNING state | `#e8734e` | CAR |
| Delete danger | `#ba68c8` | DOOR |
| Active / primary | `#4f8ff0` | RAIL_CAR |

---

## §7 Error Handling + Testing

### Error scenarios (user-visible)

| # | Scenario | Detection | User sees | System behavior |
|---|---|---|---|---|
| 1 | D1 outage | `loadActiveRules` throws | 500 + "系統規則載入失敗，請稍後重試" | All three API groups return 500 |
| 2 | Case override violates baseline | `buildEffectiveConfig` throws `BaselineViolationError` | 400 + specific message | Frontend pinpoints violating rule, offers [revert] |
| 3 | NonStandardError (shaft too small, etc.) | Solver internal throw | 400 + existing `{error, reason, suggestion}` | Unchanged from today |
| 4 | Anthropic API failure | `callAnthropic` throws | Chat bubble: "AI 暫時無法回應，請稍後再試" | `/api/chat` returns 503; `/api/solve` unaffected |
| 5 | Malformed LLM tool call | `parseClaudeResponse` fails | Chat bubble: "AI 誤解了，你能換個方式說嗎？" | Downgrade to `out_of_scope` |
| 6 | Stale case override key | `buildEffectiveConfig` skips | (silent) | Console warn, no throw |
| 7 | Type-wrong case override value | `assertValueWithinBaseline` | 400 baseline_violation | Same as #2 |
| 8 | DXF generation crash | `generateElevatorDXF` throws | 500 + "圖面生成失敗" | Log stack trace, rollback frontend to previous drawing |
| 9 | Validation report build fails | try/catch wrapper | Drawing renders but panel shows "驗證報告生成失敗" | Drawing unaffected, report optional |
| 10 | Partial commit failure | D1 `batch()` rejects some | 200 with `skipped` list | Frontend shows "部分規則未成功寫入" with expand |
| 11 | DELETE on mandatory rule | Handler check | 403 + message | UI button should be disabled anyway; this is backend safety net |

### Unified error response format

```typescript
interface ErrorResponse {
  error: string                  // machine code
  message: string                // Chinese, user-facing
  details?: Record<string, any>
  trace_id?: string              // from CF-Ray header
}
```

### Testing strategy (four layers)

**Layer 1 — Pure unit tests** (no DB, no LLM, no network)
- Target: `buildEffectiveConfig`, `parseRuleRow`, `assertValueWithinBaseline`, `buildValidationReport`
- Coverage target: 95%+
- Run: `bun test` on every PR

**Layer 2 — Solver integration tests** (config injected, no DB)
- Target: `solveModeA`, `solveModeB`, `generateElevatorDXF`
- Existing 18 tests refactored to inject fixture config
- New tests covering config variations (e.g., stricter clearance affects car dims)
- Coverage target: 80%+
- Run: `bun test` on every PR

**Layer 3 — DB integration tests** (real local D1, no LLM)
- Target: Rules CRUD handlers, audit log writes, soft delete, commit batch
- Uses `wrangler d1 execute --local` for in-memory SQLite
- Coverage target: 70%+
- Run: `bun test` on every PR

**Layer 4 — Mocked chat tests** (no real Claude)
- Target: `/api/chat` handler — prompt composition, response parsing, action validation, safety regressions
- Uses a mock `callAnthropic` that returns predefined tool-call responses
- Covers: happy paths, ask_clarification, propose_update, baseline-violating proposal downgrade, malformed response fallback
- Coverage target: 60%+
- Run: `bun test` on every PR

**Deferred to Phase 2**: Real Claude API regression tests. Tracked in `docs/TODO.md` with cost estimate (~$0.05-0.10 per run) and trigger plan (weekly cron + manual on prompt-related PRs). Needs `ANTHROPIC_API_KEY` in CI secrets.

---

## §8 Migration Plan + Phase 2 Roadmap

### Implementation workflow (user-mandated)

**All milestones below MUST ship as sequential small PRs.** Concretely:

1. Branch from latest main: `git checkout main && git pull --rebase && git checkout -b feat/<milestone-slug>`
2. Implement exactly one milestone
3. Open PR (passes through branch protection rulesets: auto-approve → CI `test` → auto-merge)
4. After merge: `git checkout main && git pull --rebase`
5. Only then start the next milestone on a fresh branch

Do not parallelize milestones across branches. Do not squeeze multiple milestones into one PR. Do not skip the pull-main step between milestones. This rule pairs with the technical safeguard (branch protection installed by `github-repo-init` on 2026-04-12) and is tracked in user memory.

### Milestone 1a — DB foundation (no behavior change)

Goal: D1 created, schema applied, baseline seeded. Existing `/api/solve` behavior unchanged.

Tasks:
1. Add `[[d1_databases]]` binding to `wrangler.toml`
2. `wrangler d1 create elevator-configurator-db`
3. `wrangler d1 migrations create initial_rules_schema` → fill `migrations/0001_initial_rules_schema.sql`
4. Build `seeds/generate-baseline.ts` to import existing constants and emit INSERT SQL
5. Run generator → `seeds/0001_baseline_rules.sql` (checked in)
6. Apply migrations + seed to local dev D1
7. Apply to production D1 (worker doesn't read from D1 yet, so this is pre-wiring)

Done when: `SELECT COUNT(*) FROM rules` returns ~55; all existing solver tests still pass; production `/api/solve` byte-identical to pre-milestone.

### Milestone 1b — Solver refactor (consumes D1, no UI change)

Goal: Solver takes `EffectiveConfig`; `/api/solve` handler loads rules from D1, builds config, runs solver. UI unchanged.

Tasks:
1. Create `src/config/{types,effective,baseline}.ts`
2. Implement `loadActiveRules(db)` (direct read, no cache)
3. Implement `buildEffectiveConfig` + `BaselineViolationError`
4. Refactor `solveModeA`, `solveModeB`, `generateElevatorDXF`, `plan.ts` to accept config parameter
5. Remove module-level constants from `src/solver/clearances.ts`
6. Rewrite `src/handlers/solve.ts` as orchestrator
7. Add optional `caseOverride` field to `/api/solve` request body (frontend sends empty `{}` for now)
8. Refactor existing 18 solver tests to inject fixture config
9. Add Layer 1 unit tests for `buildEffectiveConfig` (~15 tests)
10. Validation report returns stub `{ summary: empty, items: [] }` (real logic in Milestone 1c)

Done when: All existing solver tests pass; new unit tests pass; production `/api/solve` output is byte-identical (snapshot test); all fixture configs match seeded DB values.

### Milestone 1c — Rules tab + validation panel (CRUD + UI, no chat)

Goal: Users can list, edit, soft-delete, restore rules via UI. Validation panel shows real state. No AI chat yet.

Tasks:
1. Implement `/api/rules` endpoints: GET list, GET deleted, PATCH, DELETE, POST restore
2. Implement `buildValidationReport` with real logic (replace stub)
3. Add hash routing (`#/configurator`, `#/rules`) to frontend
4. Build Rules Tab UI: category grouping, search, source/status filters, inline edit, soft delete confirmation modal
5. Build Validation Panel: collapsed bar + three-section expansion
6. Build case override in-memory state (cleared on page refresh) + sidebar warning count + [revert] buttons
7. Add "收工存入團隊" button + `POST /api/rules/commit` handler with partial-apply semantics
8. Layer 3 D1 integration tests (~15 tests)

Done when: Manual E2E passes for full flow of "change cwt.position via UI → see drawing update → commit → new default takes effect on next case"; `mandatory=1` rules have disabled delete buttons; soft delete + restore round-trip works.

### Milestone 1d — AI chat integration

Goal: Chat sidebar functional with Claude Sonnet 4.6; three-layer baseline enforcement verified.

Tasks:
1. Create `src/handlers/chat-prompt.ts` with static system prompt + `buildDynamicContext`
2. Create `src/handlers/chat.ts` with Anthropic API client, tool call parsing, action validation
3. `wrangler secret put ANTHROPIC_API_KEY`
4. Frontend AI star button + sidebar + state machine (IDLE / CHAT_OPEN / THINKING / AWAITING_CONFIRM)
5. Propose_update card with Accept/Reject buttons
6. Layer 4 mocked chat tests (~20 tests)
7. Add `docs/TODO.md` entry for real Claude regression tests

Done when: Manual E2E flow "配重位置應該在中間 → AI asks clarification → user picks → AI proposes → Accept → regenerate with new override" passes; malicious request for `clearance.side_mm = 50` is rejected at all three layers; DevTools injection of bad override is caught by `/api/solve` Layer 3.

### Production deployment

Each milestone independently deployable:
- **1a**: Deploy after local verification; worker doesn't read D1 yet so no behavior change
- **1b**: Deploy to production; monitor for 1-2 days looking for baseline_violation false positives
- **1c**: Deploy new UI; chat still hidden
- **1d**: Add secret, deploy, enable chat button

Each milestone is independently revertable via `wrangler rollback`. D1 schema changes in Phase 1 are all additive (no column drops, no destructive migrations).

### Phase 2 roadmap (explicit out of scope for v1)

1. **Real auth** (Cloudflare Access or magic link). v1 leaves `rule_audit.source` with enum including `user`/`admin`; Phase 2 adds `actor_email` column.
2. **Approval workflow**. v1 schema is additive-compatible: add `pending_value`, `status = 'draft' | 'approved'` columns to `rules`; extend commit flow to write to draft first.
3. **Case persistence**. v1 has `chat_sessions` table in schema but doesn't write to it. Phase 2 flushes case overrides + chat history to DB on commit for later retrieval.
4. **Real Claude API regression tests**. Mock layer in v1 abstracted into an interface; Phase 2 swaps implementation.
5. **Rule versioning / diff view**. `rule_audit` table is complete in v1; Phase 2 adds timeline UI.
6. **Dynamic rule key creation**. v1 schema rejects; Phase 2 adds schema migration UI + dynamic LLM prompt generation.
7. **Multi-tenant**. All tables need `tenant_id` column; out of v1 scope.
8. **Audit UI**. Backend audit data is complete in v1; Phase 2 adds a history sub-page in Rules Tab.

### Definition of Done (complete v1)

- [ ] ~55 rules seeded in production D1
- [ ] Existing 18 solver tests pass + Layer 1 unit tests (~15) pass
- [ ] Layer 3 D1 integration tests (~15) pass
- [ ] Layer 4 mocked chat tests (~20) pass
- [ ] Manual E2E flow verified: generate → chat → propose → accept → refresh → commit → new case sees updated default
- [ ] **Full QA pass via `/qa` skill** — Playwright-driven browser testing of all v1 flows on the deployed Worker before claiming v1 done
- [ ] `docs/TODO.md` lists all Phase 2 / deferred items with context
- [ ] Each milestone has its own merged PR with independent revert commit
- [ ] All D1 schema changes are backward-compatible (no destructive migrations)

---

## Design Decision Log

Decisions taken during the brainstorm (2026-04-12), with rationale:

1. **Rule scope = Option A (numeric + enum only)**. Rejected complex formula expressions and condition rules as v1 scope creep. Formulas stay in code; only their constants become rules.
2. **Three-layer rule merging**: baseline (code) + team default (DB) + case override (browser). Baseline supplies `min/max` constraints; case override is a staging area before commit.
3. **Zero auth** for v1. Phase 2 adds real auth (Cloudflare Access) in estimated one day. All tables are forward-compatible.
4. **Claude Sonnet 4.6** as the chat brain. Explicit user preference for quality over cost. Monthly cost estimate ~$30 demo / ~$120 small-team prod.
5. **Pre-defined rule key space**. AI can only modify existing keys, never invent new ones. Schema is version-controlled.
6. **D1 + normalized relational schema**. Rejected KV-only and JSON-blob schemas. Audit trail, soft delete, and phase 2 approval workflow all benefit from SQL.
7. **RESTful API split** into three groups. Rejected RPC-style single endpoint.
8. **Migrations in `migrations/`, seeds in `seeds/`**. Schema changes add new files, never edit old. Seeds generated by TS script from existing constants for single source of truth.
9. **Two-axis rule classification**: `source` (cns/industry/engineering) + `mandatory` (0/1). Rejected merging them — they track different things.
10. **Per-usage variants as separate rows**. Rejected JSON-in-value. Cleaner queries and UI.
11. **Soft delete with `deleted_at` timestamp**. `mandatory=1` rules cannot be deleted. Explicit confirmation modal required.
12. **No caching**. Every `/api/solve` reads D1 directly. 60-second per-isolate cache was initial proposal but rejected as premature optimization.
13. **Three-layer baseline enforcement**: LLM prompt + chat server parsing + write-time validation. Layer 3 is non-negotiable.
14. **Stateless chat server, client-held history**. Rejected Durable Object for chat state.
15. **Commit is partial-apply**. Failed rules appear in `skipped` list; successful rules still apply.
16. **Prompt version-controlled in code, not DB**. Security + code review safety.
17. **Real Claude API regression tests deferred**. Mocked for v1. Tracked in `docs/TODO.md`.
18. **Hash routing** (`#/configurator`, `#/rules`) instead of SPA router.
19. **Edit values immediately on blur** (no explicit save button).
20. **`[+ 新增]` button disabled in v1** — schema is locked.
21. **Validation panel at viewer bottom** (collapsed bar, expandable).
22. **Implementation workflow**: sequential small PRs, merge + pull main between milestones.

---

## Open questions / TBD

(None at time of writing. All major decisions resolved during brainstorm.)

## Next step

Hand off to `writing-plans` skill to produce an implementation plan for Milestone 1a.
