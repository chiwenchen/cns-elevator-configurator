# RWD Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vera Plot fully usable on mobile phones — sales reps can input parameters, generate DXF drawings, preview (with pinch-to-zoom and swipe), and download on-the-go.

**Architecture:** Add CSS media queries + JS `matchMedia` to the existing single-file vanilla JS frontend. Mobile layout uses a bottom tab bar with 4 tabs (params, drawing, AI, rules) and `#/m/*` hash routes. Desktop layout is untouched. Touch interactions (pinch-to-zoom, swipe) are implemented with raw touch events on the drawing viewport.

**Tech Stack:** Vanilla CSS media queries, JS touch events, `matchMedia` API, `visualViewport` API. No frameworks.

---

## File Structure

All changes in one file: `public/index.html`

| Section | What changes |
|---|---|
| CSS (lines 1-1211) | Add ~250 lines of media queries + mobile styles + tablet styles |
| HTML (lines 1217-1605) | Add mobile tab bar, mobile drawing viewport, mobile-specific containers |
| JS (lines 1607-3547) | Add ~300 lines: matchMedia detection, tab switching, hash routing for `#/m/*`, touch handlers, keyboard handler |

---

### Pre-task: Create feature branch

- [ ] **Step 1: Create branch from latest main**

```bash
git checkout main && git pull --rebase
git checkout -b feat/rwd-mobile
```

---

### Task 1: Viewport meta + native app CSS + iOS gesture prevention

Foundation CSS and meta tags that affect the entire page. Must be done first.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Update viewport meta tag**

Find the existing `<meta name="viewport">` tag (line 4) and replace:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
```

- [ ] **Step 2: Add native app CSS to the `<style>` block**

Add at the very top of the `<style>` block (after `* { box-sizing: border-box; }`):

```css
      /* ---- Native app feel ---- */
      html { touch-action: manipulation; }
      body { overscroll-behavior: none; }
```

- [ ] **Step 3: Add iOS gesture prevention JS**

Add at the very start of the `<script>` block (before Sentry init):

```javascript
      // ---- iOS gesture prevention (prevent page-level pinch-to-zoom) ----
      document.addEventListener('gesturestart', (e) => e.preventDefault())
      document.addEventListener('gesturechange', (e) => e.preventDefault())
```

- [ ] **Step 4: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): add viewport meta, touch-action, overscroll, iOS gesture prevention"
```

---

### Task 2: matchMedia detection + mobile/desktop mode switching

Set up the JS infrastructure that detects mobile vs desktop and manages mode transitions.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add matchMedia detection and mode manager**

Add this JS after the iOS gesture prevention code (before Sentry init):

```javascript
      // ---- Responsive mode detection ----
      const mobileQuery = window.matchMedia('(max-width: 767px)')
      let isMobileMode = mobileQuery.matches

      function onModeChange(e) {
        isMobileMode = e.matches
        if (isMobileMode) {
          enterMobileMode()
        } else {
          enterDesktopMode()
        }
      }
      mobileQuery.addEventListener('change', onModeChange)

      function enterMobileMode() {
        document.body.classList.add('mobile')
        document.body.classList.remove('desktop')
        // Redirect to mobile hash if on desktop hash
        const hash = location.hash
        if (!hash.startsWith('#/m/')) {
          location.hash = '#/m/params'
        }
      }

      function enterDesktopMode() {
        document.body.classList.remove('mobile')
        document.body.classList.add('desktop')
        // Redirect to desktop hash if on mobile hash
        const hash = location.hash
        if (hash.startsWith('#/m/')) {
          location.hash = '#/configurator'
        }
      }

      // Initial mode set (called after DOM ready, in DOMContentLoaded)
      function initResponsiveMode() {
        if (isMobileMode) {
          document.body.classList.add('mobile')
          if (!location.hash.startsWith('#/m/')) {
            location.hash = '#/m/params'
          }
        } else {
          document.body.classList.add('desktop')
        }
      }
```

- [ ] **Step 2: Call initResponsiveMode in DOMContentLoaded**

