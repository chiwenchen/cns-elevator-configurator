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

interface ListRulesResponse {
  rules: TeamRule[]
  categories: RuleCategory[]
}

interface RuleCategory {
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

interface PatchRuleRequest {
  value: string
  reason?: string
}

interface PatchRuleResponse {
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

interface CommitRequest {
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
