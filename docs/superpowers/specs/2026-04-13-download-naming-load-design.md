# Download Naming + Drawing Name Display + Load Saved Design

**Goal:** Improve DXF download UX with optional naming, display drawing name on canvas, and enable loading saved designs directly (not just parameters).

**Scope:** Frontend-only changes in `public/index.html` and `public/designs.html`. No backend changes needed.

---

## 1. Download Naming Modal

**Trigger:** User clicks "下載 DXF" button (after auth gate passes).

**Modal content:**
- Title: 「為圖紙命名」
- Input field: pre-filled with auto-generated name (e.g. "客用電梯 — 6F / 1000kg")
- Helper text: 「可選，留空將使用預設名稱」
- Buttons: 「下載」(primary) + 「取消」

**Behavior:**
1. User can edit the name, leave it as-is, or clear it (falls back to default)
2. On "下載":
   - Use the name (or default) as the DXF filename: `{name}.dxf`
   - If user is logged in, update `saved_designs.name` via existing save flow
   - Trigger blob download
   - Display the name on the canvas (see Section 2)
3. On "取消": close modal, nothing happens

**Default name generation:** `{用途中文} — {stops}F / {capacity}kg`
- 客用 / 貨用 / 病床 / 無障礙

**Uses existing modal CSS:** `.modal-backdrop` + `.modal` pattern already in index.html.

---

## 2. Drawing Name Display

**Position:** Below the viz-header subtitle, above the SVG canvas. Centered.

**Style:**
- Text: accent color (`var(--accent)`)
- Border: 1px solid accent, border-radius 4px, padding 4px 12px
- Font: 14px, sans-serif
- Hidden by default (`display: none`), shown when a name is set

**HTML:** `<div id="drawing-name" class="drawing-name"></div>`

**When to show:**
- After downloading DXF with a name → set text + show
- After loading a saved design with a name → set text + show
- After generating new DXF (no name yet) → hide

---

## 3. Load Saved Design (Full Restore)

**Current behavior:** designs.html "載入參數" links to `/?load={design_id}`, index.html fetches the design and... doesn't do anything yet (not implemented).

**New behavior:**

When index.html loads with `?load={id}` query param:
1. Fetch `GET /api/designs/{id}` (returns full record including `dxf_string`)
2. Parse `solver_input` JSON → determine mode (A or B) → switch to correct tab → fill form fields
3. Parse `case_overrides` JSON → restore `caseOverrideState`
4. Set professional toggle based on `detail_level`
5. Parse `dxf_string` with `analyzeGeneratedDxf()` → render with `renderSvg()`
6. Display `name` in the drawing name element
7. Enable download button (with the stored `dxf_string`)
8. Left panel is editable. User can modify params and hit "產生 DXF 草稿" to generate a new design.

**No re-solve needed.** The saved `dxf_string` is rendered directly.

**Error handling:** If design fetch fails (deleted, no access), show toast error and continue with blank state.

---

## 4. Modified Files

- `public/index.html` — download naming modal, drawing name display, load design logic
- `public/designs.html` — update "載入參數" button text to "載入圖紙" (more accurate)

No backend changes. No new files.
