# 設計文件：CNS 電梯配件器 MVP (業務內部工具)

由 /office-hours 產出 — 2026-04-11
Branch: main
Repo: chiwenchen/cns-elevator-configurator
狀態: 草稿 v0.3（DXF 生成器轉向）
模式: 創業模式 (內部創業變體)

> **🚨 v0.3 重要轉向 — 2026-04-11**：經業務端真實需求澄清，產品的**輸出形式**從「型號推薦 + 規格卡 + 粗估價」改為「**可行性草稿 DXF**（平面圖 + 側面圖 + 尺寸標示）」，並支援**雙向輸入**：(A) 給定坑道空間 → 生成電梯設計；(B) 給定載重/用途需求 → 推算最小坑道。GTM 論述不變（業務 2-4 天 → 5 分鐘），但核心技術能力從 `catalog lookup` 變為 `parametric CAD writer`。Spike 4 (`spikes/spike-4-dxf-writer/`) 已驗證純 TypeScript 產 DXF 可行。
>
> **v0.2 的法規基礎更新保留**：CNS 2866 已廢止，改用 CNS 15827-20 / 15827-31 / 15827-50 系列，詳見 `spikes/spike-2-cns-rules/README.md`。

---

## 一、問題陳述

**誰在受苦**：一家年產 1000 台新梯的台灣電梯製造商，內部業務團隊每次客戶詢價，都得等設計師花 2 天**畫一張可行性草稿 DXF**（含平面 + 側面 + 尺寸），才能回覆客戶。

**週期時間**：客戶詢價 → 業務手上有圖可以講，今天是 **2 到 4 天**。熱 lead 在 24 到 48 小時內會冷掉。

**核心的痛** — 業務遇到兩種典型情境，兩種都卡：

1. **Mode A（空間 → 電梯）**：客戶說「我這個機電房空了 2m × 2.2m × 18m 給電梯，你們能裝什麼？」業務只能回「我請設計師算一下，兩天內給你答覆」。
2. **Mode B（需求 → 空間）**：客戶說「我要 750 kg 載重的電梯，坑道要預留多大？」業務一樣只能回「我請設計師算一下」。

**真正能讓業務變快的東西不是「型號卡 + 規格」，是「一張能直接給客戶看的 DXF 草稿」** — 客戶看圖才有感，看型號編號沒感覺。

**看不見的血**：每個拖 2 天的報價都是一次被競爭對手接走的風險。以 1000 台/年量體，即便 close rate 只掉 5 個百分點，每年就是 50 台 × NT$80–150 萬 = **NT$4000–7500 萬的營收流失**。這個數字遠大於「節省設計師人力成本」的敘事。

**為什麼這次 pivot 沒打壞 GTM**：核心論述「業務自助、2 天 → 5 分鐘、close rate 提升」完全不變。只是「業務手上拿到的東西」從「推薦型號 SF-750-60 + 粗估價 80 萬」改成「一張 2m × 2.2m 坑道 + 1400mm × 1350mm 車廂 + 6 層樓側面圖 + 合規章的 DXF 草稿」。後者對客戶更有說服力、對業務更好用。

## 二、需求證據

- 量體：**一年 1000 台新梯**（使用者確認）
- 當前設計週期：**每案 2 天**，錯了要從頭重做（使用者確認）
- 設計流程：設計師用 AutoCAD 手繪 + 人工翻 CNS 15827-20 查表 + 無自動驗證（使用者確認）
- 產品型錄：**標準型錄為主 + 20% 非標特例**（使用者確認）
- 歷史資料：**有歷史案例 CAD 檔**（使用者確認 — 這是第一週最重要的金礦）
- CNS 條文取得：**不是問題**（使用者確認 — 公司內部已有可用來源）

**這不是「會不會有人用」的問題。每天有 3-4 個業務等著回覆客戶，每天有 3-4 個設計師被業務打斷。需求是連續的、已知的、可量測的。**

## 三、現況流程

**今天的流程（根據使用者描述觀察）**：

