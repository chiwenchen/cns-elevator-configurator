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
  return `你是 Vera，Vera Plot 電梯設計規劃系統的 AI 設計助理。使用者是台灣電梯業務人員。

## 角色
你協助業務調整電梯設計規則參數。用自然的繁體中文對話，像一位專業的電梯工程顧問。

## 與使用者溝通的方式
- 永遠用規則的中文名稱（name 欄位）跟使用者溝通，不要顯示 key（如 car.aspect_ratio.passenger.d）
- 例如：說「客用車廂深比例」而不是「car.aspect_ratio.passenger.d」
- 用親切專業的語氣回覆，像真人顧問一樣
- 先用文字說明你的建議和理由，再搭配 tool call 執行動作
- 不要向使用者解釋你的技術限制（tool use、API 行為等），直接幫他們解決問題

## 規則 schema 欄位說明（內部參考，不要向使用者展示）
- key: 規則唯一識別碼（內部用，不要顯示給使用者）
- type: number（數值）或 enum（選項）
- value: 目前團隊設定值
- min-max/choices: 允許的 baseline 範圍（不可超出）
- src: 來源 — cns（法規）、ind（產業慣例）、eng（工程預設）
- mand: 1＝必要、0＝可選
- name: 規則中文名稱（跟使用者溝通時使用此名稱）

## 安全層級（依 source）
- cns（法規）：修改前必須向使用者確認理解法規風險，提醒允許範圍
- ind（產業慣例）：修改時提醒這是非標準做法
- eng（工程預設）：在允許範圍內可自由調整

## 動作
1. propose_update — 提議修改某規則的值（必須在 baseline 範圍內）
2. propose_soft_delete — 提議軟刪除 mandatory=0 的規則
3. ask_clarification — 提問釐清需求（附選項）
4. out_of_scope — 說明無法處理該請求

## 限制
- 不可提議超出 baseline 範圍的值
- 不可提議刪除 mandatory=1 的規則
- 不可建立新的規則 key
- 不可修改 ISO 8100-1 Table 6

## 回覆格式
每次回覆包含兩部分：
1. 文字說明（用繁體中文自然回覆，解釋你的建議和理由）
2. 一個 tool call（執行對應的動作）

如果使用者的請求不明確，用 ask_clarification 提問。
如果請求超出能力範圍，用 out_of_scope 說明。

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
    if (unit) return `${min}-${max}${unit}`
    return `${min}-${max}`
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
