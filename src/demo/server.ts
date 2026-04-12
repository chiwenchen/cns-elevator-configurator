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
import { getWeekStartUtc, getQuotaLimits } from '../config/quota'

const PUBLIC_DIR = join(import.meta.dir, '..', '..', 'public')
const HACK_CANADA_PATH = join(PUBLIC_DIR, 'assets', 'hack-canada.dxf')

const indexHtml = await Bun.file(join(PUBLIC_DIR, 'index.html')).text()
const hackCanadaDxf = await Bun.file(HACK_CANADA_PATH).text()

// Singleton store for local dev (persists across requests within this Bun process)
const rulesStore = new InMemoryRulesStore()

const DEV_JWT_SECRET = 'dev-secret-for-local-testing-only'

// Mock OTP sender: logs to console instead of sending email
const mockOtpSender = async (to: string, code: string): Promise<void> => {
  console.log(`[DEV] OTP for ${to}: ${code}`)
}

// Mock invite sender: logs to console instead of sending email
const mockInviteSender = async (to: string, inviterEmail: string, companyName: string, token: string): Promise<void> => {
  console.log(`[DEV] Invite for ${to} from ${inviterEmail} to join ${companyName}: token=${token}`)
}

// In-memory DB stub for dev (no real DB in local dev — returns null for all queries)
const devDb: any = {
  prepare(query: string) {
    return {
      bind(..._values: unknown[]) {
        return {
          async all() { return { results: [] } },
          async first() { return null },
          async run() { return },
        }
      },
      async all() { return { results: [] } },
      async first() { return null },
    }
  }
}

async function resolveAuthUserDev(req: Request): Promise<AuthUser | null> {
  const cookieHeader = req.headers.get('cookie')
  const cookieValue = parseCookie(cookieHeader, SESSION_COOKIE_NAME)
  const payload = await extractUser(cookieValue, DEV_JWT_SECRET)
  if (!payload) return null

  // In dev we don't have a real DB, so we trust the JWT payload directly
  return {
    id: payload.sub,
    email: `${payload.sub}@dev.local`,
    raw_email: `${payload.sub}@dev.local`,
    role: payload.role ?? 'user',
    company_id: null,
    session_id: payload.jti,
  }
}

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

    // --- Auth routes ---
    if (url.pathname === '/api/auth/request-otp' && req.method === 'POST') {
      try {
        const body = await req.json() as { email?: string }
        const result = await handleRequestOtp(body, devDb, mockOtpSender)
        return Response.json(result)
      } catch (err) {
        if (err instanceof AuthError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/auth/verify-otp' && req.method === 'POST') {
      try {
        const body = await req.json() as { email?: string; code?: string }
        const result = await handleVerifyOtp(body, devDb, DEV_JWT_SECRET)
        return new Response(JSON.stringify({ user: result.user, is_new: result.is_new }), {
          headers: {
            'content-type': 'application/json',
            'Set-Cookie': result.cookie,
          },
        })
      } catch (err) {
        if (err instanceof AuthError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleLogout(user.session_id, devDb)
        return new Response(JSON.stringify({ ok: result.ok }), {
          headers: {
            'content-type': 'application/json',
            'Set-Cookie': result.cookie,
          },
        })
      } catch (err) {
        if (err instanceof AuthError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleMe(user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof AuthError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // --- Design routes ---
    if (url.pathname === '/api/designs' && req.method === 'GET') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleListDesigns(user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/designs/archived' && req.method === 'GET') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleListArchivedDesigns(user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const designIdMatch = url.pathname.match(/^\/api\/designs\/([^/]+)$/)
    if (designIdMatch) {
      const designId = designIdMatch[1]!
      if (req.method === 'GET') {
        try {
          const user = await resolveAuthUserDev(req)
          if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
          const result = await handleGetDesign(designId, user, devDb)
          return Response.json(result)
        } catch (err) {
          if (err instanceof DesignError) {
            return Response.json({ error: err.message }, { status: err.status })
          }
          return Response.json({ error: String(err) }, { status: 500 })
        }
      }
      if (req.method === 'DELETE') {
        try {
          const user = await resolveAuthUserDev(req)
          if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
          const result = await handleDeleteDesign(designId, user, devDb)
          return Response.json(result)
        } catch (err) {
          if (err instanceof DesignError) {
            return Response.json({ error: err.message }, { status: err.status })
          }
          return Response.json({ error: String(err) }, { status: 500 })
        }
      }
    }

    const archiveMatch = url.pathname.match(/^\/api\/designs\/([^/]+)\/archive$/)
    if (archiveMatch && req.method === 'POST') {
      try {
        const designId = archiveMatch[1]!
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleArchiveDesign(designId, user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const unarchiveMatch = url.pathname.match(/^\/api\/designs\/([^/]+)\/unarchive$/)
    if (unarchiveMatch && req.method === 'POST') {
      try {
        const designId = unarchiveMatch[1]!
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleUnarchiveDesign(designId, user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof DesignError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // --- Company routes ---
    if (url.pathname === '/api/company' && req.method === 'POST') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const body = await req.json() as { name?: string }
        const result = await handleCreateCompany(body, user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/company' && req.method === 'GET') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleGetCompany(user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/company/invite' && req.method === 'POST') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const body = await req.json() as { email?: string }
        const result = await handleInvite(body, user, devDb, mockInviteSender)
        return Response.json(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const joinMatch = url.pathname.match(/^\/api\/company\/join\/([^/]+)$/)
    if (joinMatch && req.method === 'POST') {
      try {
        const token = joinMatch[1]!
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleJoinCompany(token, user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (url.pathname === '/api/company/leave' && req.method === 'POST') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleLeaveCompany(user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const removeMemberMatch = url.pathname.match(/^\/api\/company\/members\/([^/]+)$/)
    if (removeMemberMatch && req.method === 'DELETE') {
      try {
        const targetUserId = removeMemberMatch[1]!
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        const result = await handleRemoveMember(targetUserId, user, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof CompanyError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // --- Admin routes ---
    if (url.pathname === '/api/admin/users' && req.method === 'GET') {
      try {
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 })
        const result = await handleListUsers(devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof AdminError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
    if (adminUserMatch && req.method === 'PATCH') {
      try {
        const targetId = adminUserMatch[1]!
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
        if (user.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 })
        const body = await req.json() as { role?: string }
        const result = await handleUpdateRole(targetId, body, devDb)
        return Response.json(result)
      } catch (err) {
        if (err instanceof AdminError) {
          return Response.json({ error: err.message }, { status: err.status })
        }
        return Response.json({ error: String(err) }, { status: 500 })
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
        const user = await resolveAuthUserDev(req)
        if (!user) return Response.json({ error: 'unauthorized', message: '請先登入' }, { status: 401 })

        // In dev: skip quota check (no real DB)
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
        const user = await resolveAuthUserDev(req)
        const result = await handleSolve(body, rulesStore, user, null)
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
        if ((err as any)?.name === 'QuotaExceededError') {
          return Response.json(
            { error: 'quota_exceeded', message: (err as Error).message },
            { status: 429 }
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
