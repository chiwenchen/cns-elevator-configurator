# Professional DXF Mode — Design Spec

## 1. Goal

一鍵 toggle 把 DXF 輸出從「草稿簡圖」升級成「專業施工圖」，新增 13 個電梯工程部件、7 個 DXF 圖層，達到接近 DigiPara/FineLIFT 的圖面完整度。

## 2. User Story

業務在配置器填完參數後：
1. 開啟「專業施工圖」toggle
2. 點「產生 DXF 施工圖」
3. 後端回傳含 18 圖層的完整 DXF
4. 下載後用 AutoCAD 開啟，可逐層開關各部件

## 3. Scope

### In Scope
- Toggle UI（金屬質感 + 掃光動畫）
- 13 個新部件繪製（平面圖 6 + 側面圖 7）
- 7 個新 DXF 圖層
- 16 條新規則（professional 類別）
- API `detail_level` 參數
- 側面圖從 zigzag 示意升級為完整多樓層剖面
- 單元測試 + 整合測試

### Out of Scope
- 3D 顯示（另開 GitHub issue）
- 多法規支援（另開 GitHub issue）
- 機房平面圖（獨立視圖）
- 剖面圖（獨立視圖）
- BOM 材料清單

## 4. Architecture

### 4.1 API Change

```
POST /api/solve
{
  mode: "A" | "B",
  ...params,
  caseOverride: { ... },
  detail_level?: "draft" | "professional"  // NEW, default "draft"
}
```

Response 不變。`dxf_string` 內容根據 `detail_level` 不同。

### 4.2 DXF Layer Structure

現有 11 層 + 新增 7 層 = 18 層。

| 圖層 | ACI Color | 用途 | 新增? |
|------|-----------|------|-------|
| SHAFT | 7 (White) | 井道外框 | |
| WALL | 8 (Dark Gray) | 井道壁厚 200mm | 啟用 |
| CAR | 1 (Red) | 車廂 | |
| CWT | 3 (Green) | 配重 | |
| RAIL_CAR | 5 (Blue) | 車廂導軌 | |
| RAIL_CWT | 4 (Cyan) | 配重導軌 | |
| DOOR | 6 (Magenta) | 車門 | |
| CENTER | 1 (Red, dashed) | 中心線 | |
| DIMS | 2 (Yellow) | 標註尺寸 | |
| TEXT | 7 (White) | 文字標籤 | |
| STOP | 3 (Green) | 樓層指示 | |
| SLING | 14 (Red-orange) | 車廂框架/吊架 | NEW |
| BUFFER | 34 (Lime) | 緩衝器 | NEW |
| SAFETY | 174 (Steel blue) | 安全鉗 + 調速器 | NEW |
| ROPE | 214 (Lavender) | 鋼繩 + 隨行電纜 | NEW |
| MACHINE | 32 (Orange-brown) | 曳引機 | NEW |
| LANDING | 154 (Teal) | 層門 + 樓層線 | NEW |

注：WALL 已定義但目前未使用，專業模式啟用它來畫壁厚。

### 4.3 File Structure

```
src/dxf/
├── generate.ts          ~80 行 — 入口，分派 draft/professional
├── layers.ts            NEW ~60 行 — 圖層定義（18 層）
├── primitives.ts        NEW ~80 行 — 共用繪圖工具函式
├── plan-draft.ts        ~200 行 — 現有平面圖（從 plan.ts 重命名）
├── plan-professional.ts NEW ~200 行 — 專業平面圖部件
├── elevation-draft.ts   NEW ~120 行 — 現有側面圖（從 generate.ts 拆出）
├── elevation-professional.ts NEW ~250 行 — 專業側面圖部件
├── spec-block.ts        NEW ~60 行 — 規格欄（從 generate.ts 拆出）
├── plan.test.ts         ~95 行（更新）
└── professional.test.ts NEW ~200 行
```

