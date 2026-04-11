# Spike 2: CNS 2866 Rule Schema 草稿

## 問題

Validator 的核心是**結構化的 CNS 2866 規則庫**。Sprint 1 D6-8 要把大約 30 條最常用的條文 key 成 `CnsRule[]`。本 spike 先驗證：

1. **Schema 設計合不合理** — 能不能表達 CNS 實際會出現的各種約束類型？
2. **候選條文列表** — 實際需要覆蓋的規則領域有哪些？
3. **Sprint 1 要做的具體工作量** — 28 條不是 30 條，預估工時能不能對齊 3 天？

## 範圍

**驗證**：
- [x] 設計一個能涵蓋 min / max / ratio / lookup_table / must_exist / custom 各類約束的 schema
- [x] 列出 28 條候選規則覆蓋核心領域（坑道、轎廂、鋼索、安全、無障礙、機房、緩衝器⋯）
- [x] 所有規則標記 `requires_verification: true` 以強制 Sprint 1 逐條核對

**本 spike 不驗證**（留給 Sprint 1）：
- ❌ 條文內容本身正確 — 所有 clause_id 跟數值都是**候選占位**
- ❌ 規則優先級 / 互斥關係
- ❌ 條文更新追蹤（CNS 會改版）
- ❌ 多國標準對照（ISO 4190 / EN 81 / JIS A 4301 parity）

## ⚠️ 重要聲明

**本草稿中所有 clause_id (CNS-2866-5.1.1 etc.) 與具體數值 (900mm, 1100mm, 安全係數 12 etc.) 皆為 placeholder，不代表 CNS 2866 實際條文內容。**

Sprint 1 D6-8 的工作是：

1. 取得 CNS 2866 實際條文（PDF / DOC / 內部整理版）
2. **逐條核對**：每個 placeholder rule 對應到真實 clause_id，修正數值
3. 補上 draft 漏掉的條文類別（本 spike 28 條只是候選框架）
4. 加上條文原文引用（legal traceability）
5. 把 `requires_verification` 全部翻成 `false`

**在這個核對完成前，validator 不能上 production，不能給業務做報價決策。**

## Schema 說明

```ts
type CnsRule = {
  clause_id: string              // e.g., "CNS-2866-5.2.1"
  title: string                   // 簡短中文標題
  description: string             // 條文要求描述
  constraint_type:
    | "min"                       // target >= value
    | "max"                       // target <= value
    | "min_relation"              // e.g., shaft >= model.min_shaft
    | "min_both"                  // 兩個 target 都要 >= 兩個 value
    | "max_abs"                   // |target| <= value
    | "ratio_max"                 // computed ratio <= bound
    | "lookup_table"              // 查表驗證（載重 vs 面積）
    | "must_exist"                // boolean 必須為 true
    | "custom"                    // 邏輯複雜，要寫專用 TypeScript function
  target?: string                 // dot-path to ShaftSpec or CatalogModel field
  targets?: string[]              // 多欄位版本
  evaluate?: string               // 人類可讀的 constraint 表達式（Sprint 1 轉 TS function）
  params?: Record<string, unknown>
  severity: "blocker" | "warning"
  applies_when: Record<string, unknown> | null  // 條件啟用
  requires_verification: boolean
}
```

## 候選規則統計

- **總條數**: 28
- **核心坑道尺寸**: 4 條 (clause 5.1.1 / 5.1.2 / 5.2.1 / 5.2.2)
- **轎廂尺寸 + 用途**: 6 條 (clause 6.x)
- **速度 / 載重對應**: 2 條 (clause 7-8)
- **門 + 安全**: 6 條 (clause 9-12)
- **標示 / 緊急 / 停層**: 4 條 (clause 13-16)
- **特殊用途 (無障礙/貨用/病床)**: 6 條 (CNS 13627 + CNS 2866 17-18)
- **機房**: 2 條 (clause 19-20)

**severity 分布**:
- blocker: 22 條 (78%)
- warning: 6 條 (22%)

## 結論

**PASS（有保留）** — schema 設計可涵蓋預期的規則類別。候選列表提供 Sprint 1 一個明確的工作結構，28 條規則在 3 個工作天內可對照 CNS 2866 完成核對。

**但 Sprint 1 的 D6-8 工時預估可能低估**：
- 原本設計文件寫「3 天 key 約 30 條」
- 若包含**逐條原文核對 + 數值修正 + 補漏條文**，實際需要 **4-5 天**
- 建議 Sprint 1 規劃階段把這部分延長 1-2 天，或把部分 warning 條放到 Sprint 2

## 下一步

- [ ] 取得 CNS 2866 條文原文（user 說「不是問題」，第 0 週結束前需要拿到）
- [ ] 找一位電梯設計資深工程師花 1 小時 review 這份草稿，標出漏掉的條文類別
- [ ] 決定 Sprint 1 D6-8 要延長幾天