```
客戶來電 / Email
  ↓
業務接件 → 紀錄坑道規格 + 需求（Excel / Email / 紙本）
  ↓
業務丟給設計師（可能是工單、可能是口頭、可能是 LINE）
  ↓
設計師排隊處理（可能今天、可能明天）
  ↓
設計師開 AutoCAD → 根據坑道尺寸繪製可行電梯設計
  ↓
設計師對照 CNS 15827-20 條文 PDF → 手動檢查合規
  ↓
發現錯誤 → 重畫（另一個 2 天）
  ↓
設計完成 → 交回業務 → 業務整理報價 → 回覆客戶

總時長: 2 到 4 天
退件重做率（保守推估）: 10% 到 15%
```

**替代方案（workarounds）**：沒有。這就是 workaround — 純人工、純經驗、純體力。沒有內部工具、沒有 Excel 計算模板、沒有 CNS 結構化資料庫。

## 四、目標使用者與最窄切入點

**主要使用者 = 內部業務（Sales）**
- 每天接客戶電話，**不進 AutoCAD**
- 要的是「一張能當場丟給客戶看的 DXF 草稿 + 合規章 + 幾個關鍵尺寸」
- 速度比精度重要（5 分鐘出圖 > 2 天完美圖）

**明確排除（至少 v1）**：
- **設計師不進系統** — v1 由業務獨立使用，設計師不參與
- 外部客戶 / 建商 — v1 不對外開放，零法務 / 品牌風險
- 主管儀表板 — 永遠不做
- 完整施工圖（只做可行性草稿）
- AutoCAD plugin / BIM 整合

**最窄切入點（MVP = v1 = 4 到 6 週 + 前置第 0 週 spike）**：

> **業務選擇 Mode A 或 Mode B → 填寫對應欄位 → 系統解算出完整電梯參數 → 產出一份 DXF 草稿（平面圖 + 側面圖 + 關鍵尺寸 + CNS 合規章）→ 業務下載並可即時預覽。非標特例自動旗標「請聯絡 XX 資深工程師」。**

### Mode A — 空間 → 電梯

客戶已預留坑道，業務要告訴客戶「這個坑道能裝什麼規格的電梯」。

| 欄位 | 單位 | 備註 |
|---|---|---|
| 坑道寬 (W) | mm | 內淨寬 |
| 坑道深 (D) | mm | 內淨深 |
| 坑道總行程高 (H) | mm | 最低樓板到最高樓板 |
| 頂部高度 (overhead) | mm | **CNS 15827-20 §5.2.5.7 硬約束** |
| 底坑深度 (pit depth) | mm | **CNS 15827-20 §5.2.5.8 硬約束** |
| 停站數 | 整數 | |
| 用途 | 列舉 | 客用 / 貨用 / 病床 / 無障礙 |

**解算器推導**：
- 從坑道寬深扣除 CNS 側向 clearance → 最大可能車廂尺寸
- 對照 CNS 15827-20 表 6 (面積 → 最小額定荷重) → 可裝載重等級
- 檢查 overhead + pit 是否滿足 CNS §5.2.5.7.1/§5.2.5.8.1 的避險空間公式
- 非標旗標：若任一 CNS 條件不滿足 → 拒絕自動生成，顯示「需資深工程師介入」

### Mode B — 需求 → 空間

客戶還在規劃階段，業務要告訴客戶「你這個需求需要預留多大坑道」。

| 欄位 | 單位 | 備註 |
|---|---|---|
| 額定載重 | kg | 客戶需求 |
| 額定速度 | m/min | 預設 60，可改 |
| 停站數 | 整數 | |
| 用途 | 列舉 | 客用 / 貨用 / 病床 / 無障礙 |
| 機房型式 | 列舉 | MR（有機房）/ MRL（無機房）|

**解算器推導**：
- 從載重 → 查 CNS 表 6 反向 → 最小車廂有效面積
- 面積 → 最小車廂寬深（依用途分配長寬比）
- 最小車廂寬深 + 側向 clearance → 最小坑道寬深
- 速度 → 查 CNS 速度分級表 → overhead + pit 最小值（含 0.035v² 跳衝）
- 行程高 = 停站數 × 預設樓高 3m （業務可覆寫）

### 共通輸出（兩個 mode）

無論 Mode A 或 Mode B，最終輸出一份 DXF 含：

