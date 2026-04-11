# Spike 3: 粗估價資料需求規格

## 問題

粗估價引擎（Sprint 2 D3-4）要回答業務「這個型號大概多少錢」的問題。設計文件約束它用**查表 + 歷史中位數 ± IQR**，不做機器學習模型。這需要：

1. 一份**型號基準價表** `(model_id, list_price_ntd)`
2. **歷史成交案例** `(case_id, model_id, final_price_ntd, year)` — 用來算折價率
3. **授權層級決定** — 業務能看到多精細的價格？

本 spike 不寫 code，只產出**資料需求規格**。Spike 只會在 user 帶著真實資料回來後才能真正「PASS」。

## 狀態

**BLOCKED** — 這個 spike 依賴內部商業資料，Claude 無法自己解鎖。必須 user 驗證以下三件事後才算通過：

- [ ] 型號基準價表可以取得（從 ERP / 型錄系統 / 報價系統）
- [ ] 歷史成交資料可以取得（至少近 12 個月）
- [ ] 業務主管同意 app 顯示價格（至少內部授權層級 decide）

## 資料需求規格

### A. 型號基準價表（ModelPriceBase）

**目的**：每個 `CatalogModel` 的「官方牌價」或「成本加成計算的基準價」。

**格式**：CSV 或 JSON。

```ts
type ModelPriceBase = {
  model_id: string             // 對應 CatalogModel.model_id
  base_price_ntd: number       // 牌價或基準價（NT$）
  currency: "TWD"              // 固定 TWD
  valid_from: string           // ISO date, e.g., "2025-01-01"
  valid_to: string | null      // null = 當前有效
  notes?: string               // e.g., "不含裝修", "含標準門型"
}
```

**最少量**：覆蓋目前主力 N 個標準型號（通常 N ∈ [20, 50]）。

**來源候選**：
- 內部報價系統匯出
- 業務用的「型號價目表」Excel
- ERP 的「物料主檔 + 標準成本」
- 業務主管人工提供

**隱私分級**：**機密** — 禁止上傳外部 LLM、禁止提交到 git（用 `.gitignore` 或 secret 管理）。

### B. 歷史成交案例（HistoricalDeal）

**目的**：計算「從牌價到實際成交價的折價率 pattern」— 同型號在近 12 個月的成交中位數 ± IQR。

**格式**：CSV 或 JSON。

```ts
type HistoricalDeal = {
  case_id: string              // 內部案號，可匿名化
  model_id: string
  final_price_ntd: number      // 實際成交價
  deal_date: string            // ISO date
  delivery_weeks: number        // 交期（週）
  customer_segment?: "residential" | "commercial" | "hospital" | "industrial"
  shaft?: ShaftSpec             // 若能拿到，最好也帶 shaft 規格
}
```

**最少量**：近 12 個月成交的全部案例（user 說年 1000 台，所以約 1000 筆）。

**隱私分級**：**高度機密** — 含客戶 segment，完全禁止外洩。

### C. 業務授權分級（顯示策略）

業務能看到多精細的價格？三種候選：

| 層級 | 業務看到 | 風險 |
|---|---|---|
| **A. 全價** | `NT$1,234,567 ± 15%` | 業務直接報實價給客戶，競爭對手容易 reverse engineering 成本結構 |
| **B. 區間** | `NT$100 萬 - NT$120 萬` | 業務還要跟主管 confirm 才能報死價，多一個摩擦 |
| **C. 等級** | `A 級價位` / `B 級價位` / `C 級價位` | 最安全，但業務抱怨「工具沒用」的機率最高 |

**建議**：**B 區間方案**是第一版預設，運行 1 個月後根據業務回饋調整。**不要默默選 A 或 C**，這是商業政策決定，不是工程決定。

## 粗估價演算法（Sprint 2 實作時這段當 spec）

```ts
function estimatePrice(modelId: string, now: Date = new Date()): PriceEstimate {
  const base = getBasePrice(modelId, now)
  const recentDeals = getHistoricalDeals(modelId, {
    since: subMonths(now, 12),
  })

  if (recentDeals.length < 3) {
    return {
      range: [base * 0.9, base * 1.1],
      confidence: "low",
      source: "base_price_fallback",
      sample_size: recentDeals.length,
    }
  }

  const discountRatios = recentDeals.map((d) => d.final_price_ntd / base)
  const sorted = discountRatios.toSorted((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const iqr = q3 - q1

  const low = base * (median - iqr / 2)
  const high = base * (median + iqr / 2)

  return {
    range: [low, high],
    median: base * median,
    confidence: recentDeals.length >= 10 ? "high" : "medium",
    source: "historical_median_with_iqr",
    sample_size: recentDeals.length,
  }
}
```

**關鍵**：沒有機器學習、沒有迴歸、沒有神經網路。純查表 + 統計。理由：

1. 可解釋性：業務主管問「為什麼這個價」，你能指到 N 個歷史案例給他看
2. Sprint 2 時程容得下：1 天寫完、1 天測試完
3. 符合設計文件約束：「粗估價引擎 v1 用查表，不做模型」

## 結論

**BLOCKED — 需要 user 提供內部資料才能 unblock**

**第 0 週結束前 user 必須完成**：

1. 問業務主管或 ERP 擁有者要：
   - 型號基準價表（A）
   - 近 12 個月成交資料（B）
2. 跟業務主管決定顯示層級（C）→ 建議 B 區間方案
3. 把 A + B 放到 repo 外的安全位置（`~/cns-data/` 或類似），用環境變數指向
4. 回報三項的可行性，把這個 spike status 從 BLOCKED 改成 PASS

**如果 A 或 B 拿不到**：整份粗估價引擎要放棄，回到「顯示規格 + 請業務主管人工報價」— Sprint 2 的 app 功能會降級，但核心檢核器 + matcher 仍可上線。這不是災難，但要提前知道。
