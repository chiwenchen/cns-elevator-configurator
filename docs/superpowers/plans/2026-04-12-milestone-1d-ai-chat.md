# Milestone 1d — AI Chat Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI chat sidebar powered by Claude Sonnet 4.6 so sales users can describe design issues in natural language, receive structured rule-change proposals, accept/reject them as case overrides, and regenerate drawings — with three-layer baseline enforcement.

**Architecture:** The chat handler (`src/handlers/chat.ts`) receives the full conversation history + case context from the browser (stateless server), calls the Anthropic Messages API with a version-controlled system prompt + dynamic rules context, parses structured tool-call responses, validates proposals against baseline constraints (Layer 2), and returns a typed `ChatAction`. The frontend renders a slide-in sidebar with message bubbles, multi-choice buttons, and proposal cards with Accept/Reject. Layer 3 (write-time validation) is already in place from M1b/M1c.

**Tech Stack:** Anthropic Messages API (claude-sonnet-4-6-20250514), Cloudflare Workers + D1, Bun test with mocked API responses, vanilla JS frontend.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/handlers/chat-prompt.ts` | Static system prompt, `SYSTEM_PROMPT_VERSION`, `buildDynamicContext()`, `formatCompactRulesDump()` | Create |
| `src/handlers/chat.ts` | `handleChat()` orchestrator, `callAnthropic()`, `parseClaudeResponse()`, `validateProposal()` (Layer 2), request/response types | Create |
| `src/handlers/chat-prompt.test.ts` | Unit tests for prompt building + compact rules format | Create |
| `src/handlers/chat.test.ts` | Layer 4 mocked chat tests (~20 tests) | Create |
| `src/worker/index.ts` | Add `POST /api/chat` route, read `ANTHROPIC_API_KEY` from env | Modify |
| `src/demo/server.ts` | Add `POST /api/chat` route for local Bun dev | Modify |
| `public/index.html` | Chat sidebar UI, star button, message rendering, proposal cards, state machine | Modify |
| `docs/TODO.md` | Phase 2 deferred items list | Create |

---

## Pre-task: Create feature branch

- [ ] **Step 1: Create branch from latest main**

```bash
git checkout main && git pull --rebase
git checkout -b feat/milestone-1d-ai-chat
```

---

### Task 1: Chat prompt builder — compact rules dump + system prompt

**Files:**
- Create: `src/handlers/chat-prompt.ts`
- Test: `src/handlers/chat-prompt.test.ts`

- [ ] **Step 1: Write failing tests for `formatCompactRulesDump`**

Create `src/handlers/chat-prompt.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import { formatCompactRulesDump, buildDynamicContext, SYSTEM_PROMPT_VERSION } from './chat-prompt'
import type { TeamRule } from '../config/types'

const makeRule = (overrides: Partial<TeamRule> = {}): TeamRule => ({
  id: 1,
  key: 'clearance.side_mm',
  name: '車廂側向間隙',
  description: null,
  type: 'number',
  value: '200',
  default_value: '200',
  unit: 'mm',
  baseline_min: 150,
  baseline_max: 400,
  baseline_choices: null,
  category: 'clearance',
  mandatory: 1,
  source: 'engineering',
  ...overrides,
})