1. **平面圖 (PLAN VIEW)**：坑道外框 + 車廂矩形 + 門開口 + 寬深標註
2. **側面圖 (ELEVATION VIEW)**：從底坑到機房頂的完整剖面 + 樓層線 + 地面層車廂 + overhead / pit 標註 + 總高度
3. **規格卡（寫在 DXF 的 TEXT 區塊）**：載重、速度、停站、車廂尺寸、坑道尺寸、門寬
4. **合規章**：每條 CNS 規則的 compliant/violation 狀態 + 條號引用
5. **下載按鈕 + inline 預覽**（預覽器重用 Spike 1 的 SVG viewer）

就這樣。這個切入點**最小**，同時**立刻有感**。上線 day 1 就有業務每天用。

## 五、限制條件

- **語言**：繁體中文 UI（業務使用）
- **平台**：Web app，桌機 + 手機皆能用（業務可能在客戶現場打開）
- **部署**：內部網路，不對外（v1）
- **資料敏感**：歷史案例 = 商業機密，不能上外部 LLM API，本地部署或內部雲
- **整合**：v1 不整合 AutoCAD / BIM / ERP，純粹是獨立 web app
- **合規**：v1 輸出帶「僅供業務初步評估，最終設計需資深工程師簽核」的免責聲明
- **時間**：4 到 6 週內要有可 demo 給老闆的 MVP，否則組織內部會失去耐心

## 五點五、術語與資料模型

文件裡會反覆出現以下五個詞，先鎖定意思避免混淆：

- **Solver（解算器）** — Mode A 或 Mode B 的核心邏輯。Mode A Solver 吃 `ShaftSpec` 吐 `ElevatorDesign`；Mode B Solver 吃 `ElevatorRequirement` 吐 `ElevatorDesign`。解算過程中會查 CNS 表 6/8 做 load↔area 雙向查表。
- **Validator（檢核器）** — 吃 `ElevatorDesign` 跑所有 `CnsRule`，吐 `ValidationResult`。純規則引擎，deterministic，Sprint 1 就要有。
- **DXF Writer** — 吃 `ElevatorDesign` 吐 DXF 字串（平面圖 + 側面圖 + 尺寸 + 規格卡）。Spike 4 已驗證 `dxf-writer@1.18.4` 可行。
- **Generator（生成器）** — 上層使用者流程 = Solver → Validator → DXF Writer 的 pipeline。業務點「產生」看到的就是它。
- **Viewer（預覽器）** — 重用 `src/demo/` 的 Bun.serve + SVG viewer，產生後立即 inline 預覽生成的 DXF，業務下載前先看一眼對不對。

**關鍵資料 schema（v1 不要等到 Sprint 1 才想）**：

```ts
// Mode A 輸入
type ShaftSpec = {
  width_mm: number
  depth_mm: number
  total_height_mm: number
  overhead_mm: number
  pit_depth_mm: number
  stops: number
  usage: 'passenger' | 'freight' | 'bed' | 'accessible'
}

// Mode B 輸入
type ElevatorRequirement = {
  rated_load_kg: number
  rated_speed_mpm: number
  stops: number
  usage: 'passenger' | 'freight' | 'bed' | 'accessible'
  machine_location: 'MR' | 'MRL'
  floor_height_mm?: number  // 預設 3000
}

// Solver 輸出 = Validator / DXF Writer 輸入
// 這是 pipeline 的核心交換格式
type ElevatorDesign = {
  // 坑道（可能是輸入或推算）
  shaft: ShaftSpec
  // 車廂
  car: {
    width_mm: number
    depth_mm: number
    height_mm: number
  }
  // 門
  door: {
    width_mm: number
    type: 'side_opening' | 'center_opening'
  }
  // 規格
  rated_load_kg: number
  rated_speed_mpm: number
  machine_location: 'MR' | 'MRL'
  // 元資料
  solver_mode: 'A' | 'B'
  generated_at: string  // ISO timestamp
}

type CnsRule = {
  clause_id: string               // "CNS-15827-20-5.2.5.7.1"
  title: string
  constraint_type: 'min' | 'max' | 'eq' | 'range' | 'custom' | 'lookup_table' | 'must_exist'
  target?: string                 // dot-path e.g. "car.width_mm"
  params?: Record<string, unknown>
  severity: 'blocker' | 'warning'
  applies_when?: Record<string, unknown> | null
}

type ValidationResult = {
  compliant: boolean
  violations: Array<{ clause_id: string; message: string; severity: 'blocker' | 'warning' }>
  warnings: string[]
}

// DXF Writer 輸出 — 就是文字字串，存檔即用
type DxfOutput = {
  dxf_string: string
  views: ['plan', 'elevation']
  layers_used: string[]
  size_bytes: number
}
```

