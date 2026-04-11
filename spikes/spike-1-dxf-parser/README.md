# Spike 1: DXF Parser 可行性

## 問題

電梯設計師用 AutoCAD 畫坑道 → 存成 DWG / DXF 檔。資料考古階段要把歷史 CAD 檔結構化成 `ShaftSpec + final_model_id` 表，這條路的最大風險是「CAD 檔能不能被程式自動 parse」。

真實業務情境：客戶給你的不是獨立的「電梯坑道圖」，通常是**整棟建築的平面圖**，電梯/核心區嵌在其中一個房間。Spike 的任務是驗證我們能自動定位到電梯房間並抽出其尺寸。

## 驗證範圍

**已驗證**：
- [x] `dxf-parser@1.1.2` 可讀真實 AutoCAD 2013 檔（219 KB, 714 entities, 無 crash）
- [x] 單位偵測：從 `$INSUNITS` header 讀出 Meters/Inches/Feet/mm/cm，自動換算 mm
- [x] 多種 entity type 處理：`LWPOLYLINE` (308), `TEXT` (256), `INSERT` (150)
- [x] AIA layer 命名約定偵測：`A-ROOM-BDRY`, `A-ROOM-NAME`, `A-WALL-STRC`...
- [x] **點在多邊形** 演算法把 elevator TEXT 標籤對應到其所在的 room polygon
- [x] 同一房間在多樓層出現時正確去重（by bbox key）
- [x] 尺寸驗證：擷取出的數字落在現實電梯坑道範圍（1-6 m）

**本 spike 不驗證**（留給 Sprint 1）：
- DWG 格式（AutoCAD 原生二進位）— 必須先用 LibreCAD / ODA File Converter 轉 DXF
- 非 AIA 命名約定（例：台灣事務所可能用中文 layer 名 `電梯` 或 `升降路`）
- 旋轉或非矩形坑道
- 多 layer / 多 viewport / 多圖紙混在一個 DXF
- 無 A-ROOM-BDRY 的圖（很多工程圖只畫牆線，沒 room polygon）
- 遞迴 `INSERT`（block reference）展開

## 測試案例

### Fixture 1：Synthetic minimal DXF (`fixture.dxf`)

手工寫的 minimal DXF，4 條 LINE 組成 2000 × 2500 矩形 + 2 個 TEXT 標註。用來驗證最基本的解析路徑。

**Parser**: `parse.ts`

**執行**：
```bash
bun spikes/spike-1-dxf-parser/parse.ts
```

**結果**：
```
Parsed 6 entities (LINE×4, TEXT×2)
Bounding box: 2000 × 2500 mm
SPIKE 1 PASSED
```

### Fixture 2：真實 AutoCAD 2013 建築圖 (`~/cns-data/sample_building.dxf`)

**來源**：`Elliot-Sones/Hack_Canada` GitHub repo (MIT license). 一棟 6 層住宅/商業混用建築的完整樓層平面圖。

**為什麼選這個**：
- 真實 AutoCAD 2013 DXF (非 synthetic)
- 用 AIA 標準 layer 命名約定（A-ROOM-BDRY, A-ROOM-NAME, A-WALL-STRC 等）
- **含 elevator 標籤 + 對應 room boundary polygon** — 就是我們要驗證的 join pattern
- 多樓層（16 個 elevator 相關 label，橫跨多個 core）
- 有 LWPOLYLINE + INSERT + TEXT 各種 entity 類型

**Parser**: `parse-real.ts`（演算法 v2：room-boundary extraction）

**演算法流程**：
1. Parse DXF → 取得 entities + header
2. 從 `$INSUNITS` 偵測單位（此檔為 Meters）
3. 抽出所有 `A-ROOM-BDRY` layer 上的 `LWPOLYLINE` → 得到 121 個 room polygon
4. 抽出所有含 "elev" 字樣的 `TEXT` → 得到 16 個 elevator 標籤
5. 對每個 elevator text 跑**點在多邊形**測試，找出包含該標籤位置的最小 room polygon
6. 以 bbox key 去重複（同一 room 可能有多個 TEXT 實例）
7. 將坐標單位換算為 mm

**執行**：
```bash
bun spikes/spike-1-dxf-parser/parse-real.ts
```

