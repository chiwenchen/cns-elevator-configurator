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
import { StaticRulesLoader } from '../config/load'

const PUBLIC_DIR = join(import.meta.dir, '..', '..', 'public')
const HACK_CANADA_PATH = join(PUBLIC_DIR, 'assets', 'hack-canada.dxf')

const indexHtml = await Bun.file(join(PUBLIC_DIR, 'index.html')).text()
const hackCanadaDxf = await Bun.file(HACK_CANADA_PATH).text()

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

    if (url.pathname === '/api/solve' && req.method === 'POST') {
      try {
        const body = await req.json()
        const loader = new StaticRulesLoader()
        const result = await handleSolve(body, loader)
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

console.log(`CNS Elevator Configurator running at http://localhost:${server.port}`)
console.log(`Public dir: ${PUBLIC_DIR}`)
