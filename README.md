# CNS Elevator Configurator

台灣電梯製造商內部業務工具。業務輸入坑道規格或需求條件，系統自動生成合規電梯設計圖 (DXF) 並提供 AI 設計指引助理。

**線上版**: [elevator-configurator.redarch.dev](https://elevator-configurator.redarch.dev)

---

## 功能概覽

### 雙模式解算器

| 模式 | 輸入 | 輸出 |
|------|------|------|
| **Mode A** — 空間 → 電梯 | 已知坑道尺寸 (寬/深/高/頂部高度/底坑深度) | 最大車廂尺寸 + 最佳配置 |
| **Mode B** — 需求 → 空間 | 載重/速度/用途/樓層數 | 最小坑道尺寸 + 完整設計 |

兩種模式都會：
- 從 ISO 8100-1 Table 6 查找合規載重
- 自動選擇開門方式 (side opening / center opening)
- 計算頂部高度、底坑深度是否符合 CNS 規範
- 生成完整 DXF 圖紙 (平面圖 + 側面圖)

### DXF 圖紙生成

系統即時生成工程圖紙，包含：
- **平面圖 (Plan View)**: 坑道、車廂、配重 (5 種位置)、導軌、門、間隙標注
- **側面圖 (Elevation View)**: 頂部高度、底坑深度、各樓層停靠位置
- **圖層分色**: SHAFT (坑道)、CAR (車廂)、CWT (配重)、RAIL_CAR / RAIL_CWT (導軌)、DOOR (門)、DIMS (尺寸)、STOP (樓層)
- 可下載為 .dxf 檔案直接匯入 AutoCAD

### AI 設計指引助理

點擊「AI 設計助理」按鈕開啟對話側邊欄，使用者可以用自然語言描述設計問題：

```
使用者：配重位置應該在中間
AI：[提議修改 cwt.position: back_left → back_center]
     使用者要求將配重位置設為中間。此規則來源為工程預設...
     [不要] [套用並重畫]
```

AI 助理的能力：
- **提議修改規則值** — 自動驗證是否在 baseline 允許範圍內
- **提議刪除規則** — 只能刪除非必要規則 (mandatory=0)
- **詢問釐清** — 需求不明確時提供多選項讓使用者選擇
- **拒絕超範圍請求** — 不能做的事會明確告知

三層安全防護：
1. **Prompt 指示** — AI 被指示不能超出 baseline 範圍
2. **Server 驗證** — AI 回覆後再次驗證，違規自動降級
3. **寫入驗證** — 任何寫入資料庫的操作都會再次驗證

### 規則管理

46 條設計規則分為 8 個類別，每條規則都有：

| 類別 | 範例規則 | 說明 |
|------|----------|------|
| 坑道 | shaft.min_width_mm | 坑道最小寬度 |
| 間隙 | clearance.side_mm | 車廂側向間隙 |
| 車廂 | car.height_mm.passenger | 客用車廂高度 |
| 配重 | cwt.position | 配重位置 (5 種選項) |
| 導軌 | rail.car.size_mm | 車廂導軌尺寸 |
| 門 | door.default_width_mm.accessible | 無障礙電梯預設門寬 |
| 高度/速度 | height.overhead.refuge_mm | 頂部避難空間 |
| 用途預設 | usage.accessible.min_car_width_mm | 無障礙最小車廂寬度 |

規則管理功能：
- **瀏覽**: 依類別/來源/狀態篩選所有規則
- **編輯**: 直接修改數值或選項，失焦即儲存
- **軟刪除**: 非必要規則可刪除 (可還原)
- **還原**: 已刪除的規則可隨時恢復
- **來源標記**: CNS (法規) / 產業慣例 / 工程預設

### 驗證面板

每次生成圖紙後，底部顯示驗證摘要：

```
PASS 45  WARN 1  CNS 8
```

展開後分三個區塊：
- **案子微調** — 本次案子的覆寫項目 (WARNING 狀態)
- **CNS 法規合規** — 法規相關規則狀態
- **設計指引** — 團隊設定的工程指引

### 案子微調工作流

1. 使用者透過 AI 助理或 Rules Tab 調整規則值
2. 調整存在瀏覽器記憶體中 (案子微調 / case override)
3. 圖紙即時更新，驗證面板顯示哪些值被覆寫
4. 確認滿意後，點擊「收工存入團隊」一次性寫入資料庫
5. 從此每張新圖紙都使用新的團隊預設值

---

## 快速開始

### 環境需求

- [Bun](https://bun.sh/) 1.3+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (部署用)

### 本地開發

```bash
# 安裝依賴
bun install

# 啟動本地開發伺服器 (port 3000)
bun src/demo/server.ts

# 啟用 AI Chat (需要 Anthropic API key)
ANTHROPIC_API_KEY=sk-ant-xxx bun src/demo/server.ts
```

打開 http://localhost:3000 即可使用。本地模式使用 InMemoryRulesStore，所有規則 CRUD 操作存在記憶體中，重啟即重置。

### 執行測試

```bash
# 執行全部測試
bun test

# 含覆蓋率報告
bun test --coverage

# 執行特定測試檔案
bun test src/handlers/chat.test.ts
```

### 部署到 Cloudflare

```bash
# 首次：建立 D1 資料庫 + 套用 schema + 種子資料
wrangler d1 migrations apply elevator-configurator-db --local
wrangler d1 execute elevator-configurator-db --local --file=seeds/0001_baseline_rules.sql

# 設定 AI Chat API key
wrangler secret put ANTHROPIC_API_KEY

# 部署
wrangler deploy
```

---

## 使用指南

### Mode A：已知坑道尺寸

適用場景：客戶已經有建築圖，坑道尺寸固定。

1. 選擇 **Mode A — 空間 → 電梯**
2. 輸入坑道寬度、深度、行程高度、頂部高度、底坑深度
3. 選擇用途 (客用/貨用/病床/無障礙) 和停站數
4. 點擊「產生 DXF 草稿」
5. 系統計算可容納的最大車廂尺寸、查找合規載重、選擇開門方式

### Mode B：已知需求規格

適用場景：客戶知道需要多大載重的電梯，需要知道坑道要多大。

1. 選擇 **Mode B — 需求 → 空間**
2. 輸入額定載重 (kg)、用途、機房型式 (有機房/無機房)
3. 點擊「產生 DXF 草稿」
4. 系統推算最小坑道尺寸、完整的電梯設計方案

### 使用 AI 助理調整設計

1. 產生一版草稿後，點擊右上角「AI 設計助理」
2. 用自然語言描述問題，例如：
   - 「配重位置應該在中間」
   - 「側向間隙可以再小一點嗎」
   - 「這個案子門寬要加大到 1000mm」
3. AI 會提出修改建議，點擊「套用並重畫」即刻更新圖紙
4. 滿意後點擊「收工存入團隊」，將調整寫入團隊預設值

### 管理團隊規則

1. 點擊上方導航列「規則管理」
2. 使用篩選器快速找到目標規則
3. 直接修改數值欄位，失焦自動儲存
4. 點擊「重設預設值」可恢復出廠值
5. 非必要規則可點擊「刪除」(會進入確認流程)

---

## 合規標準

本系統遵循以下台灣及國際電梯標準：

- **CNS 13627** — 無障礙電梯最小車廂尺寸、門寬要求
- **CNS 15827-20 §5.2.5.7.1** — 頂部高度計算公式
- **CNS 15827-20 §5.2.5.8.1** — 底坑深度計算公式
- **ISO 8100-1 Table 6** — 額定載重與車廂面積對照表 (28 列)

所有法規相關規則標記為 `source: cns`，具有 baseline 最小值限制，防止業務意外設定不合規的數值。

---

## 授權

內部工具，未公開授權。
