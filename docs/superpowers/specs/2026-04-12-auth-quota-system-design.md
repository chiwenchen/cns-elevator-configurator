# Auth + Quota System Design

**Goal:** Email OTP login with weekly quota-based feature gating (DXF export, AI chat) and company team sharing.

**Architecture:** All on Cloudflare Workers + D1. JWT in httpOnly cookie. OTP via Resend. Quota computed at query time (no cron). Company members share quota pool additively.

**Tech:** Bun + TypeScript + Cloudflare Workers + D1 + Resend + Web Crypto API (JWT)

---

## 1. DB Schema

### 1.1 `users`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE | Normalized email (lowercase, no dots/plus for Gmail) |
| raw_email | TEXT | Original email as entered (for display and sending) |
| role | TEXT DEFAULT 'user' | `'user'` / `'pro'` / `'admin'` |
| company_id | TEXT FK nullable | References companies.id |
| created_at | TEXT | ISO 8601 |

**Email normalization rules:**
- Gmail (`@gmail.com`, `@googlemail.com`): remove all `.` from local part, remove `+tag`, lowercase
- All other providers: remove `+tag` only, preserve dots, lowercase
- `email` column stores normalized form (UNIQUE constraint)
- `raw_email` stores original (for display and Resend delivery)

### 1.2 `otp_codes`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| email | TEXT | Normalized email |
| code | TEXT | 6-digit numeric string |
| expires_at | TEXT | created_at + 10 minutes |
| used | INTEGER DEFAULT 0 | 0 or 1 |
| attempts | INTEGER DEFAULT 0 | Wrong attempts count, max 5 |
| created_at | TEXT | ISO 8601 |

### 1.3 `sessions`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID (= JWT `jti` claim) |
| user_id | TEXT FK | References users.id |
| expires_at | TEXT | created_at + 7 days |
| created_at | TEXT | ISO 8601 |

### 1.4 `companies`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT | Company name |
| owner_id | TEXT FK | References users.id (creator) |
| created_at | TEXT | ISO 8601 |

### 1.5 `company_invites`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID (= invite token in URL) |
| company_id | TEXT FK | References companies.id |
| invited_email | TEXT | Normalized email of invitee |
| invited_by | TEXT FK | References users.id |
| expires_at | TEXT | created_at + 7 days |
| accepted | INTEGER DEFAULT 0 | 0 or 1 |
| created_at | TEXT | ISO 8601 |

Invite is bound to a specific email. If Bob tries to join with a different email than what Alice invited, the join is rejected.

### 1.6 `saved_designs`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | Who created it |
| company_id | TEXT FK nullable | For company sharing (copied from user at creation time) |
| name | TEXT | Auto-generated: "{use} — {stops}F / {capacity}kg" |
| solver_input | TEXT | JSON of form parameters |
| case_overrides | TEXT | JSON of team rule overrides |
| detail_level | TEXT | 'draft' or 'professional' |
| dxf_string | TEXT | Complete DXF file content |
| dxf_kb | REAL | File size in KB |
| archived_at | TEXT nullable | ISO 8601, null = active |
| created_at | TEXT | ISO 8601 |

DXF string is stored as-is (not regenerated) because rules/baseline may change over time. Typical size: 15-30 KB.

List queries must NOT select `dxf_string` (only fetched on download by ID).

**On company leave/removal:** `company_id` on saved_designs is set at creation time and NOT updated when a user leaves a company. Old designs remain shared with the former company. New designs created after leaving have `company_id = null`.

**Archive:** Designs have an `archived_at` column (null = active). User can archive a design to clean up their active list. Archived designs are auto-deleted 7 days after archiving. Users can unarchive before the 7-day window. Archiving does NOT refund quota.

### 1.7 Indexes

```sql
CREATE INDEX idx_designs_company_week ON saved_designs(company_id, created_at);
CREATE INDEX idx_designs_user ON saved_designs(user_id, created_at);
CREATE INDEX idx_chats_company_week ON chat_sessions(company_id, created_at);
CREATE INDEX idx_chats_user ON chat_sessions(user_id, created_at);
CREATE INDEX idx_otp_email ON otp_codes(email, used, expires_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
```

