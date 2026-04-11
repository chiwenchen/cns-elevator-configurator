# CNS Elevator Configurator

> 台灣電梯製造商內部業務工具 — 業務輸入坑道規格，app 輸出 1-3 個合法型號推薦 + 粗估價 + CNS 2866 合規章

## 專案狀態

**Week 0 — 資料可行性 spike 階段**

三個 spike 驗證必須通過才會進 Sprint 1：

| Spike | 驗證什麼 | 狀態 |
|---|---|---|
| [Spike 1: DXF parser](./spikes/spike-1-dxf-parser/) | DWG/DXF 檔能不能程式化抽坑道尺寸 | 進行中 |
| [Spike 2: CNS 2866 rules](./spikes/spike-2-cns-rules/) | CNS 2866 條文能不能結構化成 rule schema | 進行中 |
| [Spike 3: Pricing data](./spikes/spike-3-pricing-data/) | 歷史成交價資料能不能拿到 | 需要內部資料存取 |

## 設計文件

完整產品設計 → [`docs/DESIGN.md`](./docs/DESIGN.md)

文件由 gstack `/office-hours` 於 2026-04-11 產出，含問題陳述、最窄切入點、三個方案比較、Sprint 計畫、成功標準、指派任務。

## 技術棧

- Bun 1.3+ / TypeScript 5.9+
- Sprint 1: 純 TypeScript validator（deterministic 規則引擎）
- Sprint 2: Next.js 15 or Bun HTML imports + shadcn/ui + 粗估價引擎 + Matcher
- Sprint 3: 內部部署（Docker + Caddy）

## 開發

```bash
bun install
bun test
```

## 目錄結構

```
.
├── docs/
│   └── DESIGN.md              # 完整產品設計文件
├── spikes/
│   ├── spike-1-dxf-parser/    # DXF 解析 POC
│   ├── spike-2-cns-rules/     # CNS 2866 rule 草稿
│   └── spike-3-pricing-data/  # 粗估價資料規格
├── src/                       # Sprint 1 source (validator 核心)
├── CLAUDE.md                  # Claude Code 專案 context
└── README.md
```

## 指派任務提醒

設計文件「十三、指派任務」明確要求：**寫第一行 production code 前**，先跟業務主管 + 業務 champion + 資深設計師開 30 分鐘的會議。這個 repo 目前有 spike 驗證與設計文件，但 Sprint 1 實作要等會議開完 + 所有 blocker 解除才能開始。
