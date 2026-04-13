/**
 * Sentry 錯誤監控封裝 — 使用 toucan-js（Cloudflare Workers 專用 SDK）。
 *
 * 若 VERA_PLOT_WORKER_SENTRY_DSN 未設定（本地開發），所有呼叫皆為 no-op。
 */
import { Toucan } from 'toucan-js'

interface SentryEnv {
  VERA_PLOT_WORKER_SENTRY_DSN?: string
}

/**
 * 建立 Sentry (Toucan) 實例。DSN 未設定時回傳 null。
 */
export function createSentry(
  request: Request,
  env: SentryEnv,
  ctx: ExecutionContext,
): Toucan | null {
  if (!env.VERA_PLOT_WORKER_SENTRY_DSN) return null

  return new Toucan({
    dsn: env.VERA_PLOT_WORKER_SENTRY_DSN,
    context: ctx,
    request,
    requestDataOptions: {
      allowedHeaders: ['content-type', 'user-agent'],
      allowedSearchParams: /(.*)/,
    },
  })
}

/**
 * 安全地回報例外到 Sentry。sentry 為 null 時靜默跳過。
 */
export function captureException(
  sentry: Toucan | null,
  err: unknown,
  extras?: Record<string, unknown>,
): void {
  if (!sentry) return
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      sentry.setExtra(key, value)
    }
  }
  sentry.captureException(err)
}