---

## 2. API Endpoints

### 2.1 Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/request-otp` | No | Send OTP to email |
| POST | `/api/auth/verify-otp` | No | Verify OTP, set JWT cookie |
| POST | `/api/auth/logout` | Yes | Delete session, clear cookie |
| GET | `/api/auth/me` | Yes | Current user info + quota status |

**`POST /api/auth/request-otp`**
- Body: `{ email: string }`
- Normalize email, check rate limit: 60s minimum between requests AND max 5 requests per email per hour (prevents brute-force by generating many OTPs)
- If user doesn't exist, create with role='user'
- Invalidate all unused OTPs for this email
- Generate 6-digit OTP, store in otp_codes (10 min expiry)
- Send via Resend to `raw_email`
- Response: `{ ok: true }` (never reveal if email exists)

**`POST /api/auth/verify-otp`**
- Body: `{ email: string, code: string }`
- Normalize email, find latest unused OTP for this email
- If no OTP or expired: 400
- If attempts >= 5: 400 (OTP exhausted)
- If code doesn't match: increment attempts, 400
- If match: mark used=1, create session, set httpOnly cookie
- Response: `{ user: { id, email, role, company_id }, is_new: boolean }` — `is_new` is true when the user was just created during request-otp (first login). Frontend uses this to show onboarding step.

**`POST /api/auth/logout`**
- Delete session record from DB
- Clear cookie
- Response: `{ ok: true }`

**`GET /api/auth/me`**
- Response: `{ user: { id, email, raw_email, role, company }, quota: { dxf_used, dxf_limit, ai_used, ai_limit, resets_at } }`

### 2.2 Designs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/designs` | Yes | List active designs (own + company, no dxf_string) |
| GET | `/api/designs/archived` | Yes | List archived designs |
| GET | `/api/designs/:id` | Yes | Single design with dxf_string (for download) |
| POST | `/api/designs/:id/archive` | Yes | Archive a design (own only) |
| POST | `/api/designs/:id/unarchive` | Yes | Unarchive (own only, within 7 days) |
| DELETE | `/api/designs/:id` | Yes | Permanently delete own design only |

`GET /api/designs` returns two arrays: `{ own: [...], shared: [...] }`. Only active designs (archived_at IS NULL). Shared includes company members' designs (excluding own). Each item includes `user_raw_email` for "by Bob" display.

`GET /api/designs/archived` returns `{ designs: [...] }` with days remaining before auto-delete.

### 2.3 Company

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/company` | Yes | Create company (if user has none) |
| GET | `/api/company` | Yes | Company info + member list |
| POST | `/api/company/invite` | Yes (owner) | Send invite to specific email |
| POST | `/api/company/join/:token` | Yes | Accept invite (email must match) |
| POST | `/api/company/leave` | Yes | Leave company (owner cannot leave) |
| DELETE | `/api/company/members/:userId` | Yes (owner) | Remove member |

**Invite flow:**
1. Alice (owner) calls POST `/api/company/invite` with `{ email: "bob@gmail.com" }`
2. System creates company_invites record with normalized email, 7-day expiry
3. System sends invite email via Resend with link: `https://vera-plot.redarch.dev/invite/{token}`
4. Bob opens link, frontend calls POST `/api/company/join/{token}`
5. Backend checks: token valid? not expired? not accepted? Bob's normalized email matches invited_email?
6. If all pass: set Bob's company_id, mark invite accepted

**Constraints:**
- One user, one company. Must leave current company before joining another.
- Owner cannot leave (must transfer ownership or delete company... for v1, owner simply cannot leave).
- Removing a member sets their company_id to null.

### 2.4 Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | Admin | List all users with quota usage |
| PATCH | `/api/admin/users/:id` | Admin | Update role (user/pro/admin) |

