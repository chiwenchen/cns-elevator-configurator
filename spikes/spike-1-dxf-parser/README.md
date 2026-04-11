# Spike 1: DXF Parser 可行性

## 問題

電梯設計師用 AutoCAD 畫坑道 → 存成 DWG / DXF 檔。資料考古階段要把歷史 CAD 檔結構化成 `ShaftSpec + final_model_id` 表，這條路的最大風險是「CAD 檔能不能被程式自動 parse」。

- 如果能 parse → Sprint 1 的資料考古以 DXF parser 為核心工具，1-2 天處理 20-50 個案例
- 如果不能 parse → Fallback 到手動量測（1 週處理 20 個案例），整個時程要延後
- 最壞情況 → OCR + 視覺模型，Sprint 1 完全重新評估

## 驗證範圍

**驗證**：
- [x] DXF 檔能用 `dxf-parser` npm lib 被讀出結構化 entity 列表
- [x] `LINE` entity 能被抽出並組成 bounding box → 取得坑道寬 × 深
- [x] `TEXT` entity 能被抽出，供後續抽取 W= / D= / H= 標註

**本 spike 不驗證**（留給 Sprint 1）：
- DWG 格式（AutoCAD 原生二進位）— 得先用 ODA File Converter 或 LibreCAD 轉 DXF
- 複雜實案（含 block、insert、dimension、arc、polyline、3D）
- 多 layer / 多 viewport / 多圖紙
- 非軸對齊坑道（旋轉或非矩形）

## 方法

1. 手工寫一個 minimal DXF fixture (`fixture.dxf`)，包含：
   - 4 條 SHAFT layer 的 LINE（形成 2000mm × 2500mm 矩形）
   - 2 個 DIMENSIONS layer 的 TEXT 標註（"W=2000", "D=2500"）
2. 用 `dxf-parser@1.1.2` 讀進來，抽 LINE + TEXT
3. 從 LINE 座標算 bounding box → 驗證等於 2000 × 2500
4. 列出 TEXT 內容 → 驗證抓到預期標註

## 執行

```bash
bun spikes/spike-1-dxf-parser/parse.ts
```

## 結果

```
Parsed 6 entities from fixture.dxf
Entity types seen: Set(2) { "LINE", "TEXT" }
{
  "spike": "spike-1-dxf-parser",
  "pass": true,
  "extracted": {
    "width_mm": 2000,
    "depth_mm": 2500,
    "annotations": ["W=2000", "D=2500"],
    "shaft_line_count": 4
  },
  "boundingBox": { "minX": 0, "minY": 0, "maxX": 2000, "maxY": 2500 }
}

SPIKE 1 PASSED
```

## 結論

**PASS** — DXF 格式可以被 `dxf-parser` 可靠地解析，對於軸對齊矩形坑道，bounding box 方法能 100% 抽出寬深。

## Sprint 1 todo（由這個 spike 產生）

1. 跟使用者要 **1 個真實歷史 DXF 檔**（或 DWG，先用 ODA File Converter 轉 DXF），重跑這個 spike 驗證不是 synthetic 特例
2. 為 `dxf-parser` 寫一個型別化的 wrapper（lib 沒 ship TS types）
3. 處理 `LWPOLYLINE` / `POLYLINE`（很多 CAD 檔用 polyline 而非分開的 line）
4. 處理 `INSERT`（block reference）— 坑道可能是一個 block，需要遞迴展開
5. 實作 W= / D= / H= 標註解析（regex 或 LLM 輔助）
6. 處理 DWG → DXF 自動轉換流程（內建一個 ODA CLI wrapper 或 LibreCAD headless）

## 資料風險

**還沒解**：目前 spike 只證明 synthetic DXF 可讀。真實 AutoCAD 2018+ DXF 可能有：

- 版本差異：R12 / 2000 / 2018 / 2024 格式差異
- 中文字型相容性（SHAFT layer 若用中文）
- 圖紙比例（真實案例可能以公尺為單位，需要單位偵測）
- 疊圖（坑道圖疊在建築平面圖裡，要先隔離）

**建議**：第 0 週 spike gate 最後一步 — **跟業務要一個真實檔案重跑這個 script**。
