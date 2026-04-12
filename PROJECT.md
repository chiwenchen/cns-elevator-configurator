# PROJECT.md — 開發者技術文件

面向開發者的技術總結。產品使用說明請見 [README.md](./README.md)。

---

## 架構

```
Browser (public/index.html)
  ├── Solver Form (Mode A / Mode B)
  ├── DXF Viewer (SVG 渲染)
  ├── AI Chat Sidebar (Claude Sonnet 4.6)
  ├── Validation Panel
  ├── Rules Tab (#/rules)
  └── Case Override (in-memory state)
        │
        │ HTTPS
        ▼
Cloudflare Worker (src/worker/index.ts)
  ├── POST /api/solve    → solver + DXF gen + validation
  ├── POST /api/chat     → Anthropic Messages API bridge
  ├── GET  /api/rules    → list active rules
  ├── GET  /api/rules/deleted
  ├── PATCH /api/rules/:key
  ├── DELETE /api/rules/:key
  ├── POST /api/rules/:key/restore
  └── POST /api/rules/commit
        │
        ▼
D1 Database (SQLite at edge)
  ├── rules (46 rows)
  ├── rule_audit
  ├── rule_categories (8 rows)
  └── chat_sessions (Phase 2)
```

## 技術棧

| 層 | 技術 | 理由 |
|---|---|---|
| Runtime | Bun 1.3+ | 比 Node 快, 內建 test runner |
| Language | TypeScript 5.9+ | 型別安全 |
| Testing | `bun test` | 內建, 不需 jest/vitest |
| Deployment | Cloudflare Workers | 邊緣運算, 全球延遲 < 50ms |
| Database | Cloudflare D1 (SQLite) | 零成本 free tier, 與 Worker 同一 data center |
| AI | Anthropic Claude Sonnet 4.6 | tool use 支援, 繁體中文品質高 |
| Frontend | Vanilla JS + CSS | 單一 HTML 檔, 無框架依賴 |
| DXF | dxf-writer / dxf-parser | DXF 圖紙生成 + 建築圖解析 |

## 目錄結構

```
src/
├── config/
│   ├── types.ts          # TeamRule, EffectiveConfig, ValidationReport 等核心型別
│   ├── effective.ts      # buildEffectiveConfig() — 三層規則合併 + baseline 驗證
│   ├── validation.ts     # buildValidationReport() — 每條規則 PASS/WARNING 狀態
│   ├── load.ts           # RulesLoader/RulesStore 介面 + D1/InMemory 實作
│   └── fixtures.ts       # 測試用的預設 config 工廠
├── solver/
│   ├── types.ts          # ShaftSpec, ElevatorDesign, NonStandardError
│   ├── table.ts          # ISO 8100-1 Table 6 (載重↔面積查找)
│   ├── clearances.ts     # 純數學輔助函數 (間隙/頂部高度/底坑計算)
│   ├── mode-a.ts         # solveModeA(input, config) — 坑道→電梯
│   └── mode-b.ts         # solveModeB(input, config) — 需求→坑道
├── dxf/
│   ├── plan.ts           # drawPlanView() — 平面圖 (含 5 種配重位置)
│   └── generate.ts       # generateElevatorDXF() — 組合平面圖+側面圖
├── handlers/
│   ├── solve.ts          # handleSolve() — orchestrator (rules→config→solve→dxf→validation)
│   ├── chat.ts           # handleChat() — Anthropic API bridge + Layer 2 validation
│   ├── chat-prompt.ts    # 系統 prompt + compact rules dump + dynamic context builder
│   ├── rules.ts          # CRUD handlers (list/patch/delete/restore/commit)
│   ├── analyze-arch.ts   # 建築 DXF 解析 (Hack Canada demo)
│   └── analyze-generated.ts # 生成 DXF 解析 (圖層統計)
├── worker/
│   └── index.ts          # Cloudflare Worker entrypoint — 路由 + 錯誤映射
└── demo/
    └── server.ts         # 本地 Bun 開發伺服器 (InMemoryRulesStore)

seeds/
├── generate-baseline.ts  # 46 條規則的 single source of truth
└── 0001_baseline_rules.sql # 自動生成的 SQL INSERT

migrations/
└── 0001_initial_rules_schema.sql # D1 schema (4 tables + 3 indexes)

public/
└── index.html            # 前端 (vanilla JS, ~2400 行)

docs/
├── DESIGN.md             # 初期產品設計文件
├── TODO.md               # Phase 2 延遲項目清單
└── superpowers/
    ├── specs/            # 設計規格書
    └── plans/            # 實作計畫 (M1a-M1d)
```

## 三層規則模型

```
Baseline (程式碼中的 min/max 約束)
     ↓ 不可超出
Team Default (D1 rules.value)
     ↓ 可覆寫
Case Override (瀏覽器 in-memory)
     ↓ 收工存入團隊
Team Default (更新 D1)
```

- **Baseline**: 每條規則的 `baseline_min` / `baseline_max` / `baseline_choices`，由 `seeds/generate-baseline.ts` 定義
- **Team Default**: D1 `rules.value`，Rules Tab 可編輯，AI 可提議修改
- **Case Override**: 瀏覽器記憶體中的 `CaseOverride` object，每次 /api/solve 傳送