**`PATCH /api/admin/users/:id`** — Updates role in users table. Takes effect immediately on next API request because auth middleware re-queries `users.role` from DB on every request (Section 3, Step 5). No session clearing needed.

Initial admin: `cwchen2000@gmail.com` (normalized: `cwchen2000@gmail.com`). Seeded on first deploy or via migration.

---

## 3. Auth Middleware

Three levels, composable:

```
optionalAuth(request, env) → { user: User | null }
requireAuth(request, env)  → { user: User } | 401
requireAdmin(request, env) → { user: User & { role: 'admin' } } | 403
```

**JWT structure:**
- Algorithm: HMAC-SHA256 via Web Crypto API (zero dependencies)
- Payload: `{ sub: user_id, jti: session_id, role: string, exp: number }`
- Cookie: `vp_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`

**Validation steps:**
1. Read `vp_session` cookie from request
2. Verify JWT signature with `JWT_SECRET`
3. Check `exp` not passed
4. Query `sessions` table by `jti` to confirm not revoked
5. Query `users` table by `sub` to get current role (in case admin changed it)
6. Return user object

Step 4-5 is one JOIN query: `SELECT u.*, s.id as session_id FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ?`

**Expired record cleanup:** On each auth request, 1% probability trigger cleanup: `DELETE FROM sessions WHERE expires_at < datetime('now')` and `DELETE FROM otp_codes WHERE expires_at < datetime('now')`. Also cleanup archived designs older than 7 days: `DELETE FROM saved_designs WHERE archived_at IS NOT NULL AND archived_at < :seven_days_ago`.

---

## 4. Quota System

### 4.1 Limits

| Role | DXF / week | AI rounds / week |
|------|-----------|-----------------|
| user | 3 | 10 |
| pro | 20 | 200 |
| admin | 999 | 9999 |

Company quota = SUM of all members' individual limits. Consumption is shared.

Example: Alice (pro, 20 DXF) + Bob (user, 3 DXF) = company limit 23 DXF/week. If Alice uses 15 and Bob uses 5, total used = 20, remaining = 3.

### 4.2 Reset

Every Monday 00:00 UTC+8 (Taiwan time). Computed at query time:

```typescript
function getWeekStart(): string {
  const now = new Date()
  // Convert to UTC+8
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = utc8.getUTCDay() // 0=Sun, 1=Mon
  const diff = day === 0 ? 6 : day - 1 // days since Monday
  utc8.setUTCDate(utc8.getUTCDate() - diff)
  utc8.setUTCHours(0, 0, 0, 0)
  // Convert back to UTC for DB comparison
  const weekStart = new Date(utc8.getTime() - 8 * 60 * 60 * 1000)
  return weekStart.toISOString()
}
```

### 4.3 Query

```sql
-- Get quota limit (sum of all company members, or just self if no company)
SELECT 
  SUM(CASE WHEN u.role='pro' THEN 20 WHEN u.role='admin' THEN 999 ELSE 3 END) as dxf_limit,
  SUM(CASE WHEN u.role='pro' THEN 200 WHEN u.role='admin' THEN 9999 ELSE 10 END) as ai_limit
FROM users u
WHERE u.company_id = :company_id  -- if user has company
   OR u.id = :user_id             -- fallback if no company

-- Get DXF usage this week (based on current member identity, not record snapshot)
SELECT COUNT(*) as used FROM saved_designs
WHERE created_at >= :week_start
  AND user_id IN (SELECT id FROM users WHERE company_id = :company_id)
-- If no company, fallback: AND user_id = :user_id

-- Get AI usage this week
SELECT COUNT(*) as used FROM chat_sessions
WHERE created_at >= :week_start
  AND user_id IN (SELECT id FROM users WHERE company_id = :company_id)
-- If no company, fallback: AND user_id = :user_id
```

### 4.4 Enforcement Points