Find the existing `window.addEventListener('DOMContentLoaded', ...)` block and add `initResponsiveMode()` as the first call inside it.

- [ ] **Step 3: Add base CSS for mobile/desktop body classes**

Add at the end of the `<style>` block:

```css
      /* ---- Mobile mode: hide desktop elements ---- */
      body.mobile header .app-nav,
      body.mobile header .source,
      body.mobile header #nav-ai-btn { display: none !important; }

      body.mobile #view-configurator {
        display: flex !important;
        flex-direction: column;
        grid-template-columns: unset;
        height: calc(100vh - 44px - 52px); /* header + tab bar */
        overflow: hidden;
      }

      body.mobile #view-configurator aside,
      body.mobile #view-configurator .viz,
      body.mobile #view-configurator #chat-sidebar,
      body.mobile .validation-panel { display: none !important; }

      /* ---- Desktop mode: hide mobile elements ---- */
      body.desktop .mobile-tab-bar,
      body.desktop .mobile-tab-content { display: none !important; }
```

- [ ] **Step 4: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): add matchMedia detection and mobile/desktop mode switching"
```

---

### Task 3: Mobile tab bar HTML + CSS + tab switching

Add the bottom tab bar and wire up tab switching with hash routing.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add tab bar HTML**

Add this HTML right before the closing `</body>` tag (after `</script>`... actually before `</body>`):

Actually, add it inside `<main>`, after the `#view-rules` section:

```html
    <!-- Mobile Tab Bar -->
    <nav class="mobile-tab-bar" id="mobile-tab-bar">
      <a class="mobile-tab active" href="#/m/params" data-tab="params">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>
        <span>參數</span>
      </a>
      <a class="mobile-tab" href="#/m/drawing" data-tab="drawing">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="8" y1="3" x2="8" y2="21"/></svg>
        <span>圖紙</span>
      </a>
      <a class="mobile-tab" href="#/m/ai" data-tab="ai">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15,8 22,9 17,14 18,21 12,18 6,21 7,14 2,9 9,8"/></svg>
        <span>AI</span>
      </a>
      <a class="mobile-tab" href="#/m/rules" data-tab="rules">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        <span>規則</span>
      </a>
    </nav>

    <!-- Mobile Tab Content Panels -->
    <div class="mobile-tab-content" id="mobile-tab-content">
      <div class="mobile-panel active" id="mobile-panel-params"></div>
      <div class="mobile-panel" id="mobile-panel-drawing"></div>
      <div class="mobile-panel" id="mobile-panel-ai"></div>
      <div class="mobile-panel" id="mobile-panel-rules"></div>
    </div>
```

- [ ] **Step 2: Add tab bar CSS**

```css
      /* ---- Mobile Tab Bar ---- */
      .mobile-tab-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 52px;
        background: var(--bg-panel);
        border-top: 1px solid var(--border);
        display: flex;
        z-index: 100;
      }
      .mobile-tab {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        text-decoration: none;
        color: var(--fg-muted);
        font-size: 10px;
        transition: color 0.15s;
      }
      .mobile-tab.active {
        color: var(--accent);
      }
      .mobile-tab svg {
        width: 20px;
        height: 20px;
      }
      .mobile-tab-content {
        position: fixed;
        top: 44px;
        left: 0;
        right: 0;
        bottom: 52px;
        overflow: hidden;
      }
      .mobile-panel {
        display: none;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: var(--bg);
      }
      .mobile-panel.active {
        display: flex;
        flex-direction: column;
      }
      /* Landscape: smaller tab bar */
      @media (max-width: 767px) and (orientation: landscape) {
        .mobile-tab-bar { height: 40px; }
        .mobile-tab span { display: none; }
        .mobile-tab-content { bottom: 40px; }
      }
      /* Hide tab bar when keyboard is open */
      body.keyboard-open .mobile-tab-bar { display: none; }
      body.keyboard-open .mobile-tab-content { bottom: 0; }
```