**非標偵測的定義**（業務語意 + 演算法實作必須一致）：

- **業務語意**：「輸入無法被 CNS 15827 合規地解算，或超出標準型錄範圍」
- **演算法**：
  - Mode A 走完 Solver 後 `validator(design).compliant === false` 且 violation 包含 blocker → 非標
  - Mode B 推不出最小坑道（例如載重 > 型錄最大載重或 < 150 kg）→ 非標
- **旗標門檻**：寧可多誤判為非標（轉人工成本低），不要誤判為標準（出包成本高）

## 六、前提假設（使用者已確認）

1. **使用者是業務（內部）** — 不是設計師、不是客戶、不是主管 ✓
2. **有歷史案例 CAD 檔** — 需要第 1 週做資料考古 + 結構化 ✓
3. **CNS 15827-20 條文可取得** — 不會卡在這裡 ✓
4. **Pipeline = Solver → Validator → DXF Writer → Viewer** — 四個明確元件，Sprint 1 把前三個做完 ✓ (v0.3 更新)
5. **輸出 = DXF 草稿（平面 + 側面 + 尺寸 + 合規章）** — 不含完整施工圖，不含價格（價格延後） ✓ (v0.3 更新)
6. **非標 20% 自動旗標交回資深工程師** — 不試圖處理長尾 ✓
7. **雙向輸入 (Mode A + Mode B)** — 兩個都是 MVP，同檔次 ✓ (v0.3 新增)
8. **DXF 產生可行**（Spike 4 已驗證）— dxf-writer@1.18.4 + dxf-parser round-trip 通過 ✓

## 七、考慮過的方案（v0.3 重寫）

### 方案 A：雙向參數化 DXF 生成器 MVP（推薦）

**摘要**：純 web app，業務選 Mode A 或 Mode B → 填輸入 → Solver 解算 `ElevatorDesign` → Validator 跑 CNS 15827 規則 → DXF Writer 產出平面 + 側面圖 → Viewer inline 預覽 → 業務下載 .dxf 檔給客戶看。

**工時**：M（人類團隊 5-7 週 / Claude Code + Claude 2-3 週認真做）
→ 比 v0.2 的「配件器 MVP」多 1 週，因為雙向 solver + DXF writer 取代了 matcher + pricing

**風險**：中低
- DXF writer 已 Spike 4 驗證 ✓
- CNS 規則已 Spike 2 抽 31 條 ✓
- DXF viewer 已 Spike 1 驗證 ✓
- 剩下的風險：Solver 的 CNS 表 6/8 lookup 表正確性（需要 Sprint 1 從 PDF 抽取）

**優點**：
- **業務直接拿 DXF 給客戶看** — 比「型號 SF-750-60」說服力強 10 倍
- 雙向 mode 覆蓋兩種典型業務對話
- 組織政治容易：可 demo 的產出是「會議桌上客戶一眼看懂的圖」
- 零法務風險（內部工具）
- 80% 既有資產可重用（Spike 1/2/4 + viewer）

**缺點**：
- 比 v0.2 版多 1 週時程（Solver + DXF Writer 比 Matcher + Pricing 工作量大）
- Solver 需要 CNS 表 6/8 才能準 → Sprint 1 必須完成 OCR 或人工抽取

**重用**：
- ✅ `spike-2-cns-rules/rules.draft.json` (31 條規則) → Validator
- ✅ `spike-4-dxf-writer/generate.ts` → DXF Writer 起點
- ✅ `src/demo/` (Bun.serve + SVG viewer) → Viewer
- ✅ `spike-1-dxf-parser/` → Round-trip 驗證工具

### 方案 B：加上設計師工作流（v2，Sprint 4+）

