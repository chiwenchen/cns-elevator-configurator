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