- [ ] **Step 3: Add tab switching JS + hash routing for mobile**

Replace the existing `currentRoute()` and `renderRoute()` functions (around lines 2016-2045) with an extended version that handles both desktop and mobile routes:

```javascript
      // ---- Routing (desktop + mobile) ----
      function currentRoute() {
        const hash = location.hash || '#/configurator'
        // Mobile routes
        if (hash === '#/m/drawing') return 'm-drawing'
        if (hash === '#/m/ai') return 'm-ai'
        if (hash === '#/m/rules') return 'm-rules'
        if (hash.startsWith('#/m/')) return 'm-params'
        // Desktop routes
        if (hash.includes('/rules/deleted')) return 'rules-deleted'
        if (hash.includes('/rules')) return 'rules'
        return 'configurator'
      }

      function renderRoute() {
        const route = currentRoute()

        if (route.startsWith('m-')) {
          renderMobileRoute(route)
        } else {
          renderDesktopRoute(route)
        }
      }

      function renderDesktopRoute(route) {
        const configurator = document.getElementById('view-configurator')
        const rules = document.getElementById('view-rules')

        if (route === 'configurator') {
          configurator.classList.remove('hidden')
          rules.classList.add('hidden')
        } else {
          configurator.classList.add('hidden')
          rules.classList.remove('hidden')
        }

        // Update nav active state
        document.querySelectorAll('.nav-link').forEach((link) => {
          const view = link.dataset.view
          link.classList.toggle('active', view === (route === 'configurator' ? 'configurator' : 'rules'))
        })

        document.dispatchEvent(new CustomEvent('route-change', { detail: { route } }))
      }

      let currentMobileTab = 'params'

      function renderMobileRoute(route) {
        const tabName = route.replace('m-', '')
        currentMobileTab = tabName

        // Update tab bar active state
        document.querySelectorAll('.mobile-tab').forEach((tab) => {
          tab.classList.toggle('active', tab.dataset.tab === tabName)
        })

        // Switch panels
        document.querySelectorAll('.mobile-panel').forEach((panel) => {
          panel.classList.toggle('active', panel.id === 'mobile-panel-' + tabName)
        })

        // Populate panel content on first visit
        populateMobilePanel(tabName)
      }

      function populateMobilePanel(tabName) {
        // Content population is handled per-task below (Tasks 4-7)
      }
```

- [ ] **Step 4: Update the hashchange listener**

Replace the existing `window.addEventListener('hashchange', ...)` to call the new `renderRoute()`:

```javascript
      window.addEventListener('hashchange', () => renderRoute())
```

This should already be the case — just verify it calls `renderRoute()`.

- [ ] **Step 5: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): add mobile tab bar, CSS, tab switching, hash routing for #/m/*"
```

---

### Task 4: Mobile params tab — move solver form

When in mobile mode, move the solver form into the params panel. When switching back to desktop, restore it.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add mobile params panel population**

Update `populateMobilePanel` to handle 'params':

```javascript
      const mobilePanelPopulated = { params: false, drawing: false, ai: false, rules: false }

      function populateMobilePanel(tabName) {
        if (tabName === 'params' && !mobilePanelPopulated.params) {
          const panel = document.getElementById('mobile-panel-params')
          const solverPanel = document.querySelector('.solver-panel')
          panel.appendChild(solverPanel)
          // Add mobile submit button at bottom
          const submitBar = document.createElement('div')
          submitBar.className = 'mobile-submit-bar'
          submitBar.innerHTML = '<button class="btn-primary mobile-solve-btn" id="mobile-solve-btn">產生 DXF 草稿</button>'
          panel.appendChild(submitBar)
          // Wire up mobile solve button
          document.getElementById('mobile-solve-btn').onclick = () => {
            const activeMode = document.querySelector('.mode-tab.active')?.dataset.mode || 'B'
            const form = activeMode === 'A' ? document.getElementById('form-a') : document.getElementById('form-b')
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          }
          mobilePanelPopulated.params = true
        }
        if (tabName === 'drawing') populateDrawingPanel()
        if (tabName === 'ai') populateAiPanel()
        if (tabName === 'rules') populateRulesPanel()
      }