**摘要**：方案 A 的全部 + 一個給設計師的頁面，讓設計師從業務產生的 DXF 作為**起點**，直接在 AutoCAD 裡繼續深化成完整施工圖。

**工時**：M（2-3 週疊在 A 之上）

**風險**：中（設計師 UX 對齊是非技術問題）

**優點**：
- 業務的 DXF → 設計師的施工圖，銜接順暢
- 設計師 2 天週期降為 2-4 小時（草稿已經對了，只做深化）

**缺點**：
- 需要跟設計師對焦一次他們到底想看什麼資訊
- AutoCAD plugin 整合會吃 1-2 週（或者改用 DXF 直接開啟）

**推薦順序**：A 上線穩定運行 **2 到 4 週後**才疊 B。

### 方案 C：客戶對外自助入口網站（v3，Q4+）

**摘要**：方案 A 的引擎 + 對外 landing page + lead 收集 + marketing 配套，客戶自己上網輸入坑道/需求 → 自動產出 DXF → 帶著圖來找業務談。

**工時**：L（3-6 個月，含非技術配套）

**風險**：高（法務責任、品牌投資、錯誤輸出影響品牌信任）

**結論**：**不要現在做**。A + B 上線後 3 個月，如果內部業務滿意 + close rate 有改善，再由公司層級決定是否對外。

## 八、推薦方案（v0.3 重寫）

**方案 A（雙向參數化 DXF 生成器 MVP），前置第 0 週 spike + 三個 sprint**：

### 第 0 週：資料與可行性 spike（gating）

**目標**：在承諾 5-7 週之前，先證明核心技術風險已解。**已完成 3/4**，還差一個。

| Spike | 目的 | 狀態 | 產出 |
|---|---|---|---|
| **Spike 1** | dxf-parser 能讀真實 AutoCAD 建築 DXF 並定位電梯 room | ✅ **PASS** | [parse-real.ts](../spikes/spike-1-dxf-parser/parse-real.ts), 在 `sample_building.dxf` 上 16/16 命中 |
| **Spike 2** | CNS 15827 條文結構化可行、找到 30+ 條候選規則 | ✅ **PASS** | [rules.draft.json](../spikes/spike-2-cns-rules/rules.draft.json) 31 條帶真實條號 |
| **Spike 3** | 型號價格跟歷史成交資料可取得 | 🔴 **BLOCKED** | 等業務主管。v0.3 把 pricing 延後到 v1.1 |
| **Spike 4** | TypeScript 產 DXF 可行 + round-trip 正確 | ✅ **PASS** | [generate.ts](../spikes/spike-4-dxf-writer/generate.ts)，8.5 KB DXF, SHAFT bbox 驗證通過 |
| **Spike 5** | CNS 表 6 (load ↔ area) 可從 PDF 抽取 | 🟡 **必做** | Sprint 1 D1 前需 OCR 或人工 transcribe |

**Spike gate**：Spike 1/2/4 已通過 → 可進 Sprint 1。Spike 5 跟 Sprint 1 併行。Spike 3 (pricing) 延後，v1 不塞。

### Sprint 1（第 1-2 週）：Solver + Validator + DXF Writer 核心

**目標**：交付三個 deterministic、可測試的 TypeScript 模組。不做 UI。

- **D1-2**：從 CNS 15827-20 PDF 抽 **表 6 (車廂面積 → 最小額定荷重)** 和 **表 8 (車廂面積 → 最多乘客人數)**，存成 JSON lookup table（第 0 週 Spike 5 的實質執行）
- **D3-4**：寫 **Mode A Solver** (`src/solver/modeA.ts`)：吃 `ShaftSpec` → 扣除 clearance → 最大 car 尺寸 → 查表 6 找對應 load class → 產 `ElevatorDesign`
- **D5-6**：寫 **Mode B Solver** (`src/solver/modeB.ts`)：吃 `ElevatorRequirement` → 查表 6 反向 → 最小 car 尺寸 → 加 clearance → 最小 shaft → 產 `ElevatorDesign`
- **D7-8**：寫 **Validator** (`src/validator.ts`)：`validate(design: ElevatorDesign, rules: CnsRule[]): ValidationResult`，跑 `rules.draft.json` 的 31 條規則
- **D9**：把 `spikes/spike-4-dxf-writer/generate.ts` 升級為 **DXF Writer 模組** (`src/dxf-writer.ts`)，吃 `ElevatorDesign` 吐 DXF 字串
- **D10**：寫 CLI `src/cli.ts`：可用 `bun src/cli.ts --mode A --shaft 2000x2200x18000 --stops 6` 產 DXF 到 stdout
- **驗收標準**：
  - `bun test` 綠燈，`src/solver` + `src/validator` + `src/dxf-writer` 覆蓋率 ≥ 80%
  - 3 個 Mode A reference case + 3 個 Mode B reference case 全部產出合法 DXF
  - 產出的 DXF round-trip 通過 dxf-parser，bbox 正確