- **`/api/solve`** (logged-in user): check DXF quota before generating. If exceeded, return 403 with `{ error: 'quota_exceeded', type: 'dxf', used, limit }`.
- **`/api/chat`** (logged-in user): check AI quota before calling Anthropic. If exceeded, return 403 with `{ error: 'quota_exceeded', type: 'ai', used, limit }`.
- **`/api/solve`** (not logged in): solve works (preview), but `dxf_string` is NOT returned. Frontend cannot trigger download.
- **`/api/chat`** (not logged in): return 401, frontend shows login modal.

**Race condition prevention:** Quota check + INSERT must run in a D1 `.batch()` call (implicit transaction). The batch executes: (1) SELECT COUNT for current usage, (2) INSERT INTO saved_designs/chat_sessions. If the count check in step 1 shows quota exceeded, the INSERT is skipped. D1 batch runs atomically, preventing two parallel requests from both passing the check.

---

## 5. Frontend UI

### 5.1 Auth State

```javascript
let currentUser = null  // { id, email, raw_email, role, company, quota }

async function checkAuth() {
  const res = await fetch('/api/auth/me')
  if (res.ok) {
    currentUser = await res.json()
    renderAuthenticatedNav()
  } else {
    currentUser = null
    renderAnonymousNav()
  }
}
```

Called on page load. Cookie is httpOnly so JS can't read it directly. `/api/auth/me` is the source of truth.

### 5.2 Login Modal (overlay, preserves form state)

Three steps in same modal (step 3 only for new users):
1. **Email input** — full-width email input. "寄送驗證碼" button.
2. **OTP input** — 6 individual digit boxes. Auto-advance focus on input. Auto-submit when 6th digit entered (no manual button). "重新寄送" with 60s countdown.
3. **Onboarding (new users only)** — verify-otp response includes `is_new: true` flag. If true, modal shows onboarding with company benefits explanation:
   - 標題：「歡迎加入 Vera Plot！」
   - 說明文字：「建立公司可以：」
     - 與同事共享設計指引和 DXF 圖紙
     - 合併使用額度（例如 2 位 Pro 成員 = 每週 40 張 DXF）
     - 透過邀請連結讓同事一鍵加入
   - 公司名稱 input + "建立公司" button
   - "之後再說" link（可隨時在「公司設定」建立）
   - Calls `POST /api/company` if filled. Only shown once (first login).

Modal is overlay on `body`, does NOT navigate away. All form state (solver inputs, case overrides) is preserved in memory.

### 5.3 Nav Bar (single row)

Left side: nav links (AI 設計助理, 設計出圖, 規則管理, 我的圖紙)
Right side:
- Not logged in: "登入" button (`.btn-secondary` style)
- Logged in: quota indicator (`DXF 1/3 · AI 4/10`) + email + "登出" link
- Pro + company: PRO badge + quota + company name + "登出"

"我的圖紙" nav link is dimmed (opacity 0.4) when not logged in, clicking it triggers login modal.

### 5.4 Feature Gating

When not-logged-in user clicks:
- "產生 DXF 施工圖" or "下載 DXF" → show "需要登入" modal (explains benefit, promises design preservation)
- "AI 設計助理" → same login modal

When logged-in user exceeds quota:
- DXF export → show "額度不足" modal with used/limit and Pro upgrade mention
- AI chat → same quota modal for AI rounds

### 5.5 My Designs Page (`/designs` route, `designs.html`)

- Page header: "我的圖紙" + quota indicator
- Card list: each card shows name, dimensions, detail_level, size, date
- Actions per card: 下載 DXF (accent color), 載入參數, 封存, 刪除 (dim)
- "載入參數" navigates to configurator with solver_input + case_overrides pre-filled
- "封存" moves design to archived list, keeps active list clean. Does NOT refund quota.
- Company section (if applicable): separator + "紅石建築 的共享圖紙" + shared cards
- Shared cards show "by {name}" in accent color, no delete button (only download + 載入)
- "已封存" tab/section at bottom: shows archived designs with days remaining + "取消封存" button. Auto-deleted after 7 days.

### 5.6 Admin Page (`/admin` route, `admin.html`)