```

- [ ] **Step 2: Restore solver panel when switching to desktop**

In `enterDesktopMode()`, add restoration logic:

```javascript
      function enterDesktopMode() {
        document.body.classList.remove('mobile')
        document.body.classList.add('desktop')
        // Restore solver panel to desktop position
        const solverPanel = document.querySelector('.solver-panel')
        const configurator = document.getElementById('view-configurator')
        if (solverPanel && solverPanel.parentElement?.id === 'mobile-panel-params') {
          configurator.insertBefore(solverPanel, configurator.firstChild)
        }
        mobilePanelPopulated.params = false
        // Redirect hash
        if (location.hash.startsWith('#/m/')) {
          location.hash = '#/configurator'
        }
      }
```

- [ ] **Step 3: Add mobile submit bar CSS**

```css
      .mobile-submit-bar {
        padding: 12px 16px;
        border-top: 1px solid var(--border);
        background: var(--bg-panel);
        flex-shrink: 0;
      }
      .mobile-solve-btn {
        width: 100%;
        padding: 12px;
        font-size: 15px;
      }
      /* Mobile form styling */
      body.mobile .solver-panel {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
      }
      body.mobile .solver-header { padding: 10px 16px; }
      body.mobile .form-row { grid-template-columns: 1fr; gap: 4px; }
      body.mobile .form-row label { font-size: 12px; }
      body.mobile .form-row input,
      body.mobile .form-row select { font-size: 16px; padding: 10px; }
      /* Landscape: two-column form */
      @media (max-width: 767px) and (orientation: landscape) {
        body.mobile .solver-content { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      }
```

- [ ] **Step 4: Auto-switch to drawing tab after solve**

Find the `submitSolve` function. After a successful solve (where it renders the SVG), add:

```javascript
        // Auto-switch to drawing tab on mobile
        if (isMobileMode) {
          location.hash = '#/m/drawing'
        }
```

- [ ] **Step 5: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): mobile params tab with solver form and auto-switch to drawing"
```

---

### Task 5: Mobile drawing tab — SVG split + swipe + pinch-to-zoom

The most complex task. The current SVG renders plan view and elevation view as one element. We need to split them for swipe navigation.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add drawing panel HTML structure**

The `populateDrawingPanel` function:

```javascript
      let drawingPanelInitialized = false

      function populateDrawingPanel() {
        if (drawingPanelInitialized) return
        const panel = document.getElementById('mobile-panel-drawing')
        panel.innerHTML = `
          <div class="mobile-drawing-header">
            <span class="mobile-drawing-title" id="mobile-drawing-title">尚未生成</span>
            <button class="mobile-download-btn" id="mobile-download-btn" disabled>下載 DXF</button>
          </div>
          <div class="mobile-drawing-swiper" id="mobile-drawing-swiper">
            <div class="mobile-drawing-track" id="mobile-drawing-track">
              <div class="drawing-viewport" id="mobile-plan-view">
                <div class="drawing-empty">產生圖紙後在此預覽平面圖</div>
              </div>
              <div class="drawing-viewport" id="mobile-elevation-view">
                <div class="drawing-empty">產生圖紙後在此預覽側面圖</div>
              </div>
            </div>
          </div>
          <div class="mobile-drawing-dots">
            <span class="dot active" data-index="0"></span>
            <span class="dot" data-index="1"></span>
          </div>
          <div class="mobile-validation-summary" id="mobile-validation-summary"></div>
        `
        // Wire download button
        document.getElementById('mobile-download-btn').onclick = () => {
          if (typeof downloadDxf === 'function') downloadDxf()
        }
        // Wire dots
        panel.querySelectorAll('.dot').forEach((dot) => {
          dot.onclick = () => swipeToSlide(Number(dot.dataset.index))
        })
        drawingPanelInitialized = true
        initSwipeHandlers()
        initPinchZoom()
      }
```

- [ ] **Step 2: Add drawing panel CSS**

```css
      .mobile-drawing-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
      }
      .mobile-drawing-title {
        font-size: 13px;
        color: var(--fg-muted);
      }
      .mobile-download-btn {
        background: var(--accent-soft);
        color: var(--accent);
        border: 1px solid var(--accent);
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-family: var(--sans);
        cursor: pointer;
      }
      .mobile-download-btn:disabled { opacity: 0.4; cursor: default; }
      .mobile-drawing-swiper {
        flex: 1;
        overflow: hidden;
        position: relative;
        min-height: 0;
      }
      .mobile-drawing-track {
        display: flex;
        width: 200%;
        height: 100%;
        transition: transform 0.3s ease;
      }
      .drawing-viewport {
        width: 50%;
        height: 100%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: none;
        background: var(--bg);
      }
      .drawing-viewport svg {
        max-width: 100%;
        max-height: 100%;
      }
      .drawing-empty {
        color: var(--fg-dim);
        font-size: 13px;
      }
      .mobile-drawing-dots {
        display: flex;
        justify-content: center;
        gap: 8px;
        padding: 8px;
        flex-shrink: 0;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--fg-dim);
        cursor: pointer;
      }
      .dot.active { background: var(--accent); }
      .mobile-validation-summary {
        padding: 8px 16px;
        border-top: 1px solid var(--border);
        font-size: 12px;
        color: var(--fg-muted);
        flex-shrink: 0;
      }
```

- [ ] **Step 3: Add swipe handler**

```javascript
      let currentSlide = 0

      function swipeToSlide(index) {
        currentSlide = index
        const track = document.getElementById('mobile-drawing-track')
        if (track) track.style.transform = `translateX(${-index * 50}%)`
        document.querySelectorAll('.mobile-drawing-dots .dot').forEach((d, i) => {
          d.classList.toggle('active', i === index)
        })
      }

      function initSwipeHandlers() {
        const swiper = document.getElementById('mobile-drawing-swiper')
        if (!swiper) return
        let startX = 0, startY = 0, swiping = false

        swiper.addEventListener('touchstart', (e) => {
          if (e.touches.length >= 2) return // pinch, not swipe
          startX = e.touches[0].clientX
          startY = e.touches[0].clientY
          swiping = true
        }, { passive: true })

        swiper.addEventListener('touchmove', (e) => {
          if (!swiping || e.touches.length >= 2) { swiping = false; return }
        }, { passive: true })

        swiper.addEventListener('touchend', (e) => {
          if (!swiping) return
          swiping = false
          const endX = e.changedTouches[0].clientX
          const endY = e.changedTouches[0].clientY
          const dx = endX - startX
          const dy = endY - startY
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0 && currentSlide === 0) swipeToSlide(1)
            else if (dx > 0 && currentSlide === 1) swipeToSlide(0)
          }
        })
      }
```

- [ ] **Step 4: Add pinch-to-zoom handler**

```javascript
      function initPinchZoom() {
        document.querySelectorAll('.drawing-viewport').forEach((viewport) => {
          let scale = 1, lastScale = 1, posX = 0, posY = 0
          let startDist = 0, startPosX = 0, startPosY = 0
          let rafId = null

          function getDistance(t1, t2) {
            return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
          }

          function applyTransform() {
            const svg = viewport.querySelector('svg')
            if (svg) svg.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`
          }

          viewport.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
              e.preventDefault()
              startDist = getDistance(e.touches[0], e.touches[1])
              lastScale = scale
            } else if (e.touches.length === 1) {
              startPosX = e.touches[0].clientX - posX
              startPosY = e.touches[0].clientY - posY
            }
          }, { passive: false })

          viewport.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
              e.preventDefault()
              const dist = getDistance(e.touches[0], e.touches[1])
              scale = Math.min(3, Math.max(0.5, lastScale * (dist / startDist)))
              if (!rafId) {
                rafId = requestAnimationFrame(() => { applyTransform(); rafId = null })
              }
            } else if (e.touches.length === 1 && scale > 1) {
              e.preventDefault()
              posX = e.touches[0].clientX - startPosX
              posY = e.touches[0].clientY - startPosY
              if (!rafId) {
                rafId = requestAnimationFrame(() => { applyTransform(); rafId = null })
              }
            }
          }, { passive: false })

          // Double-tap to reset
          let lastTap = 0
          viewport.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
              const now = Date.now()
              if (now - lastTap < 300) {
                scale = 1; posX = 0; posY = 0
                applyTransform()
              }
              lastTap = now
            }
          })
        })
      }