拆分理由：現有 plan.ts 312 行，加 13 個部件會超過 200 行檔案限制。按 draft/professional × plan/elevation 拆分。

## 5. Component Specifications

### 5.1 Plan View — 6 New Components

#### 5.1.1 Car Sling (SLING layer)

車廂外圍矩形框 = crosshead（頂橫樑）+ bolster（底橫樑）+ 2× stile（立柱）。

- `pro.sling_offset_mm` = 75（車架外擴距離，各邊）
- `pro.sling_thickness_mm` = 12（鋼材寬度）
- 繪製：4 條粗線圍繞車廂矩形，offset 75mm
- 來源：Wittur WCF 系列，框架外擴 50-100mm，鋼板厚 4-8mm
- 信心：✅ 高

#### 5.1.2 Guide Shoes ×4 (SLING layer)

裝在 sling 四角與導軌交接處（上 2 + 下 2）。

- `pro.guide_shoe_width_mm` = 100
- `pro.guide_shoe_depth_mm` = 60
- 繪製：矩形，中心對齊 car rail 位置，在 crosshead 和 bolster 上各兩個
- 來源：Wittur SLG 系列，適用導軌頭厚 5-32mm，典型外框 80-120mm
- 信心：⚠️ 中 — 標註 "SCHEMATIC"

#### 5.1.3 Landing Door (LANDING layer)

井道壁外側門框 + 門扇，與車門鏡像對稱。

- 門寬 = `door.width_mm`（已有）
- 門框深 = `door.frame_depth_mm`（已有）
- 門檻深 = `door.sill_depth_mm`（已有）
- 繪製：複用現有門繪製邏輯，Y 座標改為井道壁外側
- 來源：100% 使用已有 door 規則參數
- 信心：✅ 高

#### 5.1.4 Wall Thickness (WALL layer)

井道外框從單線變雙線。

- `pro.wall_thickness_mm` = 200（標準 RC 牆）
- 繪製：外矩形 = 內矩形 + 200mm 各邊
- 來源：業界標準 RC 電梯井道壁厚 150-200mm
- 信心：✅ 高

#### 5.1.5 Rope Position Mark (ROPE layer)

Sling crosshead 上方的鋼繩截面標記。

- 繪製：2-4 個小圓圈（Ø20mm 圖面符號），間距 40mm，居中於 crosshead
- 來源：鋼繩 2-4 根，繩徑 8-12mm
- 信心：✅ 高

#### 5.1.6 Traveling Cable Mark (ROPE layer)

車廂左側出線點符號。

- 繪製：Ø30mm 圓 + "TC" 文字標籤，固定在 car sling 左側中點
- 來源：隨行電纜通常從車廂底部一側引出
- 信心：⚠️ 中 — 標註 "SCHEMATIC"

### 5.2 Elevation View — 7 New Components

#### 5.2.1 Multi-Floor Landings (LANDING layer)

每層畫水平線 + 層號標籤 + 門開口示意。

- 層間距 = `floor_height_mm`（已有，預設 3000mm）
- 門高 = 2100mm（標準）
- 繪製：`for (i = 1..stops)` 畫水平線 + "NF" 標籤 + 門開口矩形缺口
- 側面圖不再使用 zigzag 省略線，改為完整繪製所有樓層
- 來源：100% 使用已有的 stops 和 floor_height 參數
- 信心：✅ 高

#### 5.2.2 Buffers ×2 (BUFFER layer)

機坑底部，車廂正下方 1 組 + 配重正下方 1 組。

- `pro.buffer_type` = "auto"（enum: auto / spring / oil）
- `pro.buffer_width_mm` = 200
- `pro.buffer_height_spring_mm` = 300
- `pro.buffer_height_oil_mm` = 450
- 自動選型：速度 ≤ 60 m/min（1 m/s）→ 彈簧式（內部 zigzag 線）；> 60 → 油壓式（實心 + "OIL" 標籤）
- 來源：ISO 8100 / EN 81，Oleo 產品規格
- 信心：✅ 高