- Table: email, role (badge), company, DXF this week, AI this week, action
- Action: "升為 Pro" / "降為 User" button per row
- Only visible to admin (nav link only rendered when role=admin)

### 5.7 Color System Cleanup

Current state: `:root` has well-defined CSS variables, but some places hardcode hex values (`#f58662`, `#7ee787`, `#ff8a80`). During implementation:
- Add `--accent-hover: #f58662` (currently hardcoded in `.btn-primary:hover`)
- Add `--success: #7ee787` and `--success-soft: rgba(46,160,67,0.12)`
- Add `--error: #ff8a80` and `--error-soft: rgba(248,81,73,0.12)`
- Replace all hardcoded hex references with variables

---

## 6. File Structure

### New files

```
src/auth/
  normalize-email.ts      ~30 lines — Gmail dot/plus normalization
  otp.ts                  ~80 lines — generate, verify, rate-limit
  jwt.ts                  ~60 lines — sign/verify with Web Crypto
  middleware.ts           ~70 lines — optionalAuth/requireAuth/requireAdmin

src/handlers/
  auth.ts                 ~120 lines — request-otp, verify-otp, logout, me
  designs.ts              ~80 lines  — list, get, delete saved designs
  company.ts              ~120 lines — create, invite, join, leave, remove
  admin.ts                ~60 lines  — list users, update role

src/config/
  quota.ts                ~50 lines  — getQuotaStatus(), getWeekStart()

migrations/
  0002_auth_tables.sql    — CREATE TABLE for all 6 new tables

public/
  designs.html            — My designs page
  admin.html              — Admin user management page
```

### Modified files

```
src/worker/index.ts       — New routes + middleware wiring
src/handlers/solve.ts     — Auth check + quota check + auto-save
src/handlers/chat.ts      — Auth check + quota check
src/demo/server.ts        — Mirror new auth routes for dev
public/index.html         — Login modal, nav auth state, quota UI, gating
wrangler.toml             — JWT_SECRET and RESEND_API_KEY secret bindings
```

### Schema migration on existing table

`chat_sessions` (existing) needs two new columns for quota tracking:
```sql
ALTER TABLE chat_sessions ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE chat_sessions ADD COLUMN company_id TEXT REFERENCES companies(id);
```
These go in `0002_auth_tables.sql` alongside the new table creations.

### Untouched

Solver, DXF generation, config/effective, config/baseline — zero changes.

---

## 7. Env Bindings

```toml
# wrangler.toml (secrets set via `wrangler secret put`)
[vars]
# none needed as vars

# Secrets (set via CLI, not in file):
# JWT_SECRET — random 256-bit key for HMAC-SHA256
# RESEND_API_KEY — from Resend dashboard
```

```typescript
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  DB: D1Database
  ANTHROPIC_API_KEY?: string
  JWT_SECRET: string
  RESEND_API_KEY: string
}
```

**Pre-deploy checklist:**
- [ ] Verify redarch.dev domain in Resend dashboard (add DNS records to Cloudflare)
- [ ] `wrangler secret put JWT_SECRET` (generate with `openssl rand -hex 32`)
- [ ] `wrangler secret put RESEND_API_KEY`

---

## 8. Email Templates

OTP email sent from: `Vera Plot <noreply@redarch.dev>`

Subject: `Vera Plot 驗證碼：{code}`

Body (plain text, no HTML template needed for v1):
```
您的 Vera Plot 驗證碼是：{code}

此驗證碼將在 10 分鐘後失效。
如果您沒有要求此驗證碼，請忽略此信。
```

Company invite email:

Subject: `{inviter_email} 邀請您加入 {company_name} — Vera Plot`

Body:
```
{inviter_email} 邀請您加入「{company_name}」團隊。

加入後，您將與團隊成員共享設計指引、DXF 圖紙，以及合併的使用額度。

點擊以下連結加入：
https://vera-plot.redarch.dev/invite/{token}

此連結將在 7 天後失效。
```