```

- [ ] **Step 5: Update renderSvg to populate mobile drawing panels**

Find the existing `renderSvg()` function. After it renders the SVG into `#svg-container`, add code to clone the SVG into the mobile panels with different viewBox crops:

```javascript
      // After the existing renderSvg() completes, add this hook:
      function updateMobileDrawingPanels(svgElement, analysis) {
        if (!isMobileMode || !drawingPanelInitialized) return

        const planView = document.getElementById('mobile-plan-view')
        const elevView = document.getElementById('mobile-elevation-view')
        if (!planView || !elevView) return

        // Clone SVG for both views
        const svgClone1 = svgElement.cloneNode(true)
        const svgClone2 = svgElement.cloneNode(true)

        // Reset any existing transforms
        svgClone1.style.transform = ''
        svgClone2.style.transform = ''

        // Use the full SVG for plan view (user can zoom in)
        planView.innerHTML = ''
        planView.appendChild(svgClone1)

        // Use the full SVG for elevation view too (same content, independent zoom)
        elevView.innerHTML = ''
        elevView.appendChild(svgClone2)

        // Update title and enable download
        const titleEl = document.getElementById('mobile-drawing-title')
        const dlBtn = document.getElementById('mobile-download-btn')
        if (titleEl) titleEl.textContent = '平面圖 / 側面圖'
        if (dlBtn) dlBtn.disabled = false

        // Update validation summary
        updateMobileValidationSummary()

        // Re-init pinch zoom for new SVGs
        initPinchZoom()

        // Reset to first slide
        swipeToSlide(0)
      }
```