#### 5.2.3 MRL Traction Machine (MACHINE layer)

井道頂部側牆，矩形機體 + 圓形曳引輪。

- `pro.machine_width_mm` = 600
- `pro.machine_height_mm` = 400
- `pro.sheave_diameter_mm` = 400
- 繪製：矩形 + 圓形 + "MACHINE" 標籤，固定在頂部右側牆壁，標註 "SCHEMATIC"
- 來源：Mitsubishi NEXIEZ spec，通用近似值
- 信心：⚠️ 中

#### 5.2.4 Overhead Breakdown (DIMS layer)

把現有單一 overhead 標註拆成 3 段。

- refuge_mm + bounce_coef × v² × 1000 + machine_buffer_mm
- 繪製：3 段帶箭頭標註線，各段標文字
- 來源：100% 使用已有的 clearances.ts 公式參數
- 信心：✅ 高

#### 5.2.5 Rail Brackets (WALL layer)

側面圖井道壁上的小三角形，等間距排列。

- `pro.rail_bracket_spacing_mm` = 2500
- 繪製：從機坑底到井道頂，每 2500mm 畫一個 △ 貼合壁面，大小 80mm
- 來源：Elevator World 設計參數分析，標準間距 2000-2500mm
- 信心：✅ 高

#### 5.2.6 Safety Gear + Governor (SAFETY layer)

安全鉗在車架底部兩側，調速器在井道頂部，繩垂直連接。

- `pro.safety_gear_width_mm` = 150
- `pro.safety_gear_height_mm` = 80
- `pro.governor_diameter_mm` = 300
- 繪製：車架底部兩個 ◼，井道頂部一個 ○，虛線連接
- 來源：ISO 標準位置（car sling 底部橫樑），調速器繩徑 6.3-8mm
- 信心：⚠️ 中 — 標註 "SCHEMATIC"

#### 5.2.7 Ropes & Traveling Cable (ROPE layer)

鋼繩：car crosshead → 曳引輪 → CWT。隨行電纜：car bottom → U 型下垂 → 井道壁。

- 鋼繩：2 條平行線
- 隨行電纜：貝茲曲線（DXF 用 polyline 近似）
- 來源：路徑是物理確定的
- 信心：✅ 高

### 5.3 Schematic Label Policy

所有標記為「⚠️ 中信心」的部件（導靴、曳引機、安全鉗+調速器、隨行電纜位置），在圖面上加小字 "示意 / SCHEMATIC"，明確告知非精確尺寸。

## 6. New Rules (DB)

16 條新規則，全部歸入 `professional` 類別，source = "engineering"，mandatory = 0。

| Key | Default | Type | Min | Max | Description |
|-----|---------|------|-----|-----|-------------|
| pro.sling_offset_mm | 75 | number | 50 | 120 | 車架外擴距離 |
| pro.sling_thickness_mm | 12 | number | 4 | 20 | 車架鋼材寬度 |
| pro.guide_shoe_width_mm | 100 | number | 60 | 150 | 導靴寬度 |
| pro.guide_shoe_depth_mm | 60 | number | 30 | 100 | 導靴深度 |
| pro.wall_thickness_mm | 200 | number | 120 | 300 | 井道壁厚 |
| pro.buffer_type | auto | enum | — | — | [auto, spring, oil] |
| pro.buffer_width_mm | 200 | number | 100 | 400 | 緩衝器寬度 |
| pro.buffer_height_spring_mm | 300 | number | 150 | 500 | 彈簧緩衝器高度 |
| pro.buffer_height_oil_mm | 450 | number | 250 | 800 | 油壓緩衝器高度 |
| pro.machine_width_mm | 600 | number | 300 | 1000 | 曳引機寬度（示意） |
| pro.machine_height_mm | 400 | number | 200 | 700 | 曳引機高度（示意） |
| pro.sheave_diameter_mm | 400 | number | 200 | 600 | 曳引輪直徑（示意） |
| pro.safety_gear_width_mm | 150 | number | 80 | 250 | 安全鉗寬度（示意） |
| pro.safety_gear_height_mm | 80 | number | 40 | 150 | 安全鉗高度（示意） |
| pro.governor_diameter_mm | 300 | number | 150 | 500 | 調速器輪直徑（示意） |
| pro.rail_bracket_spacing_mm | 2500 | number | 1500 | 3500 | 導軌支架間距 |

