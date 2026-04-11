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
import { handleSolve } from '../handlers/solve'
import { NonStandardError } from '../solver/types'

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
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

    if (url.pathname === '/api/solve' && request.method === 'POST') {
      try {
        const body = await request.json()
        const result = handleSolve(body)
        return jsonResponse(result)
      } catch (err) {
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