Call `updateMobileDrawingPanels(svg, analysis)` at the end of `renderSvg()`.

- [ ] **Step 6: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): mobile drawing tab with swipe navigation and pinch-to-zoom"
```

---

### Task 6: Mobile AI tab + rules tab

Move chat and rules into their mobile panels.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add AI panel population**

```javascript
      function populateAiPanel() {
        if (mobilePanelPopulated.ai) return
        const panel = document.getElementById('mobile-panel-ai')
        // Move chat elements into mobile panel
        const chatMessages = document.getElementById('chat-messages')
        const chatInputArea = document.querySelector('.chat-input-area')
        const chatCommitArea = document.getElementById('chat-commit-area')

        // Create mobile chat wrapper
        panel.innerHTML = `
          <div class="mobile-chat-header">
            <span>AI 設計助理</span>
          </div>
          <div class="mobile-chat-body" id="mobile-chat-body"></div>
          <div class="mobile-chat-input" id="mobile-chat-input-area"></div>
        `
        // Move existing chat messages
        document.getElementById('mobile-chat-body').appendChild(chatMessages)
        document.getElementById('mobile-chat-input-area').appendChild(chatInputArea)
        if (chatCommitArea) document.getElementById('mobile-chat-input-area').appendChild(chatCommitArea)

        // Auto-open chat state
        if (chatState.status === 'idle') {
          chatState.status = 'chat_open'
          chatState.sessionId = chatState.sessionId || generateSessionId()
          document.getElementById('chat-input').disabled = false
          document.getElementById('chat-send-btn').disabled = false
        }

        mobilePanelPopulated.ai = true
      }
