/**
 * Cloudflare Worker entrypoint — 生產環境部署版本。
 *
 * 靜態資源（index.html, assets/*.dxf）走 Workers Assets binding。
 * API 路由共用 src/handlers/*（跟 local Bun server 同一份邏輯）。
 *
 * wrangler.toml:
 *   main   = "src/worker/index.ts"
 *   assets = { directory = "./public", binding = "ASSETS" }
 */

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
import { D1RulesLoader, D1RulesStore } from '../config/load'

interface D1Database {
  prepare(query: string): {
    all<T = unknown>(): Promise<{ results: T[] }>
  }
}

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  DB: D1Database
}

// Cache the hack-canada DXF text for the lifetime of the isolate.
let cachedHackCanadaText: string | null = null

async function loadHackCanada(env: Env, request: Request): Promise<string> {
  if (cachedHackCanadaText) return cachedHackCanadaText
  const assetUrl = new URL('/assets/hack-canada.dxf', request.url)
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString()))
  if (!res.ok) {
    throw new Error(`Failed to load hack-canada.dxf: ${res.status}`)
  }
  cachedHackCanadaText = await res.text()
  return cachedHackCanadaText
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  })
}

function handleRulesError(err: unknown): Response {
  if (err instanceof InvalidRulesBodyError) {
    return jsonResponse({ error: 'invalid_request', message: err.message }, { status: 400 })
  }
  if (err instanceof RuleNotFoundError) {
    return jsonResponse(
      { error: 'not_found', message: err.message, key: (err as any).key },
      { status: 404 },
    )
  }
  if (err instanceof RuleMandatoryError) {
    return jsonResponse(
      { error: 'mandatory_rule', message: err.message, key: (err as any).key },
      { status: 403 },
    )
  }
  if (err instanceof BaselineViolationError) {
    return jsonResponse(
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
  return jsonResponse(
    { error: 'internal_error', message: String(err) },
    { status: 500 },
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // --- API routes ---
    if (url.pathname === '/api/analysis') {
      const source = url.searchParams.get('source') || 'hack-canada'
      try {
        if (source !== 'hack-canada') {
          return jsonResponse({ error: `unknown source: ${source}` }, { status: 400 })
        }
        const dxfText = await loadHackCanada(env, request)
        const data = analyzeArchDxf(dxfText, source, '/assets/hack-canada.dxf')
        return jsonResponse(data)
      } catch (err) {
        return jsonResponse(
          { error: String(err), hint: `source: ${source}` },
          { status: 500 }
        )
      }
    }

    // --- Rules routes ---
    if (url.pathname === '/api/rules' && request.method === 'GET') {
      try {
        const store = new D1RulesStore(env.DB as any)
        const result = await handleListRules(store)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err)
      }
    }

    if (url.pathname === '/api/rules/deleted' && request.method === 'GET') {
      try {
        const store = new D1RulesStore(env.DB as any)
        const result = await handleListDeletedRules(store)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err)
      }
    }

    if (url.pathname === '/api/rules/commit' && request.method === 'POST') {
      try {
        const body = await request.json()
        const store = new D1RulesStore(env.DB as any)
        const result = await handleCommit(store, body)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err)
      }
    }

    // /api/rules/:key/restore (POST)
    const restoreMatch = url.pathname.match(/^\/api\/rules\/([^/]+)\/restore$/)
    if (restoreMatch && request.method === 'POST') {
      try {
        const key = decodeURIComponent(restoreMatch[1]!)
        const store = new D1RulesStore(env.DB as any)
        const result = await handleRestoreRule(store, key)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err)
      }
    }

    // /api/rules/:key (PATCH/DELETE)
    const keyMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/)
    if (keyMatch) {
      const key = decodeURIComponent(keyMatch[1]!)
      const store = new D1RulesStore(env.DB as any)
      if (request.method === 'PATCH') {
        try {
          const body = await request.json()
          const result = await handlePatchRule(store, key, body)
          return jsonResponse(result)
        } catch (err) {
          return handleRulesError(err)
        }
      }
      if (request.method === 'DELETE') {
        try {
          const result = await handleDeleteRule(store, key)
          return jsonResponse(result)
        } catch (err) {
          return handleRulesError(err)
        }
      }
    }

    if (url.pathname === '/api/solve' && request.method === 'POST') {
      try {
        const body = await request.json()
        const loader = new D1RulesLoader(env.DB)
        const result = await handleSolve(body, loader)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof InvalidSolveBodyError) {
          return jsonResponse(
            {
              error: 'invalid_request',
              message: err.message,
              field: err.field,
            },
            { status: 400 }
          )
        }
        if (err instanceof BaselineViolationError) {
          return jsonResponse(
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
          return jsonResponse(
            {
              error: 'non_standard',
              message: err.message,
              reason: err.reason,
              suggestion: err.suggestion,
            },
            { status: 400 }
          )
        }
        return jsonResponse(
          { error: 'solve_failed', message: String(err) },
          { status: 500 }
        )
      }
    }

    // --- Static assets ---
    // Let Workers Assets serve /, /index.html, /assets/*, /favicon.ico, etc.
    return env.ASSETS.fetch(request)
  },
}