`buildEffectiveConfig()` 合併三層，對每個 final value 呼叫 `assertValueWithinBaseline()`。

## 三層 Baseline 安全防護

| 層 | 位置 | 作用 |
|---|---|---|
| Layer 1 | `chat-prompt.ts` 系統 prompt | 行為約束，告訴 AI 不能提出違規值 |
| Layer 2 | `chat.ts` validateProposal() | AI 回覆後 server 端驗證，違規降級為 ask_clarification |
| Layer 3 | `effective.ts` assertValueWithinBaseline() | 所有寫入路徑的最終驗證，不可繞過 |

Layer 3 是完整性地板 — 即使 Layer 1 + 2 都被繞過，資料庫也不會被寫入違規值。

## 規則分類軸

兩個正交軸：

**source** (來源):
- `cns` — CNS/ISO/EN 法規 (~10 條)，修改有法律風險
- `industry` — 台灣/日本產業慣例 (~20 條)，修改會被質疑
- `engineering` — 內部預設 (~16 條)，在 baseline 範圍內自由調整

**mandatory** (必要性):
- `1` — solver 結構性需要，不可刪除，值可在 baseline 內編輯
- `0` — solver 有 fallback，可軟刪除

## API Contracts

### POST /api/solve

```typescript
// Request
{ mode: 'A' | 'B', stops: number, usage: Usage, caseOverride: CaseOverride, ...modeFields }

// Response
{ design: ElevatorDesign, dxf_string: string, dxf_kb: number,
  analysis: AnalysisResult, validation_report: ValidationReport }
```

### POST /api/chat

```typescript
// Request
{ session_id: string, messages: ChatMessage[],
  case_context: { solver_input: object, current_case_override: CaseOverride } }

// Response
{ assistant_message: string, action: ChatAction, session_id: string, prompt_version: string }

// ChatAction =
//   | { type: 'propose_update', rule_key, current_value, new_value, reasoning }
//   | { type: 'propose_soft_delete', rule_key, reasoning }
//   | { type: 'ask_clarification', question, choices[] }
//   | { type: 'out_of_scope', message }
```

### POST /api/rules/commit

```typescript
// Request
{ case_override: CaseOverride }

// Response — partial apply
{ applied: [{ key, old_value, new_value }], skipped: [{ key, reason }] }
// reason: 'rule_deleted' | 'baseline_violation' | 'unchanged' | 'unknown_key'
```

## 錯誤型別映射

| Error Class | HTTP | 場景 |
|---|---|---|
| InvalidSolveBodyError | 400 | 缺欄位或型別錯誤 |
| BaselineViolationError | 400 | 值超出 baseline 範圍 |
| NonStandardError | 400 | 坑道太小等不可行輸入 |
| RuleNotFoundError | 404 | 規則 key 不存在或已刪除 |
| RuleMandatoryError | 403 | 嘗試刪除 mandatory=1 的規則 |
| InvalidChatBodyError | 400 | Chat 請求格式錯誤 |
| ChatApiError | 503 | Anthropic API 不可用 |

## 測試架構

4 層測試策略：

| Layer | 目標 | 數量 | 特點 |
|---|---|---|---|
| Layer 1 | buildEffectiveConfig, validation, assertValueWithinBaseline | ~30 | 純函數，無 DB/LLM |
| Layer 2 | solveModeA/B, generateElevatorDXF, geometry | ~50 | config 注入，snapshot + drift guard |
| Layer 3 | Rules CRUD handlers | ~25 | InMemoryRulesStore per test |
| Layer 4 | Chat handler | ~28 | Mock AnthropicCaller，不呼叫真 API |

```
222 tests, 0 failures
98.42% line coverage, 98.66% function coverage
```

真實 Claude API regression tests 延遲到 Phase 2 (見 docs/TODO.md)。

## 部署

```bash
# 本地開發
bun src/demo/server.ts

# 生產部署
wrangler deploy

# 設定 AI Chat 密鑰
wrangler secret put ANTHROPIC_API_KEY

# D1 操作
wrangler d1 migrations apply elevator-configurator-db --remote
wrangler d1 execute elevator-configurator-db --remote --file=seeds/0001_baseline_rules.sql
```

生產環境：
- Worker: `elevator-configurator` on `elevator-configurator.redarch.dev`
- D1: `elevator-configurator-db` (ID: `907ec485-0ee5-47de-9edd-086eb82f8703`)
- Secret: `ANTHROPIC_API_KEY`

## Milestone 歷程

| Milestone | PR | 內容 |
|---|---|---|
| M1a | #8 | D1 schema + 46 baseline rules seeded |
| M1b | #10, #11 | Solver 重構消費 EffectiveConfig |
| M1c | #12, #13 | Rules Tab + Validation Panel + CRUD API |
| M1d | #14, #15 | AI Chat sidebar (Claude Sonnet 4.6) |
| QA fixes | #16-#20 | Model ID, form coercion, XSS fix, commit UX |

## Phase 2 規劃

見 [docs/TODO.md](./docs/TODO.md)：
- 真實身份驗證 (Cloudflare Access)
- 主管審核工作流 (pending → approved)
- 案子持久化 (chat_sessions 寫入)
- 真實 Claude API regression tests
- 規則版本歷程 UI
- 動態 key 新增
- 多租戶
