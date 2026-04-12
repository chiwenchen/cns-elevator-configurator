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
    // Extra fields like timestamp should be stripped — Anthropic API rejects them
    expect(parsed.messages[0]).toEqual({ role: 'user', content: '配重位置在中間' })
    expect((parsed.messages[0] as any).timestamp).toBeUndefined()
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
    // No text block — assistantMessage falls back to input.message for consistency
    expect(result.assistantMessage).toBe('抱歉，這超出了我的能力範圍。')
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
    expect(res.action.type).toBe('propose_update')
    if (res.action.type === 'propose_update') {
      expect(res.action.current_value).toBe('back_left') // default from baseline
    }
  })

  test('propose_soft_delete happy path on non-mandatory rule (cwt.position)', async () => {
    const caller = mockAnthropicCaller(
      'propose_soft_delete',
      { key: 'cwt.position', reasoning: '此案不需要配重位置限制' },
      '建議移除配重位置規則。',
    )
    const body = {
      session_id: 'sess-8',
      messages: [{ role: 'user', content: '移除配重位置規則', timestamp: 1000 }],
      case_context: {
        solver_input: { mode: 'B', rated_load_kg: 1000, stops: 6, usage: 'passenger' },
        current_case_override: {},
      },
    }
    const res = await handleChat(body, store, caller)
    // cwt.position is mandatory=0 in baseline, so soft-delete should be allowed
    expect(res.action.type).toBe('propose_soft_delete')
    if (res.action.type === 'propose_soft_delete') {
      expect(res.action.rule_key).toBe('cwt.position')
      expect(res.action.reasoning).toBe('此案不需要配重位置限制')
    }
    expect(res.assistant_message).toBe('建議移除配重位置規則。')
    expect(res.session_id).toBe('sess-8')
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