### Sprint 2（第 3-4 週）：Web UI + 預覽 + 下載

**目標**：把 Sprint 1 的 core pipeline 包進業務可用的 UI。**不要從零做 Next.js**，重用現有 Bun.serve + index.html 的骨架。

- **D1-2**：改造 `src/demo/` 成 `src/app/`，加 Mode A / Mode B tab 輸入表單（繁中 UI）
- **D3-4**：`POST /api/generate` 路由：fetch 表單 → 跑 solver + validator + dxf-writer → 回傳 DXF 字串 + 驗證結果
- **D5-6**：前端：按「產生」→ 顯示 inline preview（重用 Spike 1 viewer 的 render 邏輯，把結果作為 `generated` source）+ 顯示驗證結果（blocker 紅、warning 黃）
- **D7**：下載按鈕：`<a download="elevator-draft.dxf">` 直接存成檔案
- **D8**：非標偵測 UX — solver 拋 `NonStandardError` → 顯示「請聯絡 XX 資深工程師」畫面 + 一鍵 Email / LINE 轉傳
- **D9**：免責聲明 + 稽核 log（誰用、輸入什麼、生成什麼 DXF、下載了沒）
- **D10**：業務 champion walkthrough，錄下 UX 卡住的地方
- **驗收標準**：
  - 業務 champion 獨立操作 Mode A 5 個測試案例 + Mode B 5 個測試案例，成功率 100%
  - 所有產生的 DXF 通過 CNS validator 0 blocker
  - 業務點完「產生」到看到預覽 < 3 秒

### Sprint 3（第 5-6 週）：上線 + 回饋循環

**目標**：業務團隊開始用，你有資料反饋改進。

- **D1-2**：部署到內部網路（Docker + Caddy，v1 不用 k8s — 降低 infra 複雜度）
- **D3**：業務團隊 15 分鐘 kick-off 示範 + 書面操作手冊（1 頁 A4）
- **D4-10**：每天盯稽核 log、每天 15 分鐘跟業務 champion 對一次，快速修 bug、調 solver 權重、補 CNS 規則
- **第 6 週結束**：產出 2 張數字給老闆 — (1) 本週業務產生的 DXF 數量 + 下載次數 (2) 業務平均回覆時間下降幅度

**註**：SSO 整合挪到 v1.1，v1 用簡單 session + 內部帳號，不要吃時程。

### v1 明確不做（out of scope, v0.3 更新）

- ❌ 完整施工圖（只做可行性草稿）
- ❌ AutoCAD plugin（業務只需下載 .dxf 檔）
- ❌ **粗估價** — 延到 v1.1，Spike 3 blocker 還在
- ❌ 對外客戶存取
- ❌ 主管儀表板
- ❌ ERP / CRM 整合
- ❌ 多語系（只做繁中）
- ❌ 非標特例自動處理
- ❌ 行動 App（native）
- ❌ 歷史案例 matcher（舊版的核心，v0.3 被 Solver 取代）

## 九、未解問題（v0.3 更新）