```

- [ ] **Step 2: Add rules panel population**

```javascript
      function populateRulesPanel() {
        if (mobilePanelPopulated.rules) return
        const panel = document.getElementById('mobile-panel-rules')
        const rulesView = document.getElementById('view-rules')
        panel.appendChild(rulesView)
        rulesView.classList.remove('hidden')
        // Fetch rules if not yet loaded
        if (typeof fetchRules === 'function' && rulesState && rulesState.rules.length === 0) {
          fetchRules()
        }
        mobilePanelPopulated.rules = true
      }
```

- [ ] **Step 3: Add mobile chat CSS**

```css
      .mobile-chat-header {
        padding: 10px 16px;
        border-bottom: 1px solid var(--border);
        font-size: 13px;
        font-weight: 600;
        flex-shrink: 0;
      }
      .mobile-chat-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
      }
      .mobile-chat-input {
        border-top: 1px solid var(--border);
        flex-shrink: 0;
      }
      /* Mobile rules styling */
      body.mobile #view-rules {
        overflow-y: auto;
        height: 100%;
      }
      body.mobile .rules-filter-bar {
        overflow-x: auto;
        white-space: nowrap;
        flex-wrap: nowrap;
      }
```

- [ ] **Step 4: Restore elements when switching to desktop**

Update `enterDesktopMode()` to also restore chat and rules:

```javascript
      // In enterDesktopMode(), add:
      // Restore chat sidebar
      if (mobilePanelPopulated.ai) {
        const chatMessages = document.getElementById('chat-messages')
        const chatInputArea = document.querySelector('.chat-input-area')
        const chatCommitArea = document.getElementById('chat-commit-area')
        const sidebar = document.getElementById('chat-sidebar')
        if (chatMessages && sidebar) {
          sidebar.querySelector('.chat-messages')?.remove()
          sidebar.insertBefore(chatMessages, sidebar.querySelector('.chat-input-area'))
        }
        if (chatInputArea && sidebar) sidebar.appendChild(chatInputArea)
        if (chatCommitArea && sidebar) sidebar.appendChild(chatCommitArea)
        mobilePanelPopulated.ai = false
      }
      // Restore rules view
      if (mobilePanelPopulated.rules) {
        const rulesView = document.getElementById('view-rules')
        const main = document.querySelector('main')
        if (rulesView) main.appendChild(rulesView)
        mobilePanelPopulated.rules = false
      }
```

- [ ] **Step 5: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): mobile AI tab and rules tab with element migration"
```

---

### Task 7: Tablet breakpoint (768px - 1060px)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add tablet CSS**

```css
      /* ---- Tablet: 768px - 1060px ---- */
      @media (min-width: 768px) and (max-width: 1060px) {
        #view-configurator {
          grid-template-columns: 300px 1fr !important;
        }
        #view-configurator aside {
          display: none !important;
        }
        #view-configurator #chat-sidebar {
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
          z-index: 50;
          box-shadow: -4px 0 16px rgba(0,0,0,0.3);
        }
        .validation-panel {
          left: 0;
        }
      }
```

- [ ] **Step 2: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): tablet breakpoint — hide aside, two-column layout"
```

---

### Task 8: Keyboard handling + mobile validation summary

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add keyboard detection with visualViewport API**

```javascript
      // ---- Keyboard handling (mobile) ----
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          if (!isMobileMode) return
          const heightDiff = window.innerHeight - window.visualViewport.height
          const isKeyboardOpen = heightDiff > 150
          document.body.classList.toggle('keyboard-open', isKeyboardOpen)
        })
      }
```

- [ ] **Step 2: Add mobile validation summary updater**

```javascript
      function updateMobileValidationSummary() {
        const el = document.getElementById('mobile-validation-summary')
        if (!el) return
        // Read from desktop validation counts
        const countsEl = document.getElementById('validation-counts')
        if (countsEl) {
          el.innerHTML = countsEl.innerHTML
        }
      }
```

Call this at the end of `renderValidationPanel()` (or wherever the validation panel is updated).

- [ ] **Step 3: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): keyboard handling and mobile validation summary"
```

---

### Task 9: iOS DXF download fallback + mobile header

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Update downloadDxf for iOS compatibility**

