# RWD Mobile Design Spec

**Date**: 2026-04-13
**Goal**: 讓業務在手機上快速輸入參數、生成圖紙、預覽、下載 DXF。

---

## Breakpoints

| Range | Layout | Description |
|---|---|---|
| `< 768px` | 手機版 | Tab 切換式，底部 tab bar |
| `768px - 1060px` | 平板版 | 簡化桌面（隱藏 aside），兩欄 |
| `> 1060px` | 桌面版 | 現狀不動 |

**偵測方式**: 用 `window.matchMedia('(max-width: 767px)')` 統一控制手機版 show/hide，不純靠 CSS `display:none`。Tab bar 的 show/hide 和 tab 狀態需要 JS 介入，resize 時不會丟失狀態。

---

## 手機版 Layout（< 768px）

### 底部 Tab Bar

固定在螢幕底部，4 個 tab：

| Tab | 內容 | Hash route |
|---|---|---|
| 參數 | Solver 表單 (Mode A / Mode B) | `#/m/params` |
| 圖紙 | DXF 預覽（左右滑動切換平面圖/側面圖）| `#/m/drawing` |
| AI | AI 設計助理 chat（全螢幕）| `#/m/ai` |
| 規則 | 規則管理列表 | `#/m/rules` |

**Hash routing**: 手機版也用 hash route（`#/m/*`），讓瀏覽器返回鍵能在 tab 之間正確導航。用同一套 `hashchange` listener，根據 breakpoint 走不同的 render path：
- `< 768px` + `#/m/*` → 手機版 tab 切換
- `>= 768px` + `#/configurator` or `#/rules` → 桌面版 layout
- 進入手機版時自動從 `#/configurator` redirect 到 `#/m/params`

### 參數 Tab

- Mode A / Mode B 切換在頂部
- 表單欄位全寬，每個欄位一行
- 底部固定「產生 DXF 草稿」按鈕（在 tab bar 上方）
- solve 成功後自動切到圖紙 tab（`#/m/drawing`）

### 圖紙 Tab

- **左右滑動切換**平面圖 (Plan View) 和側面圖 (Elevation View)
- 底部有兩個小圓點 indicator（像相簿）
- 每張圖全螢幕寬度顯示
- **圖紙區域可 pinch-to-zoom**（JS touch events 控制 SVG transform）
- 頂部 bar：圖紙名稱 + 「下載 DXF」按鈕
- 驗證摘要（PASS / WARN / CNS）顯示在圖紙區域外面、獨立捲動區塊（不在 touch-action: none 範圍內）

### AI Tab

- 全螢幕 chat interface
- 訊息列表 + 底部輸入框
- 與桌面版 chat sidebar 共用同一套狀態和 API
- 鍵盤彈出時：用 `visualViewport` API 偵測鍵盤高度，調整輸入框位置，確保 scroll into view

### 規則 Tab

- 與桌面版 #/rules 共用同一套 UI
- 篩選器水平捲動（不換行）
- 規則列表全寬

---

## 原生 App 體驗（鎖定畫面）

### Viewport

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
```

注意：iOS Safari 從 iOS 10 起忽略 `user-scalable=no`。需要額外的 JS 防護。

### CSS 防護

```css
/* 防止整頁縮放（比 pan-x pan-y 更好，同時解決 300ms tap delay） */
html { touch-action: manipulation; }

/* 防止 pull-to-refresh / 橡皮筋效果 */
body { overscroll-behavior: none; }

/* 圖紙預覽區域攔截所有 touch（由 JS 獨立控制 pinch-to-zoom） */
.drawing-viewport { touch-action: none; }
```

### iOS Safari 額外防護

```javascript
// 阻止 iOS Safari 的整頁 pinch-to-zoom
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('gesturechange', (e) => e.preventDefault())
```

### 圖紙 Pinch-to-Zoom

圖紙預覽區域用 JS touch events 實現獨立的縮放：
- `touchstart` / `touchmove` / `touchend` 監聽雙指距離變化
- 控制 SVG container 的 `transform: scale(N) translate(X, Y)`
- 用 `requestAnimationFrame` 節流 touchmove，避免每幀多次觸發 layout
- 有最小/最大縮放限制（0.5x - 3x）
- 雙擊 reset 到 fit-to-width

### 圖紙左右滑動

- 用 `touchstart` / `touchmove` / `touchend` 偵測水平滑動
- **雙指時停止 swipe 邏輯**（`touches.length >= 2` 時不觸發 swipe，避免與 pinch-to-zoom 衝突）
- 滑動距離 > 50px 且水平分量 > 垂直分量 → 切換圖紙
- CSS `transition: transform 0.3s ease` 動畫

---

## 橫屏 Landscape 適配

業務展示圖紙時可能轉橫屏：
- Tab bar 仍在底部，但高度縮減（40px → 32px）
- 圖紙 tab 在 landscape 下圖紙佔滿可用空間（更寬的 viewport 讓圖紙顯示更清楚）
- 參數 tab 在 landscape 下表單欄位可以兩列（grid-template-columns: 1fr 1fr）

---

## 鍵盤處理

- 參數 tab 和 AI tab 都有 input，手機鍵盤彈出會推高 viewport
- 用 `visualViewport` API 偵測鍵盤高度
- Tab bar 在鍵盤彈出時隱藏（避免被擠壓）
- 底部固定按鈕（「產生 DXF 草稿」）在鍵盤彈出時跟著上移或隱藏

---

## iOS DXF 下載

- `Blob` + `URL.createObjectURL` + `<a download>` 在 iOS Safari 可能不支援直接下載
- Fallback：用 `window.open(blobUrl)` 開新 tab 讓使用者手動儲存
- 或者改成 server-side 生成下載 URL（`/api/designs/:id/download`），用 `Content-Disposition: attachment` header

---

## 平板版（768px - 1060px）

- 隱藏 aside（右側面板）
- 兩欄：solver form (300px) + viz area (1fr)
- 其餘同桌面版
- Chat sidebar 覆蓋在右側（同桌面行為）

---

## 桌面版（> 1060px）

不動。現有 3 欄 layout 保持不變。

---

## Header 適配

- 手機版：隱藏 source select 和 nav links（功能移到 tab bar）
- 只顯示 logo + 版本號 + 登入按鈕

---

## 技術實作

- CSS media queries + JS `matchMedia` 統一控制
- 不引入框架
- 所有改動在 `public/index.html` 內
- 手機版用 `#/m/*` hash routes，桌面版保留 `#/configurator` / `#/rules`
- 同一套 `hashchange` listener 根據 breakpoint 分流

---

## 不做

- PWA / Service Worker（v1 不需要離線）
- 手機版的 DXF 建築圖解析功能（hack-canada demo 只在桌面）
- 手機版的 designs.html（圖紙管理頁面的 RWD 另外做）
- 檔案拆分（index.html 已 3500 行，加 RWD 會到 ~4000 行。拆分是好主意但 scope 太大，另案處理）
