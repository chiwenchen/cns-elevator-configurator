# Vera Plot — Project Context

## 專案目標

台灣電梯製造商內部業務工具。業務輸入坑道規格或需求條件，系統自動生成合規電梯設計圖 (DXF)，搭配 AI 設計指引助理。

**使用者**：內部業務（Sales），**不是**設計師、**不是**客戶。
**量體**：年產 1000 台新梯。
**核心價值**：業務回覆客戶時間從 2-4 天 → 15 分鐘。
**線上版**：https://vera-plot.redarch.dev

## 設計文件

- 完整設計 spec：`docs/superpowers/specs/2026-04-12-guidance-system-design.md`
- RWD mobile spec：`docs/superpowers/specs/2026-04-13-rwd-mobile-design.md`
- 開發者技術文件：`PROJECT.md`
- Phase 2 延遲項目：`docs/TODO.md`

## Tech Stack

- **Runtime**: Bun 1.3+（不要用 node / npm / yarn / pnpm）
- **Language**: TypeScript 5.9+
- **Testing**: `bun test`（built-in，不要用 jest / vitest）
- **Deployment**: Cloudflare Workers + D1 (SQLite at edge)
- **AI**: Anthropic Claude Sonnet 4.6 (model ID: `claude-sonnet-4-6`)
- **Frontend**: Vanilla JS + CSS（單一 index.html，無框架）
- **Monitoring**: Sentry (Worker: toucan-js, Browser: @sentry/browser)
- **Email**: Resend (OTP 驗證碼)

## Git Convention

- Conventional commits: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`
- 所有 PR 開到 `main`，禁止直接 push main

## Deploy 流程（強制，無例外）

無論改動多小（即使只改一行 CSS），都必須嚴格遵守以下步驟：

1. `git checkout main && git pull --rebase`
2. `git checkout -b <feature-branch>`
3. 開發 + 測試（`bun test` 全部通過，coverage >= 90%）
4. `git push -u origin <branch>` + `gh pr create` + 等待 merge 完成
5. CI 自動 deploy（deploy.yml 注入版本號後 wrangler deploy）

**絕對禁止：**
- 在 main branch 上直接 commit
- 在 PR merge 之前 deploy
- 跳過任何一個步驟

## 不要

- 不要對外公開 API（內部工具）
- 不要把歷史案例 / 成交價上傳到外部 LLM
- 不要在 public/index.html 使用 emoji（使用者認為廉價）
