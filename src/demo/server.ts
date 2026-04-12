/**
 * Local dev server (Bun) — 給本機開發用。
 *
 * 生產環境走 Cloudflare Worker (src/worker/index.ts)，兩邊共用 src/handlers/*。
 *
 * Routes:
 *   GET /             → public/index.html
 *   GET /api/analysis → JSON: polygons + elevator matches（hack-canada only）
 *   POST /api/solve   → JSON: solver 產生 DXF + 分析
 *
 * Run: bun src/demo/server.ts
 */

import { join } from 'path'
import { analyzeArchDxf } from '../handlers/analyze-arch'
import {
  handleSolve,
  BaselineViolationError,
  NonStandardError,
  InvalidSolveBodyError,
} from '../handlers/solve'
import {
  handleListRules,
  handleListDeletedRules,
  handlePatchRule,
  handleDeleteRule,
  handleRestoreRule,
  handleCommit,
  InvalidRulesBodyError,
  RuleNotFoundError,
  RuleMandatoryError,
} from '../handlers/rules'
import { InMemoryRulesStore } from '../config/load'
import {
  handleChat,
  createAnthropicCaller,
  InvalidChatBodyError,
  ChatApiError,
} from '../handlers/chat'

const PUBLIC_DIR = join(import.meta.dir, '..', '..', 'public')
const HACK_CANADA_PATH = join(PUBLIC_DIR, 'assets', 'hack-canada.dxf')

const indexHtml = await Bun.file(join(PUBLIC_DIR, 'index.html')).text()
const hackCanadaDxf = await Bun.file(HACK_CANADA_PATH).text()

// Singleton store for local dev (persists across requests within this Bun process)
const rulesStore = new InMemoryRulesStore()

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      return new Response(indexHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    if (url.pathname === '/api/analysis') {
      const source = url.searchParams.get('source') || 'hack-canada'
      try {
        if (source !== 'hack-canada') {
          return Response.json({ error: `unknown source: ${source}` }, { status: 400 })
        }
        const data = analyzeArchDxf(hackCanadaDxf, source, HACK_CANADA_PATH)
        return Response.json(data)
      } catch (err) {
        return Response.json({ error: String(err), hint: `source: ${source}` }, { status: 500 })
      }
    }

    // --- Rules routes ---
    if (url.pathname === '/api/rules' && req.method === 'GET') {
      try {
        return Response.json(await handleListRules(rulesStore))
      } catch (err) {
        return handleRulesErrorBun(err)
      }
    }

    if (url.pathname === '/api/rules/deleted' && req.method === 'GET') {
      try {
        return Response.json(await handleListDeletedRules(rulesStore))
      } catch (err) {
        return handleRulesErrorBun(err)
      }
    }

    if (url.pathname === '/api/rules/commit' && req.method === 'POST') {
      try {
        const body = await req.json()
        return Response.json(await handleCommit(rulesStore, body))
      } catch (err) {
        return handleRulesErrorBun(err)
      }
    }

    const restoreMatch = url.pathname.match(/^\/api\/rules\/([^/]+)\/restore$/)
    if (restoreMatch && req.method === 'POST') {
      try {
        const key = decodeURIComponent(restoreMatch[1]!)
        return Response.json(await handleRestoreRule(rulesStore, key))
      } catch (err) {
        return handleRulesErrorBun(err)
      }
    }

    const keyMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/)
    if (keyMatch) {
      const key = decodeURIComponent(keyMatch[1]!)
      if (req.method === 'PATCH') {
        try {
          const body = await req.json()
          return Response.json(await handlePatchRule(rulesStore, key, body))
        } catch (err) {
          return handleRulesErrorBun(err)
        }
      }
      if (req.method === 'DELETE') {
        try {
          return Response.json(await handleDeleteRule(rulesStore, key))
        } catch (err) {
          return handleRulesErrorBun(err)
        }
      }
    }

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

    if (url.pathname === '/api/solve' && req.method === 'POST') {
      try {
        const body = await req.json()
        const result = await handleSolve(body, rulesStore)
        return Response.json(result)
      } catch (err) {
        if (err instanceof InvalidSolveBodyError) {
          return Response.json(
            {
              error: 'invalid_request',
              message: err.message,
              field: err.field,
            },
            { status: 400 }
          )
        }
        if (err instanceof BaselineViolationError) {
          return Response.json(
            {
              error: 'baseline_violation',
              message: err.message,
              rule_key: err.ruleKey,
              attempted_value: err.attemptedValue,
              baseline: err.baseline,
            },
            { status: 400 }
          )
        }
        if (err instanceof NonStandardError) {
          return Response.json(
            {
              error: 'non_standard',
              message: err.message,
              reason: err.reason,
              suggestion: err.suggestion,
            },
            { status: 400 }
          )
        }
        return Response.json(
          { error: 'solve_failed', message: String(err) },
          { status: 500 }
        )
      }
    }

    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 })
    }

    return new Response('Not found', { status: 404 })
  },
})

function handleRulesErrorBun(err: unknown): Response {
  if (err instanceof InvalidRulesBodyError) {
    return Response.json({ error: 'invalid_request', message: err.message }, { status: 400 })
  }
  if (err instanceof RuleNotFoundError) {
    return Response.json(
      { error: 'not_found', message: err.message, key: (err as any).key },
      { status: 404 },
    )
  }
  if (err instanceof RuleMandatoryError) {
    return Response.json(
      { error: 'mandatory_rule', message: err.message, key: (err as any).key },
      { status: 403 },
    )
  }
  if (err instanceof BaselineViolationError) {
    return Response.json(
      {
        error: 'baseline_violation',
        message: err.message,
        rule_key: err.ruleKey,
        attempted_value: err.attemptedValue,
        baseline: err.baseline,
      },
      { status: 400 },
    )
  }
  return Response.json({ error: 'internal_error', message: String(err) }, { status: 500 })
}

console.log(`CNS Elevator Configurator running at http://localhost:${server.port}`)
console.log(`Public dir: ${PUBLIC_DIR}`)
