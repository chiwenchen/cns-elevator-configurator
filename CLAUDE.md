# CNS Elevator Configurator — Project Context

## 專案目標

台灣電梯製造商內部業務工具。業務輸入坑道規格 → app 輸出 1-3 個合法型號推薦 + 粗估價 + CNS 2866 合規章。

**使用者**：內部業務（Sales），**不是**設計師、**不是**客戶。
**量體**：年產 1000 台新梯。
**核心價值**：業務回覆客戶時間從 2-4 天 → 15 分鐘。

## 設計文件

完整設計 spec 在 `docs/DESIGN.md`。動任何 code 前先讀它。

## 當前階段

**Week 0 — 資料可行性 spike**。三個驗證必須通過才能進 Sprint 1：
1. `spikes/spike-1-dxf-parser/` — DWG/DXF 能不能 parse 出坑道尺寸？
2. `spikes/spike-2-cns-rules/` — CNS 2866 條文能不能結構化成 rule schema？
3. `spikes/spike-3-pricing-data/` — 歷史成交價資料能不能拿到？

## Tech Stack

- **Runtime**: Bun 1.3+（不要用 node / npm / yarn / pnpm）
- **Language**: TypeScript 5.9+
- **Testing**: `bun test`（built-in，不要用 jest / vitest）
- **Frontend (Sprint 2+)**: Next.js 15 or Bun HTML imports with React
- **DB (Sprint 2+)**: `bun:sqlite` for dev, `Bun.sql` for Postgres production

## 命名與術語（core schemas）

見 `docs/DESIGN.md` §五點五。四個關鍵詞不要混用：

- **validator** — 吃 (ShaftSpec, CatalogModel) 吐 ValidationResult
- **matcher** — 吃 ShaftSpec 從型錄挑 top-3
- **pricing** — 吃 model_id 吐價格區間
- **configurator** — 上面三者的組合 = 業務看到的服務

## Git Convention

- Conventional commits: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `spike: ...`
- 所有 PR 開到 `main`，禁止直接 push main（protect rules after repo creation）

## Deploy 流程（強制，無例外）

無論改動多小（即使只改一行 CSS），都必須嚴格遵守以下步驟：

1. `git checkout main && git pull --rebase`
2. `git checkout -b <feature-branch>`
3. 開發 + 測試（`bun test` 全部通過，coverage ≥ 90%）
4. `git push -u origin <branch>` + `gh pr create` + 等待 merge 完成
5. `git checkout main && git pull --rebase`
6. `wrangler deploy`

**絕對禁止：**
- 在 main branch 上直接 commit
- 在 PR merge 之前 deploy
- 跳過任何一個步驟

## 不要

- ❌ 不要寫 DXF 輸出（v1 out of scope）
- ❌ 不要整合 AutoCAD
- ❌ 不要做主管儀表板
- ❌ 不要對外公開 API（內部工具）
- ❌ 不要把歷史案例 / 成交價上傳到外部 LLM
