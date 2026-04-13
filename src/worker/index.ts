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
import {
  handleChat,
  createAnthropicCaller,
  InvalidChatBodyError,
  ChatApiError,
} from '../handlers/chat'
import {
  handleRequestOtp,
  handleVerifyOtp,
  handleLogout,
  handleMe,
  AuthError,
} from '../handlers/auth'
import {
  handleListDesigns,
  handleListArchivedDesigns,
  handleGetDesign,
  handleArchiveDesign,
  handleUnarchiveDesign,
  handleDeleteDesign,
  DesignError,
} from '../handlers/designs'
import {
  handleCreateCompany,
  handleGetCompany,
  handleInvite,
  handleJoinCompany,
  handleLeaveCompany,
  handleRemoveMember,
  CompanyError,
} from '../handlers/company'
import {
  handleListUsers,
  handleUpdateRole,
  AdminError,
} from '../handlers/admin'
import { parseCookie, extractUser, shouldRunCleanup, SESSION_COOKIE_NAME } from '../auth/middleware'
import type { AuthUser } from '../auth/middleware'
import { createOtpSender, createInviteSender } from '../auth/resend'
import { getWeekStartUtc, getQuotaLimits } from '../config/quota'
import { createSentry, captureException } from './sentry'

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>
      first<T = unknown>(): Promise<T | null>
      run(): Promise<void>
    }
    all<T = unknown>(): Promise<{ results: T[] }>
    first<T = unknown>(): Promise<T | null>
  }
}

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  DB: D1Database
  ANTHROPIC_API_KEY?: string
  JWT_SECRET: string
  RESEND_API_KEY: string
  VERA_PLOT_WORKER_SENTRY_DSN?: string
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

function handleRulesError(err: unknown, sentry: import('toucan-js').Toucan | null = null): Response {
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
  captureException(sentry, err)
  return jsonResponse(
    { error: 'internal_error', message: String(err) },
    { status: 500 },
  )
}

async function resolveAuthUser(request: Request, env: Env): Promise<AuthUser | null> {
  const cookieHeader = request.headers.get('cookie')
  const cookieValue = parseCookie(cookieHeader, SESSION_COOKIE_NAME)
  const payload = await extractUser(cookieValue, env.JWT_SECRET)
  if (!payload) return null

  const sessionId = payload.jti
  const now = new Date().toISOString()

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.raw_email, u.role, u.company_id, s.id as session_id
     FROM users u JOIN sessions s ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(sessionId, now).first<{
    id: string
    email: string
    raw_email: string
    role: string
    company_id: string | null
    session_id: string
  }>()

  if (!row) return null

  // Probabilistic cleanup (1% chance): remove expired sessions
  if (shouldRunCleanup()) {
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(now).run()
  }

  return {
    id: row.id,
    email: row.email,
    raw_email: row.raw_email,
    role: row.role,
    company_id: row.company_id,
    session_id: row.session_id,
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const sentry = createSentry(request, env, ctx)
    const url = new URL(request.url)

    try {
    return await handleRequest(request, env, url, sentry)
    } catch (err) {
      captureException(sentry, err, { route: url.pathname, method: request.method })
      return jsonResponse({ error: 'internal_error', message: 'unexpected server error' }, { status: 500 })
    }
  },
}