總計：現有 46 條 + 新增 16 條 = 62 條規則。

## 7. Frontend — Toggle UI

### 7.1 Toggle 設計

- 位置：表單頂部右側（Mode A/B 標題同行）
- 金屬質感：使用現有色系漸層（#3a4a5e → #5a6a80 → #8090a8）
- inset shadow：頂部 rgba(255,255,255,0.15)，底部 rgba(0,0,0,0.2)
- 掃光動畫：半透明白光從左到右，3 秒一次，只在 ON 狀態播放
- OFF 狀態：靜止暗灰金屬 (#2a2f38 → #363c47)

### 7.2 Toggle ON 的行為變化

- 「產生 DXF 草稿」按鈕文字變為「產生 DXF 施工圖」
- 按鈕顏色不變（永遠是橘色 accent）
- 下載檔名加 `professional`：`elevator-A-professional-passenger-630kg-2026-04-12.dxf`
- POST /api/solve body 加 `detail_level: "professional"`

### 7.3 Info Tooltip

- Toggle 旁有一個 ⓘ 圖示（使用 fg-muted 色）
- hover 時顯示 tooltip：「專業施工圖模式：新增 13 個工程部件（車架、緩衝器、安全裝置、多樓層標記等），輸出 18 圖層 DXF，可在 AutoCAD 中逐層控制可見度。」
- tooltip 背景 var(--bg-panel)，邊框 var(--border-strong)

### 7.4 不使用 Badge

不顯示 "+13 部件" badge，避免 toggle 開關時按鈕移位。改用 hover tooltip 提供資訊。

## 8. Testing

### 8.1 Unit Tests

- 每個新繪圖函式有獨立測試
- 驗證圖層分配正確
- 驗證尺寸計算正確（offset、間距、自動選型）
- 驗證 detail_level 參數分派

### 8.2 Integration Tests

- draft 模式產出 = 現有行為（zero regression）
- professional 模式 DXF 包含 18 圖層
- 新規則在 Rules Tab 正確顯示
- API detail_level 參數驗證（missing = draft, invalid = 400）
- 緩衝器自動選型邏輯（speed threshold）

### 8.3 Coverage Target

≥ 90% line coverage on `src/**/*.ts`

## 9. Data Sources

| 來源 | 用途 |
|------|------|
| Wittur WCF / SLG series | Car sling offset, guide shoe dimensions |
| ISO 8100 / EN 81-20 | Buffer type selection threshold |
| Oleo elevator buffer catalog | Buffer dimension ranges |
| Mitsubishi NEXIEZ MRL spec | Traction machine approximate dimensions |
| Elevator World design parameters | Rail bracket spacing standards |
| structuraldetails.com | RC shaft wall thickness |

## 10. Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| 中信心部件尺寸不精確 | 標註 "SCHEMATIC"，存入 Rules DB 讓用戶可調 |
| 側面圖多樓層後圖面太長 | 按比例縮放，高層電梯 (>10F) 可能需要自動縮小 |
| DXF 檔案大小增加 | 預估增加 ~30-50%，仍在 KB 級別，可接受 |
| 新規則增加 Rules Tab 複雜度 | 用 professional 類別分組，預設摺疊 |

## 11. Not Building (Deferred to GitHub Issues)

1. **3D 顯示** — 用 Three.js 或類似工具在瀏覽器內 3D 渲染電梯
2. **多法規支援** — EN 81（歐洲）、ASME A17.1（美國）、GB 7588（中國）
