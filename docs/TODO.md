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