async function handleRequest(
  request: Request,
  env: Env,
  url: URL,
  sentry: import('toucan-js').Toucan | null,
): Promise<Response> {
    // Sentry context: route + method
    sentry?.setTag('route', url.pathname)
    sentry?.setTag('method', request.method)

    // Wrapper: resolve auth user and set Sentry user context
    const resolveAuth = async (): Promise<AuthUser | null> => {
      const user = await resolveAuthUser(request, env)
      if (user && sentry) {
        sentry.setUser({ id: user.id, email: user.email })
      }
      return user
    }

    // --- Redirect elevator-configurator → vera-plot ---
    if (url.hostname === 'elevator-configurator.redarch.dev') {
      const target = new URL(url.pathname + url.search, 'https://vera-plot.redarch.dev')
      return Response.redirect(target.toString(), 301)
    }

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
        captureException(sentry, err, { route: '/api/analysis', source })
        return jsonResponse(
          { error: String(err), hint: `source: ${source}` },
          { status: 500 }
        )
      }
    }

    // --- Auth routes ---
    if (url.pathname === '/api/auth/request-otp' && request.method === 'POST') {
      try {
        const body = await request.json() as { email?: string }
        const sendOtp = createOtpSender(env.RESEND_API_KEY)
        const result = await handleRequestOtp(body, env.DB, sendOtp)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof AuthError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/auth/verify-otp' && request.method === 'POST') {
      try {
        const body = await request.json() as { email?: string; code?: string }
        const result = await handleVerifyOtp(body, env.DB, env.JWT_SECRET)
        return jsonResponse({ user: result.user, is_new: result.is_new }, {
          headers: { 'Set-Cookie': result.cookie }
        })
      } catch (err) {
        if (err instanceof AuthError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleLogout(user.session_id, env.DB)
        return jsonResponse({ ok: result.ok }, {
          headers: { 'Set-Cookie': result.cookie }
        })
      } catch (err) {
        if (err instanceof AuthError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleMe(user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof AuthError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    // --- Design routes ---
    if (url.pathname === '/api/designs' && request.method === 'GET') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleListDesigns(user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/designs/archived' && request.method === 'GET') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleListArchivedDesigns(user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    const designIdMatch = url.pathname.match(/^\/api\/designs\/([^/]+)$/)
    if (designIdMatch) {
      const designId = designIdMatch[1]!
      if (request.method === 'GET') {
        try {
          const user = await resolveAuth()
          if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
          const result = await handleGetDesign(designId, user, env.DB)
          return jsonResponse(result)
        } catch (err) {
          if (err instanceof DesignError) {
            return jsonResponse({ error: err.message }, { status: err.status })
          }
          captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
        }
      }
      if (request.method === 'DELETE') {
        try {
          const user = await resolveAuth()
          if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
          const result = await handleDeleteDesign(designId, user, env.DB)
          return jsonResponse(result)
        } catch (err) {
          if (err instanceof DesignError) {
            return jsonResponse({ error: err.message }, { status: err.status })
          }
          captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
        }
      }
    }

    const archiveMatch = url.pathname.match(/^\/api\/designs\/([^/]+)\/archive$/)
    if (archiveMatch && request.method === 'POST') {
      try {
        const designId = archiveMatch[1]!
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleArchiveDesign(designId, user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    const unarchiveMatch = url.pathname.match(/^\/api\/designs\/([^/]+)\/unarchive$/)
    if (unarchiveMatch && request.method === 'POST') {
      try {
        const designId = unarchiveMatch[1]!
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleUnarchiveDesign(designId, user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    // --- Company routes ---
    if (url.pathname === '/api/company' && request.method === 'POST') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const body = await request.json() as { name?: string }
        const result = await handleCreateCompany(body, user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/company' && request.method === 'GET') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleGetCompany(user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/company/invite' && request.method === 'POST') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const body = await request.json() as { email?: string }
        const sendInvite = createInviteSender(env.RESEND_API_KEY)
        const result = await handleInvite(body, user, env.DB, sendInvite)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    const joinMatch = url.pathname.match(/^\/api\/company\/join\/([^/]+)$/)
    if (joinMatch && request.method === 'POST') {
      try {
        const token = joinMatch[1]!
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleJoinCompany(token, user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/company/leave' && request.method === 'POST') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleLeaveCompany(user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    const removeMemberMatch = url.pathname.match(/^\/api\/company\/members\/([^/]+)$/)
    if (removeMemberMatch && request.method === 'DELETE') {
      try {
        const targetUserId = removeMemberMatch[1]!
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        const result = await handleRemoveMember(targetUserId, user, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    // --- Admin routes ---
    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        if (user.role !== 'admin') return jsonResponse({ error: 'forbidden' }, { status: 403 })
        const result = await handleListUsers(env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof AdminError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
    if (adminUserMatch && request.method === 'PATCH') {
      try {
        const targetId = adminUserMatch[1]!
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized' }, { status: 401 })
        if (user.role !== 'admin') return jsonResponse({ error: 'forbidden' }, { status: 403 })
        const body = await request.json() as { role?: string }
        const result = await handleUpdateRole(targetId, body, env.DB)
        return jsonResponse(result)
      } catch (err) {
        if (err instanceof AdminError) {
          return jsonResponse({ error: err.message }, { status: err.status })
        }
        captureException(sentry, err, { route: url.pathname })
        return jsonResponse({ error: String(err) }, { status: 500 })
      }
    }

    // --- Rules routes ---
    if (url.pathname === '/api/rules' && request.method === 'GET') {
      try {
        const store = new D1RulesStore(env.DB as any)
        const result = await handleListRules(store)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err, sentry)
      }
    }

    if (url.pathname === '/api/rules/deleted' && request.method === 'GET') {
      try {
        const store = new D1RulesStore(env.DB as any)
        const result = await handleListDeletedRules(store)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err, sentry)
      }
    }

    if (url.pathname === '/api/rules/commit' && request.method === 'POST') {
      try {
        const body = await request.json()
        const store = new D1RulesStore(env.DB as any)
        const result = await handleCommit(store, body)
        return jsonResponse(result)
      } catch (err) {
        return handleRulesError(err, sentry)
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
        return handleRulesError(err, sentry)
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
          return handleRulesError(err, sentry)
        }
      }
      if (request.method === 'DELETE') {
        try {
          const result = await handleDeleteRule(store, key)
          return jsonResponse(result)
        } catch (err) {
          return handleRulesError(err, sentry)
        }
      }
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonResponse(
          { error: 'not_configured', message: 'AI 功能尚未啟用（缺少 API key）' },
          { status: 503 },
        )
      }
      try {
        const user = await resolveAuth()
        if (!user) return jsonResponse({ error: 'unauthorized', message: '請先登入' }, { status: 401 })

        // Check AI quota
        const weekStart = getWeekStartUtc()
        let members: Array<{ role: string }>
        if (user.company_id) {
          const result = await env.DB.prepare(
            `SELECT role FROM users WHERE company_id = ?`
          ).bind(user.company_id).all<{ role: string }>()
          members = result.results
        } else {
          members = [{ role: user.role }]
        }
        const limits = getQuotaLimits(members)

        let aiUsed: number
        if (user.company_id) {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM chat_sessions WHERE created_at >= ? AND user_id IN (SELECT id FROM users WHERE company_id = ?)`
          ).bind(weekStart, user.company_id).first<{ count: number }>()
          aiUsed = row?.count ?? 0
        } else {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) as count FROM chat_sessions WHERE created_at >= ? AND user_id = ?`
          ).bind(weekStart, user.id).first<{ count: number }>()
          aiUsed = row?.count ?? 0
        }

        if (aiUsed >= limits.ai_limit) {
          return jsonResponse(
            { error: 'quota_exceeded', message: `本週 AI 對話次數已達上限（${limits.ai_limit} 次），將於下週一重置。` },
            { status: 429 },
          )
        }

        const body = await request.json()
        const loader = new D1RulesLoader(env.DB)
        const caller = createAnthropicCaller(env.ANTHROPIC_API_KEY)
        const result = await handleChat(body, loader, caller)

        // Record AI usage (chat_sessions has NOT NULL columns: case_snapshot, messages, status)
        const sessionId = crypto.randomUUID()
        await env.DB.prepare(
          `INSERT INTO chat_sessions (id, case_snapshot, messages, status, user_id, company_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(sessionId, '{}', '[]', 'active', user.id, user.company_id, new Date().toISOString()).run()

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
        captureException(sentry, err, { route: '/api/chat' })
        return jsonResponse(
          { error: 'chat_failed', message: String(err) },
          { status: 500 },
        )
      }
    }

    if (url.pathname === '/api/solve' && request.method === 'POST') {
      try {
        const body = await request.json()
        const loader = new D1RulesLoader(env.DB)
        const user = await resolveAuth()
        const result = await handleSolve(body, loader, user, env.DB)
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
        if ((err as any)?.name === 'QuotaExceededError') {
          return jsonResponse(
            { error: 'quota_exceeded', message: (err as Error).message },
            { status: 429 }
          )
        }
        captureException(sentry, err, { route: '/api/solve' })
        return jsonResponse(
          { error: 'solve_failed', message: String(err) },
          { status: 500 }
        )
      }
    }

    // --- Static assets ---
    // Let Workers Assets serve /, /index.html, /assets/*, /favicon.ico, etc.
    return env.ASSETS.fetch(request)
}