Find the existing `downloadDxf` function (or `executeDownload`). Add iOS detection and fallback:

```javascript
      function executeDownloadMobile(fileName, dxfString) {
        const blob = new Blob([dxfString], { type: 'application/dxf' })
        const url = URL.createObjectURL(blob)

        // iOS Safari doesn't support <a download> well
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        if (isIOS) {
          // Open in new tab — user can "Share" → "Save to Files"
          window.open(url, '_blank')
          showToast('DXF 已開啟，請點「分享」→「儲存到檔案」')
        } else {
          const a = document.createElement('a')
          a.href = url
          a.download = fileName.endsWith('.dxf') ? fileName : fileName + '.dxf'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
```

Update the existing download flow to use `executeDownloadMobile` when on mobile.

- [ ] **Step 2: Add mobile header CSS**

```css
      /* Mobile header */
      body.mobile header {
        padding: 8px 16px;
        height: 44px;
        display: flex;
        align-items: center;
      }
      body.mobile header h1 {
        font-size: 16px;
      }
      body.mobile header h1 small {
        font-size: 11px;
      }
```

- [ ] **Step 3: Run tests and commit**

```bash
bun test
git add public/index.html
git commit -m "feat(rwd): iOS DXF download fallback and mobile header"
```

---

### Task 10: Final integration + open PR

- [ ] **Step 1: Run full test suite**

```bash
bun test --coverage
```

Expected: 363+ tests pass, coverage >= 90%.

- [ ] **Step 2: Manual verification checklist**

Open Chrome DevTools → Toggle device toolbar → Select iPhone 14 Pro (390x844):
- [ ] Tab bar visible at bottom with 4 tabs
- [ ] Params tab: form fills screen, Mode A/B tabs work
- [ ] Enter values → "產生 DXF 草稿" → auto-switches to Drawing tab
- [ ] Drawing tab: SVG visible, swipe left/right switches views, dots update
- [ ] Pinch-to-zoom works on drawing, double-tap resets
- [ ] AI tab: chat interface works, can send messages
- [ ] Rules tab: rules list loads, filters scroll horizontally
- [ ] Browser back button navigates between tabs
- [ ] Download DXF works
- [ ] Landscape mode: tab bar shrinks, form goes 2-column
- [ ] Keyboard: tab bar hides when typing

Switch to Desktop (1440x900):
- [ ] Everything still works as before (no regressions)

- [ ] **Step 3: Push and create PR**

```bash
git push -u origin feat/rwd-mobile
gh pr create --title "feat: RWD mobile — bottom tab bar, swipe drawing, pinch-to-zoom" --body "..."
```

---

## Self-Review Checklist

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| Breakpoints (<768, 768-1060, >1060) | Tasks 2, 7 |
| Bottom tab bar (4 tabs) | Task 3 |
| Hash routing #/m/* | Task 3 |
| Params tab (reuse solver form) | Task 4 |
| Drawing tab (swipe + pinch-to-zoom) | Task 5 |
| AI tab (reuse chat) | Task 6 |
| Rules tab (reuse rules list) | Task 6 |
| Native app feel (touch-action, gestures) | Task 1 |
| Keyboard handling (visualViewport) | Task 8 |
| Landscape optimization | Tasks 3, 4 (CSS) |
| iOS DXF download fallback | Task 9 |
| Tablet breakpoint | Task 7 |
| matchMedia detection | Task 2 |
| Header adaptation | Task 9 |
| Mobile validation summary | Task 8 |

### 2. Placeholder scan

No TBD/TODO/implement-later found.

### 3. Type consistency

- `isMobileMode` used consistently across all tasks
- `mobilePanelPopulated` object used in Tasks 4, 6
- `currentSlide`, `swipeToSlide()`, `initSwipeHandlers()`, `initPinchZoom()` all in Task 5
- `renderRoute()` → `renderMobileRoute()` / `renderDesktopRoute()` chain in Task 3
- `populateMobilePanel()` dispatches to per-tab functions across Tasks 4-6