1. **業務 champion 是誰？** MVP 能不能活下來取決於有沒有一個內部業務每天用、每天給回饋。這個人必須在第 0 週（kick-off 前）就確定。
2. **CNS 表 6 / 表 8 怎麼抽？** Sprint 1 D1-2 的阻擋點 — PDF 是掃描檔，沒可抽文字。選項：(a) OCR + 人工校驗；(b) 請資深設計師直接手動 key in；(c) 從既有型錄反推（但可能漏條文）。**建議 (b)，1-2 小時做完。**
3. **標準型錄的「門寬」/「車廂高度」怎麼決定**？Solver 推出 car 寬深後，高度跟門寬 v1 用 hardcoded preset（客用門 900mm、車廂高 2300mm），v1.1 再從型錄抽。
4. **非標偵測的閾值**：多嚴格算非標？寧可過多旗標（false positive）還是少旗標（false negative）？建議保守，寧可多轉人工。
5. **DXF 的 AutoCAD 相容性**：`dxf-writer@1.18.4` 產的是 DXF R12/R14 舊格式，現代 AutoCAD 能開但可能需要升級。要不要產出 R2018+ 格式？Sprint 1 D10 驗證一次。
6. **CNS 15827 系列更新**：條文更新時誰負責同步規則庫？要不要每年例行審核？
7. **Mode A 跟 Mode B 的業務操作比例** — 實際業務對話中，哪一種更常見？影響 UI 預設 tab 跟測試優先順序。

## 十、成功標準（v0.3 更新）

**第 6 週驗收**：
- [ ] 業務團隊至少 3 人每週各用過 ≥ 5 次
- [ ] **產出的 DXF 100% 通過 Validator 0 blocker**（deterministic，不是主觀命中率）
- [ ] **Mode A + Mode B 至少 80% 的輸入組合能成功產 DXF**（20% 非標是預期旗標）
- [ ] 業務回覆客戶平均時間從「2 到 4 天」降到「15 分鐘內給客戶一張 DXF 草稿」
- [ ] 至少 1 個業務主動說「我現在每天都用 + 直接 email 圖給客戶」（最重要的指標）

**第 3 個月驗收（決定是否進方案 B — 設計師工作流）**：
- [ ] 每週使用次數達標（5+ 業務, 各 5+ 次/週）
- [ ] 業務 NPS ≥ 8/10
- [ ] Close rate 有可量測提升（對照實驗或前後比對）
- [ ] 至少 3 個案例走完「業務用工具出草稿 → 客戶簽合約 → 設計師拿草稿做施工圖」的完整鏈條

## 十一、交付與部署

- **部署**：Docker 容器 + 內部反向代理（Caddy / Nginx），部署到公司內網
- **存取**：VPN 或 office Wi-Fi only，簡單 SSO（Google Workspace / Microsoft 365）或內部帳號
- **CI/CD**：GitHub Actions → 自動 build image → push 到公司 private registry → 手動 trigger 部署（v1 不做全自動）
- **備份**：資料庫每日備份到內部 NAS，歷史 CAD 結構化資料單獨版本控管（critical asset）

## 十二、依賴與前置條件

**阻擋項目（第 0 週前必須解決）**：
- [ ] 業務主管 + IT 主管 green light
- [ ] 指定一個業務 champion（day-1 daily user）
- [ ] 拿到 20 個歷史 CAD 檔的存取權
- [ ] 拿到 CNS 15827-20 條文的可用格式（PDF / DOC / 公司內部整理版）
- [ ] 內部部署環境（Docker host 或 k8s namespace）
- [ ] 粗估價策略對齊（透明度層級）

**有的話更好**：
- [ ] 老闆或 VP 層級 sponsor（會在內部政治戰出手相助）
- [ ] 歷史案例的成交價 / 交期資料（不是 CAD 檔本身）

## 十三、指派任務（The Assignment）

> **在寫一行 code 之前，把業務主管、1 位業務 champion、1 位資深設計師同時拉進一個房間開 30 分鐘的會。用這份設計文件當投影片，問三個問題：**
>
> 1. **業務主管**：「如果這個工具 6 週後上線，業務能自助回答 80% 的詢價，你願意指定誰當 day-1 每天用的 champion？」— 如果答不出來，這個案子沒有組織基礎，暫停。
> 2. **業務 champion**：「你最近一次等設計師回覆花了多久？客戶後來去找哪家了？」— 這是你接下來 6 週的燃料，把答案寫下來。
> 3. **資深設計師**：「如果我們把 80% 標準案從你桌上拿走，只留 20% 非標給你，你會覺得被冒犯還是被解放？」— 這一題決定你是否會在組織內有盟友或敵人。
>
> **這個會不要超過 30 分鐘。如果開不成（三人之中有一人抽不出 30 分鐘），那就是產品的第一個信號 — 這個案子的組織重要性不夠，值得重新評估優先順序。**

