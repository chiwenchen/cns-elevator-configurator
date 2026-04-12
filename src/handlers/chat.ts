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
  tool_choice: { type: 'any' | 'auto' | 'tool' }
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
          current_value: '', // filled by validateProposal after baseline check
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
        assistantMessage: assistantMessage || String(input.message || ''),
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
    // Valid — enrich with current_value from rule
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

  // 3. Build prompts (buildDynamicContext takes 3 params; chat history is passed separately)
  const systemPrompt = buildSystemPrompt()
  const dynamicContext = buildDynamicContext(
    teamRules,
    body.case_context.solver_input,
    body.case_context.current_case_override,
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
      model: 'claude-sonnet-4-5-20250514',
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

  // If Layer 2 downgraded a proposal to ask_clarification, surface the rejection reason
  const wasProposal =
    parsed.action.type === 'propose_update' || parsed.action.type === 'propose_soft_delete'
  const wasDowngraded = wasProposal && validatedAction.type === 'ask_clarification'
  const assistantMessage =
    wasDowngraded
      ? parsed.assistantMessage + '\n\n' + (validatedAction as { type: 'ask_clarification'; question: string; choices: string[] }).question
      : parsed.assistantMessage

  return {
    assistant_message: assistantMessage,
    action: validatedAction,
    session_id: body.session_id,
    prompt_version: SYSTEM_PROMPT_VERSION,
  }
}