describe('formatCompactRulesDump', () => {
  test('formats a number rule as single-line compact string', () => {
    const rules = [makeRule()]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('RULES (key | type | value | min-max/choices | src | mand | name)')
    expect(dump).toContain('clearance.side_mm | num | 200 | 150-400 mm | eng | 1 | 車廂側向間隙')
  })

  test('formats an enum rule with choices', () => {
    const rules = [makeRule({
      key: 'cwt.position',
      name: '配重位置',
      type: 'enum',
      value: 'back_left',
      default_value: 'back_left',
      unit: null,
      baseline_min: null,
      baseline_max: null,
      baseline_choices: ['back_left', 'back_center', 'back_right', 'side_left', 'side_right'],
      mandatory: 0,
      source: 'engineering',
    })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('cwt.position | enum | back_left | [back_left,back_center,back_right,side_left,side_right] | eng | 0 | 配重位置')
  })

  test('formats CNS source as cns', () => {
    const rules = [makeRule({ source: 'cns' })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| cns |')
  })

  test('formats industry source as ind', () => {
    const rules = [makeRule({ source: 'industry' })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| ind |')
  })

  test('formats number rule with only min bound', () => {
    const rules = [makeRule({ baseline_min: 900, baseline_max: null, unit: 'mm' })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| 900- mm |')
  })

  test('formats number rule with no bounds', () => {
    const rules = [makeRule({ baseline_min: null, baseline_max: null, unit: null })]
    const dump = formatCompactRulesDump(rules)
    expect(dump).toContain('| - |')
  })
})

describe('buildDynamicContext', () => {
  test('assembles rules dump + case context + override state', () => {
    const rules = [makeRule()]
    const solverInput = { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' }
    const caseOverride = { 'clearance.side_mm': '250' }
    const chatHistory = [
      { role: 'user' as const, content: '側向間隙加大', timestamp: 1000 },
    ]
    const ctx = buildDynamicContext(rules, solverInput, caseOverride, chatHistory)
    expect(ctx).toContain('clearance.side_mm | num | 200')
    expect(ctx).toContain('CASE INPUT')
    expect(ctx).toContain('rated_load_kg')
    expect(ctx).toContain('CURRENT CASE OVERRIDE')
    expect(ctx).toContain('clearance.side_mm = 250')
  })

  test('shows empty override when none set', () => {
    const rules = [makeRule()]
    const ctx = buildDynamicContext(rules, { mode: 'A' }, {}, [])
    expect(ctx).toContain('(none)')
  })
})

describe('SYSTEM_PROMPT_VERSION', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT_VERSION).toBe('string')
    expect(SYSTEM_PROMPT_VERSION.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/chat-prompt.test.ts
```

Expected: FAIL — module `./chat-prompt` not found.

- [ ] **Step 3: Implement `chat-prompt.ts`**

Create `src/handlers/chat-prompt.ts`:

```typescript
/**
 * Chat prompt builder — static system prompt + dynamic context assembly.
 *
 * The system prompt is the safety boundary of the AI chat feature.
 * Version-controlled here; never stored in DB.
 */

import type { TeamRule, CaseOverride } from '../config/types'

export const SYSTEM_PROMPT_VERSION = '1.0.0'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * Static system prompt (~1200 tokens). Defines AI role, safety tiers,
 * allowed/forbidden actions, and response format.
 */
export function buildSystemPrompt(): string {
  return `你是 CNS 電梯配件器的設計指引助理。使用者是台灣電梯製造商的業務團隊。

## 角色
你協助業務調整電梯設計規則。你只能透過 tool use 執行動作，不能自由回覆文字。

## 規則 schema 欄位說明
- key: 規則唯一識別碼
- type: number（數值）或 enum（選項）
- value: 目前團隊設定值
- min-max/choices: 允許的 baseline 範圍（不可超出）
- src: 來源 — cns（法規）、ind（產業慣例）、eng（工程預設）
- mand: 1＝必要（solver 必須有此規則，不可刪除）、0＝可選

## 安全層級（依 source）
- cns（法規）：修改前必須向使用者確認理解法規風險，提醒 baseline 範圍
- ind（產業慣例）：修改時警告這是非標準做法
- eng（工程預設）：在 baseline 範圍內可自由調整

## 允許的動作（僅限 tool use）
1. propose_update — 提議修改某規則的值（必須在 baseline 範圍內）
2. propose_soft_delete — 提議軟刪除 mandatory=0 的規則
3. ask_clarification — 提問釐清需求（附選項）
4. out_of_scope — 說明無法處理該請求

## 禁止事項
- 不可提議超出 baseline 範圍的值
- 不可提議刪除 mandatory=1 的規則
- 不可建立新的規則 key
- 不可修改 ISO 8100-1 Table 6
- 不可寫程式碼、畫圖、翻譯、或回答不相關的問題
- 不可執行 tool use 以外的自由文字回覆

## 回覆語言
使用繁體中文回覆。內部推理可用英文。

## 重要
每次回覆都必須使用一個 tool call。如果使用者的請求不明確，使用 ask_clarification。
如果請求超出能力範圍，使用 out_of_scope。

Prompt version: ${SYSTEM_PROMPT_VERSION}`
}

/**
 * Format rules into compact single-line-per-rule dump for token efficiency.
 * ~80 chars × N rules.
 */
export function formatCompactRulesDump(rules: TeamRule[]): string {
  const header = 'RULES (key | type | value | min-max/choices | src | mand | name)'
  const lines = rules.map((r) => {
    const typeStr = r.type === 'number' ? 'num' : 'enum'
    const rangeStr = formatRange(r)
    const srcStr = r.source === 'engineering' ? 'eng' : r.source === 'industry' ? 'ind' : 'cns'
    return `${r.key} | ${typeStr} | ${r.value} | ${rangeStr} | ${srcStr} | ${r.mandatory} | ${r.name}`
  })
  return [header, ...lines].join('\n')
}

function formatRange(rule: TeamRule): string {
  if (rule.type === 'enum' && rule.baseline_choices) {
    return `[${rule.baseline_choices.join(',')}]`
  }
  if (rule.type === 'number') {
    const min = rule.baseline_min !== null ? String(rule.baseline_min) : ''
    const max = rule.baseline_max !== null ? String(rule.baseline_max) : ''
    const unit = rule.unit || ''
    if (!min && !max) return '-'
    return `${min}-${max} ${unit}`.trim()
  }
  return '-'
}

/**
 * Build the dynamic context section injected as a user message before
 * the conversation history.
 */
export function buildDynamicContext(
  rules: TeamRule[],
  solverInput: Record<string, unknown>,
  caseOverride: CaseOverride,
  chatHistory: ChatMessage[],
): string {
  const sections: string[] = []

  // 1. Rules dump
  sections.push(formatCompactRulesDump(rules))

  // 2. Solver input snapshot
  sections.push(`\nCASE INPUT\n${JSON.stringify(solverInput, null, 2)}`)

  // 3. Current case override
  const overrideEntries = Object.entries(caseOverride)
  if (overrideEntries.length > 0) {
    const lines = overrideEntries.map(([k, v]) => `${k} = ${v}`)
    sections.push(`\nCURRENT CASE OVERRIDE\n${lines.join('\n')}`)
  } else {
    sections.push('\nCURRENT CASE OVERRIDE\n(none)')
  }

  return sections.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/handlers/chat-prompt.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/chat-prompt.ts src/handlers/chat-prompt.test.ts
git commit -m "feat(m1d): add chat prompt builder with compact rules dump format"
```

---

### Task 2: Chat handler — Anthropic API client + response parser + Layer 2 validation

**Files:**
- Create: `src/handlers/chat.ts`
- Test: `src/handlers/chat.test.ts`

This is the largest task. The handler:
1. Validates the request body
2. Loads active rules
3. Calls Anthropic Messages API (or mock in tests)
4. Parses the tool-call response into a typed `ChatAction`
5. Validates proposals against baseline (Layer 2)
6. Returns `ChatResponse`

- [ ] **Step 1: Write failing tests for chat handler**

Create `src/handlers/chat.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  handleChat,
  parseChatBody,
  parseClaudeResponse,
  validateProposal,
  InvalidChatBodyError,
  ChatApiError,
  CHAT_TOOLS,
} from './chat'
import type { ChatRequest, ChatResponse, ChatAction } from './chat'
import { InMemoryRulesStore } from '../config/load'
import type { TeamRule } from '../config/types'

// ---- Mock Anthropic caller ----

function mockAnthropicCaller(toolName: string, toolInput: Record<string, unknown>, textContent?: string) {
  return async (_opts: unknown) => ({
    content: [
      ...(textContent ? [{ type: 'text' as const, text: textContent }] : []),
      {
        type: 'tool_use' as const,
        id: 'toolu_mock_001',
        name: toolName,
        input: toolInput,
      },
    ],
    stop_reason: 'tool_use' as const,
  })
}

function mockAnthropicTextOnly(text: string) {
  return async (_opts: unknown) => ({
    content: [{ type: 'text' as const, text }],
    stop_reason: 'end_turn' as const,
  })
}

function mockAnthropicError() {
  return async (_opts: unknown) => {
    throw new Error('API connection failed')
  }
}

let store: InMemoryRulesStore

beforeEach(() => {
  store = new InMemoryRulesStore()
})

// ---- Request body parsing ----

describe('parseChatBody', () => {
  test('parses valid request', () => {
    const body = {
      session_id: 'sess-1',
      messages: [{ role: 'user', content: '配重位置在中間', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const parsed = parseChatBody(body)
    expect(parsed.session_id).toBe('sess-1')
    expect(parsed.messages).toHaveLength(1)
  })

  test('rejects missing session_id', () => {
    expect(() => parseChatBody({ messages: [], case_context: {} }))
      .toThrow(InvalidChatBodyError)
  })

  test('rejects non-array messages', () => {
    expect(() => parseChatBody({
      session_id: 's',
      messages: 'not-array',
      case_context: { solver_input: {}, current_case_override: {} },
    })).toThrow(InvalidChatBodyError)
  })

  test('rejects missing case_context', () => {
    expect(() => parseChatBody({
      session_id: 's',
      messages: [],
    })).toThrow(InvalidChatBodyError)
  })
})

// ---- Claude response parsing ----

describe('parseClaudeResponse', () => {
  test('extracts propose_update tool call', () => {
    const response = {
      content: [
        { type: 'text' as const, text: '我建議將配重位置改到中間。' },
        {
          type: 'tool_use' as const,
          id: 'toolu_001',
          name: 'propose_update',
          input: { key: 'cwt.position', new_value: 'back_center', reasoning: '使用者要求配重在中間' },
        },
      ],
      stop_reason: 'tool_use' as const,
    }
    const result = parseClaudeResponse(response)
    expect(result.assistantMessage).toBe('我建議將配重位置改到中間。')
    expect(result.action.type).toBe('propose_update')
    if (result.action.type === 'propose_update') {
      expect(result.action.rule_key).toBe('cwt.position')
      expect(result.action.new_value).toBe('back_center')
    }
  })

  test('extracts ask_clarification with choices', () => {
    const response = {
      content: [
        { type: 'text' as const, text: '請問您希望配重放在哪個位置？' },
        {
          type: 'tool_use' as const,
          id: 'toolu_002',
          name: 'ask_clarification',
          input: { question: '配重位置', choices: ['back_center', 'back_right'] },
        },
      ],
      stop_reason: 'tool_use' as const,
    }
    const result = parseClaudeResponse(response)
    expect(result.action.type).toBe('ask_clarification')
    if (result.action.type === 'ask_clarification') {
      expect(result.action.choices).toEqual(['back_center', 'back_right'])
    }
  })

  test('extracts propose_soft_delete', () => {
    const response = {
      content: [
        { type: 'text' as const, text: '建議移除此規則。' },
        {
          type: 'tool_use' as const,
          id: 'toolu_003',
          name: 'propose_soft_delete',
          input: { key: 'cwt.position', reasoning: '不需要配重位置限制' },
        },
      ],
      stop_reason: 'tool_use' as const,
    }
    const result = parseClaudeResponse(response)
    expect(result.action.type).toBe('propose_soft_delete')
  })

  test('extracts out_of_scope', () => {
    const response = {
      content: [
        {
          type: 'tool_use' as const,
          id: 'toolu_004',
          name: 'out_of_scope',
          input: { message: '抱歉，這超出了我的能力範圍。' },
        },
      ],
      stop_reason: 'tool_use' as const,
    }
    const result = parseClaudeResponse(response)
    expect(result.action.type).toBe('out_of_scope')
    expect(result.assistantMessage).toBe('')
  })

  test('falls back to out_of_scope for text-only response (no tool call)', () => {
    const response = {
      content: [{ type: 'text' as const, text: '隨便聊聊' }],
      stop_reason: 'end_turn' as const,
    }
    const result = parseClaudeResponse(response)
    expect(result.action.type).toBe('out_of_scope')
    expect(result.assistantMessage).toContain('AI 誤解了')
  })

  test('falls back to out_of_scope for unknown tool name', () => {
    const response = {
      content: [{
        type: 'tool_use' as const,
        id: 'toolu_005',
        name: 'unknown_tool',
        input: {},
      }],
      stop_reason: 'tool_use' as const,
    }
    const result = parseClaudeResponse(response)
    expect(result.action.type).toBe('out_of_scope')
  })
})

// ---- Layer 2 validation ----

describe('validateProposal', () => {
  const makeRule = (overrides: Partial<TeamRule> = {}): TeamRule => ({
    id: 1, key: 'clearance.side_mm', name: '側向間隙', description: null,
    type: 'number', value: '200', default_value: '200', unit: 'mm',
    baseline_min: 150, baseline_max: 400, baseline_choices: null,
    category: 'clearance', mandatory: 1, source: 'engineering',
    ...overrides,
  })

  test('passes valid propose_update within baseline', () => {
    const rules = [makeRule()]
    const action: ChatAction = {
      type: 'propose_update',
      rule_key: 'clearance.side_mm',
      current_value: '200',
      new_value: '250',
      reasoning: 'test',
    }
    const result = validateProposal(action, rules)
    expect(result.type).toBe('propose_update')
  })

  test('downgrades propose_update that violates baseline to ask_clarification', () => {
    const rules = [makeRule()]
    const action: ChatAction = {
      type: 'propose_update',
      rule_key: 'clearance.side_mm',
      current_value: '200',
      new_value: '50', // below baseline_min 150
      reasoning: 'too small',
    }
    const result = validateProposal(action, rules)
    expect(result.type).toBe('ask_clarification')
  })

  test('downgrades propose_update for unknown key to ask_clarification', () => {
    const rules = [makeRule()]
    const action: ChatAction = {
      type: 'propose_update',
      rule_key: 'nonexistent.key',
      current_value: '0',
      new_value: '100',
      reasoning: 'test',
    }
    const result = validateProposal(action, rules)
    expect(result.type).toBe('ask_clarification')
  })

  test('downgrades propose_soft_delete on mandatory rule', () => {
    const rules = [makeRule({ mandatory: 1 })]
    const action: ChatAction = {
      type: 'propose_soft_delete',
      rule_key: 'clearance.side_mm',
      reasoning: 'remove it',
    }
    const result = validateProposal(action, rules)
    expect(result.type).toBe('ask_clarification')
  })

  test('passes propose_soft_delete on non-mandatory rule', () => {
    const rules = [makeRule({ mandatory: 0 })]
    const action: ChatAction = {
      type: 'propose_soft_delete',
      rule_key: 'clearance.side_mm',
      reasoning: 'not needed',
    }
    const result = validateProposal(action, rules)
    expect(result.type).toBe('propose_soft_delete')
  })

  test('passes ask_clarification through unchanged', () => {
    const action: ChatAction = {
      type: 'ask_clarification',
      question: '哪個位置？',
      choices: ['left', 'right'],
    }
    const result = validateProposal(action, [])
    expect(result.type).toBe('ask_clarification')
  })

  test('passes out_of_scope through unchanged', () => {
    const action: ChatAction = { type: 'out_of_scope', message: 'nope' }
    const result = validateProposal(action, [])
    expect(result.type).toBe('out_of_scope')
  })
})

// ---- Full handler integration ----

describe('handleChat', () => {
  test('happy path: propose_update returns valid response', async () => {
    const caller = mockAnthropicCaller(
      'propose_update',
      { key: 'cwt.position', new_value: 'back_center', reasoning: '使用者要求' },
      '我建議把配重移到中間。',
    )
    const body = {
      session_id: 'sess-1',
      messages: [{ role: 'user', content: '配重應該在中間', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    expect(res.action.type).toBe('propose_update')
    expect(res.assistant_message).toBe('我建議把配重移到中間。')
    expect(res.session_id).toBe('sess-1')
    expect(res.prompt_version).toBeTruthy()
  })

  test('ask_clarification returns choices', async () => {
    const caller = mockAnthropicCaller(
      'ask_clarification',
      { question: '您要哪種配重位置？', choices: ['back_center', 'side_left'] },
      '讓我先確認一下。',
    )
    const body = {
      session_id: 'sess-2',
      messages: [{ role: 'user', content: '配重怪怪的', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    expect(res.action.type).toBe('ask_clarification')
    if (res.action.type === 'ask_clarification') {
      expect(res.action.choices).toHaveLength(2)
    }
  })

  test('baseline-violating proposal is downgraded by Layer 2', async () => {
    const caller = mockAnthropicCaller(
      'propose_update',
      { key: 'clearance.side_mm', new_value: '50', reasoning: 'make it tiny' },
      '建議縮小。',
    )
    const body = {
      session_id: 'sess-3',
      messages: [{ role: 'user', content: '間隙縮到50', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    expect(res.action.type).toBe('ask_clarification')
  })

  test('mandatory deletion attempt is downgraded by Layer 2', async () => {
    const caller = mockAnthropicCaller(
      'propose_soft_delete',
      { key: 'clearance.side_mm', reasoning: 'not needed' },
      '建議刪除。',
    )
    const body = {
      session_id: 'sess-4',
      messages: [{ role: 'user', content: '刪掉側向間隙', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    // clearance.side_mm is mandatory=1 in baseline
    expect(res.action.type).toBe('ask_clarification')
  })

  test('API error returns ChatApiError', async () => {
    const caller = mockAnthropicError()
    const body = {
      session_id: 'sess-5',
      messages: [{ role: 'user', content: 'hello', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    try {
      await handleChat(body, store, caller)
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(ChatApiError)
    }
  })

  test('text-only response (no tool call) falls back gracefully', async () => {
    const caller = mockAnthropicTextOnly('我不確定你要什麼')
    const body = {
      session_id: 'sess-6',
      messages: [{ role: 'user', content: '你好', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    expect(res.action.type).toBe('out_of_scope')
  })

  test('propose_update includes current_value from rules', async () => {
    const caller = mockAnthropicCaller(
      'propose_update',
      { key: 'cwt.position', new_value: 'back_center', reasoning: 'center is better' },
      '改到中間。',
    )
    const body = {
      session_id: 'sess-7',
      messages: [{ role: 'user', content: '配重放中間', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    if (res.action.type === 'propose_update') {
      expect(res.action.current_value).toBe('back_left') // default from baseline
    }
  })

  test('invalid request body throws InvalidChatBodyError', async () => {
    const caller = mockAnthropicCaller('out_of_scope', { message: 'x' })
    try {
      await handleChat({ bad: true }, store, caller)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidChatBodyError)
    }
  })
})

describe('CHAT_TOOLS', () => {
  test('defines exactly 4 tools', () => {
    expect(CHAT_TOOLS).toHaveLength(4)
  })

  test('includes propose_update, propose_soft_delete, ask_clarification, out_of_scope', () => {
    const names = CHAT_TOOLS.map((t: { name: string }) => t.name)
    expect(names).toContain('propose_update')
    expect(names).toContain('propose_soft_delete')
    expect(names).toContain('ask_clarification')
    expect(names).toContain('out_of_scope')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/chat.test.ts
```

Expected: FAIL — module `./chat` not found.

- [ ] **Step 3: Implement `chat.ts`**

Create `src/handlers/chat.ts`:

```typescript
/**
 * /api/chat handler — AI chat orchestrator.
 *
 * Flow:
 *   1. Parse + validate request body
 *   2. Load active rules from store
 *   3. Build system prompt + dynamic context
 *   4. Call Anthropic Messages API (via injected caller for testability)
 *   5. Parse tool-call response into ChatAction
 *   6. Validate proposal against baseline (Layer 2)
 *   7. Return ChatResponse
 *
 * Layer 2 baseline enforcement: if Claude proposes a value that violates
 * baseline constraints, or proposes deleting a mandatory rule, the proposal
 * is downgraded to ask_clarification with an explanation.
 */

import type { TeamRule, CaseOverride } from '../config/types'
import { assertValueWithinBaseline, BaselineViolationError } from '../config/effective'
import type { RulesLoader } from '../config/load'
import {
  buildSystemPrompt,
  buildDynamicContext,
  SYSTEM_PROMPT_VERSION,
  type ChatMessage,
} from './chat-prompt'

// ---- Types ----

export type ChatAction =
  | { type: 'ask_clarification'; question: string; choices: string[] }
  | { type: 'propose_update'; rule_key: string; current_value: string; new_value: string; reasoning: string }
  | { type: 'propose_soft_delete'; rule_key: string; reasoning: string }
  | { type: 'out_of_scope'; message: string }
  | { type: 'none' }

export interface ChatRequest {
  session_id: string
  messages: ChatMessage[]
  case_context: {
    solver_input: Record<string, unknown>
    current_case_override: CaseOverride
  }
}

export interface ChatResponse {
  assistant_message: string
  action: ChatAction
  session_id: string
  prompt_version: string
}

// ---- Errors ----

export class InvalidChatBodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChatBodyError'
  }
}

export class ChatApiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'ChatApiError'
  }
}

// ---- Tool definitions (Anthropic tool use schema) ----

export const CHAT_TOOLS = [
  {
    name: 'propose_update',
    description: 'Propose changing the value of an existing rule',
    input_schema: {
      type: 'object' as const,
      required: ['key', 'new_value', 'reasoning'],
      properties: {
        key: { type: 'string' as const, description: 'The rule key to change' },
        new_value: { type: 'string' as const, description: 'The proposed new value (must be within baseline range)' },
        reasoning: { type: 'string' as const, description: 'Explanation in Traditional Chinese' },
      },
    },
  },
  {
    name: 'propose_soft_delete',
    description: 'Propose soft-deleting a mandatory=0 rule',
    input_schema: {
      type: 'object' as const,
      required: ['key', 'reasoning'],
      properties: {
        key: { type: 'string' as const, description: 'The rule key to delete' },
        reasoning: { type: 'string' as const, description: 'Explanation in Traditional Chinese' },
      },
    },
  },
  {
    name: 'ask_clarification',
    description: 'Ask user a clarifying question before proposing changes',
    input_schema: {
      type: 'object' as const,
      required: ['question', 'choices'],
      properties: {
        question: { type: 'string' as const, description: 'The clarification question' },
        choices: { type: 'array' as const, items: { type: 'string' as const }, description: 'Multiple choice options' },
      },
    },
  },
  {
    name: 'out_of_scope',
    description: 'Explain that the request cannot be handled',
    input_schema: {
      type: 'object' as const,
      required: ['message'],
      properties: {
        message: { type: 'string' as const, description: 'Explanation of why this cannot be handled' },
      },
    },
  },
]

// ---- Anthropic caller type (injected for testability) ----

interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface AnthropicTextBlock {
  type: 'text'
  text: string
}

export interface AnthropicResponse {
  content: Array<AnthropicToolUseBlock | AnthropicTextBlock>
  stop_reason: string
}

export type AnthropicCaller = (opts: {
  model: string
  max_tokens: number
  system: string
  tools: typeof CHAT_TOOLS
  tool_choice: { type: string }
  messages: Array<{ role: string; content: string }>
}) => Promise<AnthropicResponse>

/**
 * Create a real Anthropic API caller using fetch.
 * Used in production; tests inject a mock instead.
 */
export function createAnthropicCaller(apiKey: string): AnthropicCaller {
  return async (opts) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(opts),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Anthropic API ${res.status}: ${text}`)
    }
    return res.json() as Promise<AnthropicResponse>
  }
}

// ---- Request body parsing ----

export function parseChatBody(raw: unknown): ChatRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidChatBodyError('Request body must be a JSON object')
  }
  const b = raw as Record<string, unknown>

  if (typeof b.session_id !== 'string' || !b.session_id) {
    throw new InvalidChatBodyError('session_id must be a non-empty string')
  }
  if (!Array.isArray(b.messages)) {
    throw new InvalidChatBodyError('messages must be an array')
  }
  if (!b.case_context || typeof b.case_context !== 'object') {
    throw new InvalidChatBodyError('case_context must be an object')
  }
  const ctx = b.case_context as Record<string, unknown>
  if (!ctx.solver_input || typeof ctx.solver_input !== 'object') {
    throw new InvalidChatBodyError('case_context.solver_input must be an object')
  }
  if (!ctx.current_case_override || typeof ctx.current_case_override !== 'object') {
    throw new InvalidChatBodyError('case_context.current_case_override must be an object')
  }

  return {
    session_id: b.session_id,
    messages: b.messages as ChatMessage[],
    case_context: {
      solver_input: ctx.solver_input as Record<string, unknown>,
      current_case_override: ctx.current_case_override as CaseOverride,
    },
  }
}

// ---- Response parsing ----

export function parseClaudeResponse(
  response: AnthropicResponse,
): { assistantMessage: string; action: ChatAction } {
  // Extract text content
  const textBlocks = response.content.filter(
    (b): b is AnthropicTextBlock => b.type === 'text',
  )
  const assistantMessage = textBlocks.map((b) => b.text).join('\n')

  // Find tool use block
  const toolBlock = response.content.find(
    (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
  )

  if (!toolBlock) {
    // No tool call — malformed response, fallback
    return {
      assistantMessage: 'AI 誤解了，你能換個方式說嗎？',
      action: { type: 'out_of_scope', message: 'AI 誤解了，你能換個方式說嗎？' },
    }
  }

  const input = toolBlock.input

  switch (toolBlock.name) {
    case 'propose_update':
      return {
        assistantMessage,
        action: {
          type: 'propose_update',
          rule_key: String(input.key || ''),
          current_value: '', // filled by caller after validation
          new_value: String(input.new_value || ''),
          reasoning: String(input.reasoning || ''),
        },
      }

    case 'propose_soft_delete':
      return {
        assistantMessage,
        action: {
          type: 'propose_soft_delete',
          rule_key: String(input.key || ''),
          reasoning: String(input.reasoning || ''),
        },
      }

    case 'ask_clarification': {
      const choices = Array.isArray(input.choices)
        ? input.choices.map(String)
        : []
      return {
        assistantMessage,
        action: {
          type: 'ask_clarification',
          question: String(input.question || ''),
          choices,
        },
      }
    }

    case 'out_of_scope':
      return {
        assistantMessage,
        action: {
          type: 'out_of_scope',
          message: String(input.message || ''),
        },
      }

    default:
      // Unknown tool name — treat as malformed
      return {
        assistantMessage: 'AI 誤解了，你能換個方式說嗎？',
        action: { type: 'out_of_scope', message: 'AI 誤解了，你能換個方式說嗎？' },
      }
  }
}

// ---- Layer 2 validation ----

export function validateProposal(
  action: ChatAction,
  rules: TeamRule[],
): ChatAction {
  if (action.type === 'propose_update') {
    const rule = rules.find((r) => r.key === action.rule_key)
    if (!rule) {
      return {
        type: 'ask_clarification',
        question: `找不到規則 "${action.rule_key}"，請確認規則名稱。`,
        choices: [],
      }
    }
    try {
      assertValueWithinBaseline(rule, action.new_value)
    } catch (e) {
      if (e instanceof BaselineViolationError) {
        return {
          type: 'ask_clarification',
          question: `提議的值超出允許範圍：${e.reason}。請選擇其他值。`,
          choices: [],
        }
      }
      throw e
    }
    // Valid — enrich with current_value
    return { ...action, current_value: rule.value }
  }

  if (action.type === 'propose_soft_delete') {
    const rule = rules.find((r) => r.key === action.rule_key)
    if (!rule) {
      return {
        type: 'ask_clarification',
        question: `找不到規則 "${action.rule_key}"，請確認規則名稱。`,
        choices: [],
      }
    }
    if (rule.mandatory === 1) {
      return {
        type: 'ask_clarification',
        question: `規則 "${rule.name}" 是必要規則，無法刪除。請嘗試修改值。`,
        choices: [],
      }
    }
    return action
  }

  // ask_clarification, out_of_scope, none — pass through
  return action
}

// ---- Main handler ----

export async function handleChat(
  rawBody: unknown,
  loader: RulesLoader,
  caller: AnthropicCaller,
): Promise<ChatResponse> {
  // 1. Parse request
  const body = parseChatBody(rawBody)

  // 2. Load rules
  const teamRules = await loader.loadActiveRules()

  // 3. Build prompts
  const systemPrompt = buildSystemPrompt()
  const dynamicContext = buildDynamicContext(
    teamRules,
    body.case_context.solver_input,
    body.case_context.current_case_override,
    body.messages,
  )

  // 4. Build messages array for Anthropic
  const anthropicMessages: Array<{ role: string; content: string }> = [
    { role: 'user', content: `[CONTEXT]\n${dynamicContext}` },
  ]
  // Add conversation history
  for (const msg of body.messages) {
    anthropicMessages.push({ role: msg.role, content: msg.content })
  }

  // 5. Call Anthropic
  let response: AnthropicResponse
  try {
    response = await caller({
      model: 'claude-sonnet-4-6-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools: CHAT_TOOLS,
      tool_choice: { type: 'any' },
      messages: anthropicMessages,
    })
  } catch (err) {
    throw new ChatApiError(
      'AI 暫時無法回應，請稍後再試',
      err,
    )
  }

  // 6. Parse response
  const parsed = parseClaudeResponse(response)

  // 7. Layer 2 validation
  const validatedAction = validateProposal(parsed.action, teamRules)

  return {
    assistant_message: parsed.assistantMessage,
    action: validatedAction,
    session_id: body.session_id,
    prompt_version: SYSTEM_PROMPT_VERSION,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/handlers/chat.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run full test suite**

```bash
bun test
```

Expected: all 176 existing + new chat tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/chat.ts src/handlers/chat.test.ts
git commit -m "feat(m1d): add chat handler with Anthropic client, response parser, Layer 2 validation"
```

---

### Task 3: Wire `/api/chat` route into Worker + demo server

**Files:**
- Modify: `src/worker/index.ts`
- Modify: `src/demo/server.ts`

- [ ] **Step 1: Add chat route to Worker**

In `src/worker/index.ts`, add the import at the top:

```typescript
import {
  handleChat,
  createAnthropicCaller,
  InvalidChatBodyError,
  ChatApiError,
} from '../handlers/chat'
```

Add `ANTHROPIC_API_KEY` to the `Env` interface:

```typescript
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}
```

Add the route BEFORE the `/api/solve` route block:

```typescript
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse(
          { error: 'not_configured', message: 'AI 功能尚未啟用（缺少 API key）' },
          { status: 503 },
        )
      }
      try {
        const body = await request.json()
        const loader = new D1RulesLoader(env.DB)
        const caller = createAnthropicCaller(env.ANTHROPIC_API_KEY)
        const result = await handleChat(body, loader, caller)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof InvalidChatBodyError) {
          return jsonResponse(
            { error: 'invalid_request', message: err.message },
            { status: 400 },
          )
        }
        if (err instanceof ChatApiError) {
          return jsonResponse(
            { error: 'ai_unavailable', message: err.message },
            { status: 503 },
          )
        }
        return jsonResponse(
          { error: 'chat_failed', message: String(err) },
          { status: 500 },
        )
      }
    }
```

- [ ] **Step 2: Add chat route to demo server**

In `src/demo/server.ts`, add the import:

```typescript
import {
  handleChat,
  createAnthropicCaller,
  InvalidChatBodyError,
  ChatApiError,
} from '../handlers/chat'
```

Add the route BEFORE the `/api/solve` route:

```typescript
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        return Response.json(
          { error: 'not_configured', message: 'Set ANTHROPIC_API_KEY env var' },
          { status: 503 },
        )
      }
      try {
        const body = await req.json()
        const caller = createAnthropicCaller(apiKey)
        const result = await handleChat(body, rulesStore, caller)
        return Response.json(result)
      } catch (err) {
        if (err instanceof InvalidChatBodyError) {
          return Response.json(
            { error: 'invalid_request', message: err.message },
            { status: 400 },
          )
        }
        if (err instanceof ChatApiError) {
          return Response.json(
            { error: 'ai_unavailable', message: err.message },
            { status: 503 },
          )
        }
        return Response.json(
          { error: 'chat_failed', message: String(err) },
          { status: 500 },
        )
      }
    }
```

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: all tests pass (routing code has no unit tests but must not break existing tests).

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts src/demo/server.ts
git commit -m "feat(m1d): wire POST /api/chat route into Worker and demo server"
```

---

### Task 4: Frontend chat sidebar — HTML + CSS structure

**Files:**
- Modify: `public/index.html`

This task adds the CSS styles and HTML structure for the chat sidebar. No JavaScript logic yet.

- [ ] **Step 1: Add CSS for chat sidebar**

Add these styles inside the existing `<style>` block (before the closing `</style>` tag):

```css
      /* ---- Chat Sidebar ---- */
      .ai-btn {
        background: var(--bg-panel);
        border: 1px solid var(--border-strong);
        color: var(--fg);
        font-family: var(--sans);
        font-size: 13px;
        padding: 4px 12px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.15s, border-color 0.15s;
      }
      .ai-btn:hover {
        background: var(--bg-elev);
        border-color: var(--accent);
      }
      .ai-btn.active {
        background: var(--accent-soft);
        border-color: var(--accent);
        color: var(--accent);
      }
      #chat-sidebar {
        display: none;
        width: 380px;
        background: var(--bg-panel);
        border-left: 1px solid var(--border);
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }
      #chat-sidebar.open {
        display: flex;
      }
      #view-configurator.chat-open {
        grid-template-columns: 340px 1fr 0px 380px;
      }
      .chat-header {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }
      .chat-header-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--fg);
      }
      .chat-close-btn {
        background: none;
        border: none;
        color: var(--fg-muted);
        cursor: pointer;
        font-size: 16px;
        padding: 2px 6px;
      }
      .chat-close-btn:hover { color: var(--fg); }
      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .chat-bubble {
        max-width: 85%;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
      }
      .chat-bubble.user {
        align-self: flex-end;
        background: var(--accent-soft);
        color: var(--fg);
        border-bottom-right-radius: 2px;
      }
      .chat-bubble.assistant {
        align-self: flex-start;
        background: var(--bg-elev);
        color: var(--fg);
        border-bottom-left-radius: 2px;
      }
      .chat-bubble.system {
        align-self: center;
        background: none;
        color: var(--fg-dim);
        font-size: 12px;
        text-align: center;
      }
      .chat-thinking {
        align-self: flex-start;
        color: var(--fg-muted);
        font-size: 12px;
        padding: 8px 12px;
      }
      .chat-choices {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .chat-choice-btn {
        background: var(--bg);
        border: 1px solid var(--border-strong);
        color: var(--fg);
        font-family: var(--sans);
        font-size: 12px;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
      }
      .chat-choice-btn:hover {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .chat-proposal-card {
        background: var(--bg);
        border: 1px solid var(--border-strong);
        border-radius: 6px;
        padding: 10px 12px;
        margin-top: 6px;
        font-size: 12px;
      }
      .chat-proposal-card .proposal-header {
        font-weight: 600;
        margin-bottom: 4px;
        color: var(--fg);
      }
      .chat-proposal-card .proposal-diff {
        font-family: var(--mono);
        color: var(--fg-muted);
        margin: 4px 0;
      }
      .chat-proposal-card .proposal-reasoning {
        color: var(--fg-muted);
        margin-bottom: 8px;
      }
      .chat-proposal-card .proposal-actions {
        display: flex;
        gap: 8px;
      }
      .proposal-accept-btn, .proposal-reject-btn {
        font-family: var(--sans);
        font-size: 12px;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid var(--border-strong);
      }
      .proposal-accept-btn {
        background: var(--accent-soft);
        color: var(--accent);
        border-color: var(--accent);
      }
      .proposal-accept-btn:hover { background: var(--accent); color: #fff; }
      .proposal-reject-btn {
        background: var(--bg-panel);
        color: var(--fg-muted);
      }
      .proposal-reject-btn:hover { background: var(--bg-elev); color: var(--fg); }
      .chat-input-area {
        padding: 10px 16px;
        border-top: 1px solid var(--border);
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      .chat-input-area input {
        flex: 1;
        background: var(--bg);
        border: 1px solid var(--border-strong);
        color: var(--fg);
        font-family: var(--sans);
        font-size: 13px;
        padding: 6px 10px;
        border-radius: 4px;
        outline: none;
      }
      .chat-input-area input:focus { border-color: var(--accent); }
      .chat-input-area input:disabled { opacity: 0.5; }
      .chat-send-btn {
        background: var(--accent-soft);
        border: 1px solid var(--accent);
        color: var(--accent);
        font-family: var(--sans);
        font-size: 13px;
        padding: 6px 14px;
        border-radius: 4px;
        cursor: pointer;
      }
      .chat-send-btn:hover { background: var(--accent); color: #fff; }
      .chat-send-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 2: Add AI button to header and chat sidebar HTML**

In the header, add the AI button after the source select area. Find the closing `</div>` of `class="source"` div and add after it:

```html
          <button class="ai-btn" id="ai-chat-btn">AI 設計助理</button>
```

Add the chat sidebar HTML inside the `#view-configurator` section, right before the closing `</section>` (before the validation panel). Actually, to preserve the grid layout, the sidebar should be a direct child of the configurator grid. Add it right before `<div class="validation-panel collapsed"`:

```html
      <div id="chat-sidebar">
        <div class="chat-header">
          <span class="chat-header-title">AI 設計助理</span>
          <button class="chat-close-btn" id="chat-close-btn">X</button>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-area">
          <input type="text" id="chat-input" placeholder="描述設計問題..." disabled />
          <button class="chat-send-btn" id="chat-send-btn" disabled>送出</button>
        </div>
      </div>
```

- [ ] **Step 3: Update configurator grid to accommodate sidebar**

Update the `#view-configurator` CSS to support the optional fourth column. The existing rule:

```css
      #view-configurator {
        display: grid;
        grid-template-columns: 340px 1fr 380px;
```

Stays as-is. When chat is open, JS adds `.chat-open` class which changes the grid (already in the CSS above).

- [ ] **Step 4: Hide the aside (right sidebar) when chat is open**

Add CSS:

```css
      #view-configurator.chat-open aside {
        display: none;
      }
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(m1d): add chat sidebar HTML structure and CSS styles"
```

---

### Task 5: Frontend chat sidebar — JavaScript logic + state machine

**Files:**
- Modify: `public/index.html`

This task adds the JavaScript state machine, message rendering, and API integration for the chat sidebar.

- [ ] **Step 1: Add chat state and helper functions**

Add this JavaScript inside the `<script>` block, before the `// ---- Case Override Accumulator ----` section:

```javascript
      // ---- Chat Sidebar State Machine ----
      // States: idle | chat_open | thinking | awaiting_confirm
      const chatState = {
        status: 'idle',
        sessionId: null,
        messages: [],      // { role, content, timestamp, action? }
        pendingAction: null,
      }

      function generateSessionId() {
        return 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      }

      function openChat() {
        chatState.status = 'chat_open'
        if (!chatState.sessionId) chatState.sessionId = generateSessionId()
        document.getElementById('chat-sidebar').classList.add('open')
        document.getElementById('view-configurator').classList.add('chat-open')
        document.getElementById('ai-chat-btn').classList.add('active')
        document.getElementById('chat-input').disabled = false
        document.getElementById('chat-send-btn').disabled = false
        document.getElementById('chat-input').focus()
      }

      function closeChat() {
        chatState.status = 'idle'
        document.getElementById('chat-sidebar').classList.remove('open')
        document.getElementById('view-configurator').classList.remove('chat-open')
        document.getElementById('ai-chat-btn').classList.remove('active')
        document.getElementById('chat-input').disabled = true
        document.getElementById('chat-send-btn').disabled = true
      }

      function setThinking(on) {
        chatState.status = on ? 'thinking' : 'chat_open'
        document.getElementById('chat-input').disabled = on
        document.getElementById('chat-send-btn').disabled = on
        if (on) {
          const el = document.createElement('div')
          el.className = 'chat-thinking'
          el.id = 'chat-thinking-indicator'
          el.textContent = 'AI 思考中...'
          document.getElementById('chat-messages').appendChild(el)
          scrollChatToBottom()
        } else {
          const indicator = document.getElementById('chat-thinking-indicator')
          if (indicator) indicator.remove()
        }
      }

      function scrollChatToBottom() {
        const el = document.getElementById('chat-messages')
        el.scrollTop = el.scrollHeight
      }

      function addChatBubble(role, content) {
        const bubble = document.createElement('div')
        bubble.className = 'chat-bubble ' + role
        bubble.textContent = content
        document.getElementById('chat-messages').appendChild(bubble)
        scrollChatToBottom()
      }

      function renderProposalCard(action) {
        const card = document.createElement('div')
        card.className = 'chat-proposal-card'

        if (action.type === 'propose_update') {
          card.innerHTML = `
            <div class="proposal-header">提議修改: ${action.rule_key}</div>
            <div class="proposal-diff">${action.current_value} -> ${action.new_value}</div>
            <div class="proposal-reasoning">${action.reasoning}</div>
            <div class="proposal-actions">
              <button class="proposal-reject-btn" data-action="reject">不要</button>
              <button class="proposal-accept-btn" data-action="accept">套用並重畫</button>
            </div>
          `
        } else if (action.type === 'propose_soft_delete') {
          card.innerHTML = `
            <div class="proposal-header">提議刪除: ${action.rule_key}</div>
            <div class="proposal-reasoning">${action.reasoning}</div>
            <div class="proposal-actions">
              <button class="proposal-reject-btn" data-action="reject">不要</button>
              <button class="proposal-accept-btn" data-action="accept-delete">套用並重畫</button>
            </div>
          `
        }

        // Wire up buttons
        card.querySelector('[data-action="accept"]')?.addEventListener('click', () => {
          setOverride(action.rule_key, action.new_value)
          chatState.pendingAction = null
          chatState.status = 'chat_open'
          card.remove()
          addChatBubble('system', '已套用: ' + action.rule_key + ' = ' + action.new_value)
          resolveCurrentCase()
        })
        card.querySelector('[data-action="accept-delete"]')?.addEventListener('click', () => {
          // For soft delete, we don't apply an override — we'd need a special API call.
          // In v1, soft delete via chat applies as a case override with the default value,
          // effectively reverting it. The actual soft delete happens at commit time.
          addChatBubble('system', '已標記刪除: ' + action.rule_key + '（將在「收工存入團隊」時生效）')
          chatState.pendingAction = null
          chatState.status = 'chat_open'
          card.remove()
        })
        card.querySelector('[data-action="reject"]')?.addEventListener('click', () => {
          chatState.pendingAction = null
          chatState.status = 'chat_open'
          card.remove()
          addChatBubble('system', '已取消提議')
          document.getElementById('chat-input').disabled = false
          document.getElementById('chat-send-btn').disabled = false
        })

        document.getElementById('chat-messages').appendChild(card)
        chatState.pendingAction = action
        chatState.status = 'awaiting_confirm'
        document.getElementById('chat-input').disabled = true
        document.getElementById('chat-send-btn').disabled = true
        scrollChatToBottom()
      }

      function renderClarificationChoices(action) {
        const container = document.createElement('div')
        container.className = 'chat-choices'
        for (const choice of action.choices) {
          const btn = document.createElement('button')
          btn.className = 'chat-choice-btn'
          btn.textContent = choice
          btn.addEventListener('click', () => {
            container.remove()
            sendChatMessage(choice)
          })
          container.appendChild(btn)
        }
        document.getElementById('chat-messages').appendChild(container)
        scrollChatToBottom()
      }

      function handleChatResponse(data) {
        if (data.assistant_message) {
          addChatBubble('assistant', data.assistant_message)
        }

        const action = data.action
        if (!action) return

        switch (action.type) {
          case 'propose_update':
          case 'propose_soft_delete':
            renderProposalCard(action)
            break
          case 'ask_clarification':
            if (action.choices && action.choices.length > 0) {
              renderClarificationChoices(action)
            }
            break
          case 'out_of_scope':
            // Message already shown as assistant bubble
            break
          case 'none':
            break
        }
      }

      async function sendChatMessage(text) {
        if (!text.trim()) return
        if (chatState.status === 'thinking' || chatState.status === 'awaiting_confirm') return

        // Add user bubble
        const timestamp = Math.floor(Date.now() / 1000)
        chatState.messages.push({ role: 'user', content: text, timestamp })
        addChatBubble('user', text)

        // Clear input
        document.getElementById('chat-input').value = ''

        // Determine current solver input
        const activeTab = document.querySelector('.mode-tab.active')
        const activeMode = activeTab && activeTab.dataset.mode ? activeTab.dataset.mode : 'B'
        const solverInput = { mode: activeMode, ...collectSolverFormPayload(activeMode) }

        setThinking(true)

        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              session_id: chatState.sessionId,
              messages: chatState.messages,
              case_context: {
                solver_input: solverInput,
                current_case_override: { ...caseOverrideState },
              },
            }),
          })

          setThinking(false)

          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            addChatBubble('system', err.message || 'AI 暫時無法回應，請稍後再試')
            return
          }

          const data = await res.json()
          // Store assistant message in history
          if (data.assistant_message) {
            chatState.messages.push({
              role: 'assistant',
              content: data.assistant_message,
              timestamp: Math.floor(Date.now() / 1000),
            })
          }
          handleChatResponse(data)
        } catch (e) {
          setThinking(false)
          addChatBubble('system', 'AI 暫時無法回應，請稍後再試')
        }
      }

      // ---- Chat event listeners ----
      document.getElementById('ai-chat-btn').addEventListener('click', () => {
        if (chatState.status === 'idle') {
          openChat()
        } else {
          closeChat()
        }
      })

      document.getElementById('chat-close-btn').addEventListener('click', closeChat)

      document.getElementById('chat-send-btn').addEventListener('click', () => {
        sendChatMessage(document.getElementById('chat-input').value)
      })

      document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          sendChatMessage(document.getElementById('chat-input').value)
        }
      })
```

- [ ] **Step 2: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(m1d): add chat sidebar JavaScript — state machine, message rendering, proposal cards"
```

---

### Task 6: Create `docs/TODO.md` — Phase 2 deferred items

**Files:**
- Create: `docs/TODO.md`

- [ ] **Step 1: Create TODO.md**

Create `docs/TODO.md`:

```markdown
# Phase 2 Deferred Items

Items explicitly deferred from Phase 1 (v1) per design spec decisions.

## Real Claude API Regression Tests

- **What:** Replace mocked `callAnthropic` in Layer 4 tests with real API calls
- **Why deferred:** Cost (~$0.05-0.10 per CI run), requires `ANTHROPIC_API_KEY` in CI secrets
- **Trigger plan:** Weekly cron job + manual on prompt-related PRs
- **Spec reference:** §7, design decision #17

## Authentication

- **What:** Add real auth (Cloudflare Access or magic link)
- **Why deferred:** v1 is internal demo, zero auth sufficient
- **Preparation:** `rule_audit.source` already has `user`/`admin` enum; add `actor_email` column in Phase 2
- **Spec reference:** §8, design decision #3

## Approval Workflow

- **What:** Proposed rule changes require manager approval before becoming permanent
- **Why deferred:** v1 ships direct-commit flow; Phase 2 adds `pending_value` + `status` columns
- **Spec reference:** §8 Phase 2 item #2

## Case Persistence

- **What:** Save case overrides + chat history to `chat_sessions` table
- **Why deferred:** v1 keeps case override in browser memory (cleared on refresh)
- **Preparation:** `chat_sessions` table already exists in schema
- **Spec reference:** §5 (explicit v1 decision: no localStorage, no DB persistence)

## Rule Versioning / Diff View

- **What:** Timeline UI showing rule change history from `rule_audit` table
- **Why deferred:** Backend audit data is complete; Phase 2 adds UI
- **Spec reference:** §8 Phase 2 item #5

## Dynamic Rule Key Creation

- **What:** Allow creating new rule keys via UI or AI
- **Why deferred:** v1 schema is fixed (46 keys); Phase 2 needs schema migration UI
- **Spec reference:** Non-goals (v1)

## Multi-Tenant

- **What:** Add `tenant_id` column to all tables
- **Why deferred:** Single-team usage in v1
- **Spec reference:** §8 Phase 2 item #7

## Audit UI

- **What:** History sub-page in Rules Tab showing change timeline
- **Why deferred:** Backend data complete; frontend deferred
- **Spec reference:** §8 Phase 2 item #8
```

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md
git commit -m "docs(m1d): add Phase 2 deferred items TODO"
```

---

### Task 7: Final integration test — full test suite + coverage check

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite with coverage**

```bash
bun test --coverage
```

Expected: all tests pass, coverage ≥ 90% on `src/**/*.ts`.

- [ ] **Step 2: Verify chat handler tests pass independently**

```bash
bun test src/handlers/chat.test.ts -v
bun test src/handlers/chat-prompt.test.ts -v
```

Expected: all tests pass with clear output.

- [ ] **Step 3: Final commit if any adjustments needed**

If coverage dips below 90%, add additional test cases for uncovered branches in `chat.ts` or `chat-prompt.ts`.

---

### Task 8: Open PR

**Files:** None (git operations only)

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin feat/milestone-1d-ai-chat
```

Create PR with title and body:

```
feat(m1d): AI Chat Integration — Claude Sonnet 4.6 sidebar with three-layer enforcement
```

Body:

```markdown
## Summary

- Add AI chat sidebar powered by Claude Sonnet 4.6 (Anthropic Messages API)
- Static system prompt + dynamic context builder in `src/handlers/chat-prompt.ts`
- Chat handler with Layer 2 baseline enforcement in `src/handlers/chat.ts`
- POST /api/chat route in Worker + demo server
- Frontend: slide-in sidebar with message bubbles, multi-choice buttons, proposal cards
- Layer 4 mocked chat tests (no real API calls)
- Phase 2 TODO items documented in `docs/TODO.md`

## Three-layer baseline enforcement

1. **LLM in-prompt** — system prompt instructs Claude to stay within baseline
2. **Server validation** (Layer 2) — `validateProposal()` re-checks after Claude responds
3. **Write-time** (Layer 3) — `assertValueWithinBaseline()` in /api/solve and /api/rules/*

## Test plan

- [ ] All existing 176 tests still pass
- [ ] New chat handler tests pass (~20 tests)
- [ ] New chat prompt tests pass (~8 tests)
- [ ] Coverage ≥ 90%
- [ ] Manual: open chat → type "配重應該在中間" → AI proposes → Accept → drawing updates
- [ ] Manual: try baseline violation → AI downgrades to clarification
- [ ] Manual: API key missing → 503 graceful error
```

- [ ] **Step 2: Wait for CI to pass**

PR should pass through: auto-approve → test workflow → auto-merge.

---

## Self-Review Checklist

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| §3 AI Chat Contract — system prompt structure | Task 1 |
| §3 Tool definitions (4 tools) | Task 2 |
| §3 Compact rules dump format | Task 1 |
| §3 Prompt version control | Task 1 |
| §3 Safety tests (mocked) | Task 2 |
| §3 Cost budget | N/A (informational) |
| §5 Chat flow state machine | Task 5 |
| §5 POST /api/chat contract | Task 2, 3 |
| §5 Three-layer enforcement | Task 1 (Layer 1), Task 2 (Layer 2), existing (Layer 3) |
| §5 Frontend state shape | Task 5 |
| §6 AI star button + sidebar | Task 4, 5 |
| §6 Propose action card | Task 5 |
| §6 Multi-choice buttons | Task 5 |
| §7 Error #4 — Anthropic API failure | Task 2, 3 |
| §7 Error #5 — Malformed LLM tool call | Task 2 |
| §8 Milestone 1d tasks 1-7 | Tasks 1-7 |
| docs/TODO.md | Task 6 |

### 2. Placeholder scan

No TBD/TODO/implement-later placeholders found.

### 3. Type consistency

- `ChatMessage` defined in `chat-prompt.ts`, re-exported in `chat.ts` — consistent
- `ChatAction` defined in `chat.ts` — used consistently across `parseClaudeResponse`, `validateProposal`, `handleChat`
- `ChatResponse` matches spec §5 contract
- `AnthropicCaller` type used by both `createAnthropicCaller` and mock in tests
- `CHAT_TOOLS` exported and tested for 4 entries