**不要直接開始寫 code。** 寫 code 是最簡單的部分，組織共識才是真正的稀缺資源。

## 十四、我注意到你的思考方式

- **你在 Q2 直接打槍我的「先做檢核器」前提**，反駁是「坑道沒有審美的問題」。這不是反射式拒絕，是基於領域知識的精確反駁 — 你知道電梯在給定坑道 + 載重下幾乎是 deterministic 的工程問題，不是設計問題。很多人會直接接受「外人告訴我的前提」，你沒有。這是創辦人直覺。

- **你在 Q3 主動分類「標準型錄 + 相當比例非標特例」**，沒有選極端答案。這表示你對公司產品的實際組成有精確認知，而且願意用 80/20 框架思考。許多內部專案在這題會答「我們每個案子都很特別」，然後專案就死了。

- **你在 v0.3 回合把真實需求攤開（「業務從客戶拿 (空間 L×W×H) 或 (承重 500 kg) 交由我們規劃，系統產 DXF 含平面+側面+尺寸」）直接修正了整個輸出形式**。這是 office-hours Q5「觀察與驚喜」那一題我本來該抓到的東西，但我跳過了。你事後把這個資訊補上來，等於幫我修正了我的遺漏 — 而且修正方式是溫和的、不責難的、直接進入「好，那怎麼做」。這種溝通模式在組織裡極度珍貴。

- **你對法規跟量體都有精確的數字感** — 一年 1000 台、每案 2 天、錯了重來。大部分人在這個階段會說「蠻多的」、「滿久的」，你給的是具體數字。具體數字是能做產品決策的最小單位。

---

## 十五、審查意見（已處理）

### 第一輪（v0.1 → v0.2）對抗式審查，5 個主要問題全數修正：

1. ✅ **歷史 CAD 檔 parser 可行性** — 加了第 0 週 Spike 1，要求先用 `dxf-parser` 試跑 1 個真實檔案。**Spike 1 v2 已完成，16/16 命中 Hack_Canada 真實 DXF**。
2. ✅ **輸入欄位沒定義 overhead / pit depth** — 已在第四節補完整輸入表（8 欄位），並標注這兩項是 CNS 15827 硬約束
3. ✅ **「約 30 條 CNS」太虛** — 加了第 0 週 Spike 2。**Spike 2 已完成，從 CNS 15827-20 比對簡報抽出 31 條帶真實條號的 draft rules**。
4. ✅ **術語混用 + 缺資料 schema** — 新增第五點五節「術語與資料模型」
5. ✅ **Sprint 1 擠太多** — 已拆開

### 第二輪（v0.2 → v0.3）重大轉向，由使用者帶入真實需求：

6. ✅ **輸出形式錯誤** — 從「型號推薦 + 規格卡 + 粗估價」改為「DXF 草稿（平面 + 側面 + 尺寸）」。**Spike 4 已驗證 TypeScript 可產 DXF，round-trip 正確**。
7. ✅ **輸入方向單向太窄** — 加入 Mode B (需求 → 空間)，跟 Mode A 同檔次做
8. ✅ **Solver 角色沒定義** — 新增 §五點五 的 Solver / Validator / DXF Writer / Generator / Viewer 五個術語
9. ✅ **CNS 2866 廢止** — v0.2 已全文改為 CNS 15827-20/31/50 系列
10. 🟡 **Mode A / Mode B 操作比例未知** — 在 §九 列為未解問題，Sprint 3 上線後觀察

### 還沒處理的風險（仍在 §九 未解問題）：

- 業務 champion 身分未定
- CNS 表 6 / 表 8 怎麼從掃描 PDF 抽出
- DXF 格式的 AutoCAD 版本相容性

---

**v0.3 分數預估**：9/10（v0.2 第二輪 8.5/10）— 增加是因為核心技術假設都已被 Spike 4 驗證，真實需求也終於到位。