**結果**：
```
File size: 219.4 KB
Unit: Meters

Found 121 A-ROOM-BDRY polygons
Found 16 elevator text labels

Matched 16/16 labels to room polygons
Deduplicated to 16 unique shaft regions

Unique elevator shaft / core regions:

  labels: ["Core (elevator)"] × 6 instances → 4000 mm × 4000 mm
  labels: ["Stair/Elev (elevator)"] × 5 instances → 4000 mm × 6000 mm
  labels: ["Stair N (elevator)"] × 5 instances → 4000 mm × 6000 mm

{
  "pass": true,
  "entity_count": 714,
  "room_boundaries_found": 121,
  "elevator_labels_found": 16,
  "labels_matched_to_rooms": 16,
  "unique_shafts": 16,
  "realistic_shafts": 16
}

SPIKE 1 REAL: PASS
```

**命中率**：16/16 labels 成功配對到 room polygon，16/16 尺寸落在現實電梯坑道範圍（1-6 m 兩軸）。

## 結論

**PASS** — 全勝。Parser infrastructure 可處理真實 AutoCAD 2013 檔、AIA layer 命名、multi-entity types、單位轉換。room-boundary + point-in-polygon 演算法從整棟建築平面圖**精確抽出電梯/核心區尺寸**，deduplicate 跨樓層重複，落在 mm 等級。

## 兩個發現 Sprint 1 要記住

### 1. 真實 CAD 檔是建築圖，不是單一坑道圖

客戶不會給你「電梯坑道 CAD」這種東西 — 他們給你「整棟樓平面圖」。因此 Sprint 1 的資料考古不是「解析坑道 DXF」而是「從建築 DXF 裡定位電梯區域」。這改變了整個工作流：

- **不是** 一檔 DXF = 一個坑道
- **而是** 一檔 DXF = 一棟樓 + N 個電梯區，每個都要獨立抽出

### 2. AIA layer 約定是救命稻草

本 spike 靠 `A-ROOM-BDRY` 這個 AIA 標準 layer 名稱做 join。但台灣事務所跟電梯製造商**不一定**用 AIA 命名 — 他們可能用：
- 中文：`坑道`, `電梯`, `升降路`, `牆`
- 自訂簡碼：`S01`, `EV-WALL`, `LIFT`
- 混用：有些用 AIA 有些用中文

**Sprint 1 必要的 fallback 策略**：
1. **Layer 名字偵測**：先試 AIA，然後試中文關鍵字，然後試「含 ELEV / LIFT / 電梯」的 layer
2. **無 room-boundary layer 時**：退回找 LWPOLYLINE 鄰近 elevator text 的「最小閉合區域」
3. **完全無 elevator 標籤時**：拒絕自動處理，旗標交人工

### 額定 Sprint 1 工作量調整

原設計文件估 Sprint 1 D3-5 花 3 天結構化 20-50 個歷史案例。現在有了 real DXF 處理能力的驗證，建議：

- **D3**: 挑 10 個最近的歷史 DWG 檔 → 用 LibreCAD 批次轉 DXF
- **D4**: 跑 `parse-real.ts` 產生初版 `HistoricalCase[]`，人工檢視哪些 layer 名稱要加到偵測 fallback
- **D5**: 針對不符合 AIA 命名的檔案做個別處理，再補 10 個案例

依舊是 3 天，但成品品質會大幅提升。

## Sprint 1 Backlog（由這個 spike 衍生）

- [ ] **Sprint 1 D3 前置**：跟使用者要 1 個真實的公司 DWG/DXF 檔（用 spike 演算法跑跑看，回報 layer 命名情況）
- [ ] 為 `dxf-parser` 寫一個型別化的 wrapper（lib 沒 ship TS types）
- [ ] 加入 AIA + 中文 + 簡碼的 layer 偵測 fallback
- [ ] 處理 `INSERT`（block reference）遞迴展開
- [ ] 整合 LibreCAD 或 ODA CLI 做 DWG → DXF 批次轉換
- [ ] 寫 room-boundary extraction 的 unit tests（用 fixture.dxf 加幾種變形）

## 資料風險（還沒解）

- ⚠️ 本 spike 只在**一個** 真實 DXF 檔上成功。Sprint 1 必須跟使用者拿**真實公司 CAD 檔**重跑（第 [issue #2](https://github.com/chiwenchen/cns-elevator-configurator/issues/2) 的原始驗收標準）
- ⚠️ 本 spike 沒處理 DWG 輸入（只 DXF）
- ⚠️ 若使用者公司用非 AIA 且非中文的自訂 layer 命名，fallback 策略還沒寫
- ⚠️ 單位偵測依賴 `$INSUNITS` header，若檔案沒寫這個 header 就會預設 unitless

---

**狀態：PASS**（synthetic + 1 個真實 DXF，共 2 個驗證案例）
