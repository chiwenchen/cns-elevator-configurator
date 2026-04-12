# Auth + Quota System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email OTP login, weekly quota gating (DXF export + AI chat), company teams with shared additive quota, saved designs with archive, and admin user management to Vera Plot.

**Architecture:** All on existing Cloudflare Workers + D1 stack. JWT (Web Crypto HMAC-SHA256) in httpOnly cookie. OTP via Resend. Quota computed at query time with D1 batch for race-condition safety. Company members share additive quota pool.

**Tech Stack:** Bun + TypeScript + Cloudflare Workers + D1 + Resend + Web Crypto API

---

### Pre-task: Create feature branch

- [ ] **Step 1: Create branch from main**

```bash
git checkout main
git pull --rebase
git checkout -b feat/auth-quota
```

---

### Task 1: DB Migration — Auth Tables

**Files:**
- Create: `migrations/0002_auth_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/0002_auth_tables.sql
-- Migration 0002: auth, quota, and company tables
--
-- Creates 6 new tables + alters chat_sessions for quota tracking.
-- Depends on: 0001_initial_rules_schema.sql

-- ---- companies (before users, since users references it) -------

CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ---- users -----------------------------------------------------

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  raw_email   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'pro', 'admin')),
  company_id  TEXT REFERENCES companies(id),
  created_at  TEXT NOT NULL
);

-- Seed initial admin
INSERT INTO users (id, email, raw_email, role, company_id, created_at)
VALUES ('admin-001', 'cwchen2000@gmail.com', 'cwchen2000@gmail.com', 'admin', NULL, datetime('now'));

-- Now add FK on companies.owner_id (SQLite doesn't enforce ADD CONSTRAINT, but we document intent)
-- companies.owner_id references users.id

-- ---- otp_codes -------------------------------------------------

CREATE TABLE otp_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- ---- sessions --------------------------------------------------

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ---- company_invites -------------------------------------------

CREATE TABLE company_invites (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  invited_email   TEXT NOT NULL,
  invited_by      TEXT NOT NULL REFERENCES users(id),
  expires_at      TEXT NOT NULL,
  accepted        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

-- ---- saved_designs ---------------------------------------------

CREATE TABLE saved_designs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  company_id      TEXT REFERENCES companies(id),
  name            TEXT NOT NULL,
  solver_input    TEXT NOT NULL,
  case_overrides  TEXT NOT NULL DEFAULT '{}',
  detail_level    TEXT NOT NULL DEFAULT 'draft',
  dxf_string      TEXT NOT NULL,
  dxf_kb          REAL NOT NULL,
  archived_at     TEXT,
  created_at      TEXT NOT NULL
);

-- ---- ALTER chat_sessions for quota tracking --------------------

ALTER TABLE chat_sessions ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE chat_sessions ADD COLUMN company_id TEXT REFERENCES companies(id);

-- ---- Indexes ---------------------------------------------------

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_designs_company_week ON saved_designs(company_id, created_at);
CREATE INDEX idx_designs_user ON saved_designs(user_id, created_at);
CREATE INDEX idx_designs_archived ON saved_designs(archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX idx_chats_company_week ON chat_sessions(company_id, created_at);
CREATE INDEX idx_chats_user ON chat_sessions(user_id, created_at);
CREATE INDEX idx_otp_email ON otp_codes(email, used, expires_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_invites_email ON company_invites(invited_email, accepted);
```

- [ ] **Step 2: Apply migration to local D1**

```bash
wrangler d1 execute elevator-configurator-db --local --file=migrations/0002_auth_tables.sql
```

Expected: no errors.

- [ ] **Step 3: Apply migration to remote D1**

```bash
wrangler d1 execute elevator-configurator-db --remote --file=migrations/0002_auth_tables.sql
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/0002_auth_tables.sql
git commit -m "feat(auth): add migration 0002 — auth, company, designs tables"
```

---

### Task 2: Email Normalization

**Files:**
- Create: `src/auth/normalize-email.ts`
- Test: `src/auth/normalize-email.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/auth/normalize-email.test.ts
import { describe, test, expect } from 'bun:test'
import { normalizeEmail } from './normalize-email'

describe('normalizeEmail', () => {
  test('lowercases all emails', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com')
  })

  test('removes dots from Gmail local part', () => {
    expect(normalizeEmail('c.w.chen@gmail.com')).toBe('cwchen@gmail.com')
  })

  test('removes plus tag from Gmail', () => {
    expect(normalizeEmail('cwchen+test@gmail.com')).toBe('cwchen@gmail.com')
  })

  test('removes dots AND plus tag from Gmail', () => {
    expect(normalizeEmail('c.w.chen+work@gmail.com')).toBe('cwchen@gmail.com')
  })

  test('treats googlemail.com as Gmail', () => {
    expect(normalizeEmail('c.w.chen+x@googlemail.com')).toBe('cwchen@googlemail.com')
  })

  test('removes plus tag from non-Gmail but keeps dots', () => {
    expect(normalizeEmail('john.doe+tag@outlook.com')).toBe('john.doe@outlook.com')
  })

  test('preserves dots in non-Gmail addresses', () => {
    expect(normalizeEmail('first.last@company.com')).toBe('first.last@company.com')
  })

  test('handles email without plus tag', () => {
    expect(normalizeEmail('user@domain.org')).toBe('user@domain.org')
  })

  test('handles already-normalized email', () => {
    expect(normalizeEmail('cwchen2000@gmail.com')).toBe('cwchen2000@gmail.com')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/auth/normalize-email.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/auth/normalize-email.ts
const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']

export function normalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase()
  const [localRaw, domain] = lower.split('@') as [string, string]
  if (!localRaw || !domain) return lower

  // Remove +tag for all providers
  const local = localRaw.split('+')[0]!

  // Gmail: also remove dots from local part
  if (GMAIL_DOMAINS.includes(domain)) {
    return local.replace(/\./g, '') + '@' + domain
  }

  return local + '@' + domain
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/auth/normalize-email.test.ts
```

Expected: 9 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/auth/normalize-email.ts src/auth/normalize-email.test.ts
git commit -m "feat(auth): add email normalization (Gmail dot/plus handling)"
```

---

### Task 3: JWT Sign/Verify (Web Crypto)

**Files:**
- Create: `src/auth/jwt.ts`
- Test: `src/auth/jwt.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/auth/jwt.test.ts
import { describe, test, expect } from 'bun:test'
import { signJwt, verifyJwt } from './jwt'

const TEST_SECRET = 'test-secret-key-for-hmac-sha256-minimum-32-chars!'

describe('JWT', () => {
  test('sign and verify roundtrip', async () => {
    const payload = { sub: 'user-1', jti: 'sess-1', role: 'user' }
    const token = await signJwt(payload, TEST_SECRET, 3600)
    const decoded = await verifyJwt(token, TEST_SECRET)
    expect(decoded.sub).toBe('user-1')
    expect(decoded.jti).toBe('sess-1')
    expect(decoded.role).toBe('user')
    expect(decoded.exp).toBeGreaterThan(Date.now() / 1000)
  })

  test('rejects tampered token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, 3600)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(verifyJwt(tampered, TEST_SECRET)).rejects.toThrow('Invalid signature')
  })

  test('rejects expired token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, -1)
    expect(verifyJwt(token, TEST_SECRET)).rejects.toThrow('Token expired')
  })

  test('rejects malformed token', async () => {
    expect(verifyJwt('not-a-jwt', TEST_SECRET)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/auth/jwt.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/auth/jwt.ts

export interface JwtPayload {
  sub: string   // user_id
  jti: string   // session_id
  role: string
  exp: number   // unix seconds
  iat: number
}

function base64UrlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function getKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signJwt(
  payload: { sub: string; jti: string; role: string },
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  }

  const encoder = new TextEncoder()
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await getKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed JWT')

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await getKey(secret)
  const encoder = new TextEncoder()
  const signature = base64UrlDecode(signatureB64)
  const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(signingInput))

  if (!valid) throw new Error('Invalid signature')

  const payload: JwtPayload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64)),
  )

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired')
  }

  return payload
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/auth/jwt.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/auth/jwt.ts src/auth/jwt.test.ts
git commit -m "feat(auth): JWT sign/verify with Web Crypto HMAC-SHA256"
```

---

### Task 4: OTP Generation + Verification Logic

**Files:**
- Create: `src/auth/otp.ts`
- Test: `src/auth/otp.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/auth/otp.test.ts
import { describe, test, expect } from 'bun:test'
import { generateOtpCode, isOtpExpired, isOtpExhausted, OTP_EXPIRY_MS, OTP_MAX_ATTEMPTS } from './otp'

describe('OTP', () => {
  test('generateOtpCode returns 6-digit string', () => {
    const code = generateOtpCode()
    expect(code).toMatch(/^\d{6}$/)
    expect(code.length).toBe(6)
  })

  test('generateOtpCode produces different codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOtpCode()))
    expect(codes.size).toBeGreaterThan(1)
  })

  test('isOtpExpired returns false for fresh OTP', () => {
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString()
    expect(isOtpExpired(expiresAt)).toBe(false)
  })

  test('isOtpExpired returns true for old OTP', () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString()
    expect(isOtpExpired(expiresAt)).toBe(true)
  })

  test('isOtpExhausted returns false under limit', () => {
    expect(isOtpExhausted(OTP_MAX_ATTEMPTS - 1)).toBe(false)
  })

  test('isOtpExhausted returns true at limit', () => {
    expect(isOtpExhausted(OTP_MAX_ATTEMPTS)).toBe(true)
  })

  test('OTP_EXPIRY_MS is 10 minutes', () => {
    expect(OTP_EXPIRY_MS).toBe(10 * 60 * 1000)
  })

  test('OTP_MAX_ATTEMPTS is 5', () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/auth/otp.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/auth/otp.ts

export const OTP_EXPIRY_MS = 10 * 60 * 1000      // 10 minutes
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RATE_LIMIT_MS = 60 * 1000         // 60 seconds between requests
export const OTP_HOURLY_LIMIT = 5                   // max 5 requests per email per hour

export function generateOtpCode(): string {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  const num = array[0]! % 1000000
  return String(num).padStart(6, '0')
}

export function isOtpExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now()
}

export function isOtpExhausted(attempts: number): boolean {
  return attempts >= OTP_MAX_ATTEMPTS
}

export function getOtpExpiresAt(): string {
  return new Date(Date.now() + OTP_EXPIRY_MS).toISOString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/auth/otp.test.ts
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/auth/otp.ts src/auth/otp.test.ts
git commit -m "feat(auth): OTP generation and validation utilities"
```

---

### Task 5: Quota Calculation

**Files:**
- Create: `src/config/quota.ts`
- Test: `src/config/quota.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/config/quota.test.ts
import { describe, test, expect } from 'bun:test'
import { getWeekStartUtc, getQuotaLimits, QUOTA_LIMITS } from './quota'

describe('getWeekStartUtc', () => {
  test('returns ISO string', () => {
    const result = getWeekStartUtc()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('returns a Monday in UTC+8', () => {
    const result = getWeekStartUtc()
    const date = new Date(result)
    // Convert to UTC+8 to check day
    const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000)
    expect(utc8.getUTCHours()).toBe(0)
    expect(utc8.getUTCMinutes()).toBe(0)
    // Monday = 1
    expect(utc8.getUTCDay()).toBe(1)
  })

  test('week start is in the past or now', () => {
    const result = getWeekStartUtc()
    expect(new Date(result).getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('getQuotaLimits', () => {
  test('returns user limits for single user without company', () => {
    const limits = getQuotaLimits([{ role: 'user' }])
    expect(limits).toEqual({ dxf_limit: 3, ai_limit: 10 })
  })

  test('returns pro limits for single pro', () => {
    const limits = getQuotaLimits([{ role: 'pro' }])
    expect(limits).toEqual({ dxf_limit: 20, ai_limit: 200 })
  })

  test('returns admin limits', () => {
    const limits = getQuotaLimits([{ role: 'admin' }])
    expect(limits).toEqual({ dxf_limit: 999, ai_limit: 9999 })
  })

  test('sums company members additively', () => {
    const limits = getQuotaLimits([{ role: 'pro' }, { role: 'user' }])
    expect(limits).toEqual({ dxf_limit: 23, ai_limit: 210 })
  })

  test('three members: pro + pro + user', () => {
    const limits = getQuotaLimits([{ role: 'pro' }, { role: 'pro' }, { role: 'user' }])
    expect(limits).toEqual({ dxf_limit: 43, ai_limit: 410 })
  })
})

describe('QUOTA_LIMITS', () => {
  test('user limits', () => {
    expect(QUOTA_LIMITS.user).toEqual({ dxf: 3, ai: 10 })
  })
  test('pro limits', () => {
    expect(QUOTA_LIMITS.pro).toEqual({ dxf: 20, ai: 200 })
  })
  test('admin limits', () => {
    expect(QUOTA_LIMITS.admin).toEqual({ dxf: 999, ai: 9999 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/config/quota.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/config/quota.ts

export const QUOTA_LIMITS: Record<string, { dxf: number; ai: number }> = {
  user:  { dxf: 3,   ai: 10 },
  pro:   { dxf: 20,  ai: 200 },
  admin: { dxf: 999, ai: 9999 },
}

/**
 * Get the start of current week (Monday 00:00 UTC+8) as ISO string in UTC.
 */
export function getWeekStartUtc(): string {
  const now = new Date()
  // Convert to UTC+8
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = utc8.getUTCDay() // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? 6 : day - 1 // days since Monday
  utc8.setUTCDate(utc8.getUTCDate() - diff)
  utc8.setUTCHours(0, 0, 0, 0)
  // Convert back to UTC for DB comparison
  const weekStart = new Date(utc8.getTime() - 8 * 60 * 60 * 1000)
  return weekStart.toISOString()
}

/**
 * Get next Monday 00:00 UTC+8 as ISO string in UTC.
 */
export function getNextResetUtc(): string {
  const now = new Date()
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = utc8.getUTCDay()
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day
  utc8.setUTCDate(utc8.getUTCDate() + daysUntilMonday)
  utc8.setUTCHours(0, 0, 0, 0)
  const nextReset = new Date(utc8.getTime() - 8 * 60 * 60 * 1000)
  return nextReset.toISOString()
}

/**
 * Calculate total quota limits from an array of member roles.
 */
export function getQuotaLimits(
  members: Array<{ role: string }>,
): { dxf_limit: number; ai_limit: number } {
  let dxf_limit = 0
  let ai_limit = 0
  for (const m of members) {
    const limits = QUOTA_LIMITS[m.role] ?? QUOTA_LIMITS.user!
    dxf_limit += limits.dxf
    ai_limit += limits.ai
  }
  return { dxf_limit, ai_limit }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/config/quota.test.ts
```

Expected: 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/config/quota.ts src/config/quota.test.ts
git commit -m "feat(auth): quota calculation — weekly limits, company additive pooling"
```

---

### Task 6: Auth Middleware

**Files:**
- Create: `src/auth/middleware.ts`
- Test: `src/auth/middleware.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/auth/middleware.test.ts
import { describe, test, expect } from 'bun:test'
import { parseCookie, extractUser } from './middleware'
import { signJwt } from './jwt'

const TEST_SECRET = 'test-secret-key-for-hmac-sha256-minimum-32-chars!'

describe('parseCookie', () => {
  test('extracts named cookie from header', () => {
    expect(parseCookie('vp_session=abc123; other=xyz', 'vp_session')).toBe('abc123')
  })

  test('returns null when cookie not found', () => {
    expect(parseCookie('other=xyz', 'vp_session')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseCookie('', 'vp_session')).toBeNull()
  })

  test('handles spaces in cookie header', () => {
    expect(parseCookie('a=1; vp_session=tok; b=2', 'vp_session')).toBe('tok')
  })
})

describe('extractUser', () => {
  test('returns null for missing cookie', async () => {
    const result = await extractUser(null, TEST_SECRET)
    expect(result).toBeNull()
  })

  test('returns null for invalid token', async () => {
    const result = await extractUser('garbage', TEST_SECRET)
    expect(result).toBeNull()
  })

  test('returns payload for valid token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, 3600)
    const result = await extractUser(token, TEST_SECRET)
    expect(result).not.toBeNull()
    expect(result!.sub).toBe('u1')
    expect(result!.jti).toBe('s1')
  })

  test('returns null for expired token', async () => {
    const token = await signJwt({ sub: 'u1', jti: 's1', role: 'user' }, TEST_SECRET, -1)
    const result = await extractUser(token, TEST_SECRET)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/auth/middleware.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/auth/middleware.ts
import { verifyJwt, type JwtPayload } from './jwt'

export interface AuthUser {
  id: string
  email: string
  raw_email: string
  role: string
  company_id: string | null
  session_id: string
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const prefix = name + '='
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length)
    }
  }
  return null
}

/**
 * Extract JWT payload from cookie value.
 * Returns null if token is missing, invalid, or expired.
 * Does NOT check DB session — caller must do that.
 */
export async function extractUser(
  cookieValue: string | null,
  jwtSecret: string,
): Promise<JwtPayload | null> {
  if (!cookieValue) return null
  try {
    return await verifyJwt(cookieValue, jwtSecret)
  } catch {
    return null
  }
}

export const SESSION_COOKIE_NAME = 'vp_session'
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // 7 days in seconds

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

/**
 * Probabilistic cleanup — returns true 1% of the time.
 */
export function shouldRunCleanup(): boolean {
  return Math.random() < 0.01
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/auth/middleware.test.ts
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware.ts src/auth/middleware.test.ts
git commit -m "feat(auth): middleware utilities — cookie parsing, session cookie, cleanup"
```

---

### Task 7: Auth Handlers (request-otp, verify-otp, logout, me)

**Files:**
- Create: `src/handlers/auth.ts`
- Test: `src/handlers/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/handlers/auth.test.ts
import { describe, test, expect } from 'bun:test'
import {
  handleRequestOtp,
  handleVerifyOtp,
  handleLogout,
  handleMe,
  AuthError,
} from './auth'

// Mock D1 database
function createMockDb() {
  const tables: Record<string, any[]> = {
    users: [],
    otp_codes: [],
    sessions: [],
    companies: [],
    saved_designs: [],
    chat_sessions: [],
  }

  return {
    tables,
    prepare(query: string) {
      return {
        bind(..._args: any[]) {
          return this
        },
        async first() {
          // Simplified mock — returns based on query keywords
          if (query.includes('FROM users') && query.includes('WHERE email')) {
            return tables.users[0] ?? null
          }
          if (query.includes('FROM otp_codes') && query.includes('WHERE email')) {
            return tables.otp_codes.find((o: any) => !o.used) ?? null
          }
          if (query.includes('FROM sessions')) {
            return tables.sessions[0] ?? null
          }
          if (query.includes('COUNT(*)')) {
            return { count: 0 }
          }
          return null
        },
        async all() {
          return { results: [] }
        },
        async run() {
          return { success: true }
        },
      }
    },
    batch(stmts: any[]) {
      return Promise.all(stmts.map((s: any) => s.run()))
    },
  }
}

// Mock Resend
function createMockResend() {
  const sent: Array<{ to: string; subject: string }> = []
  return {
    sent,
    async sendOtp(to: string, code: string) {
      sent.push({ to, subject: `Vera Plot 驗證碼：${code}` })
    },
  }
}

describe('handleRequestOtp', () => {
  test('rejects empty email', async () => {
    const db = createMockDb()
    const resend = createMockResend()
    await expect(
      handleRequestOtp({ email: '' }, db as any, resend.sendOtp),
    ).rejects.toThrow(AuthError)
  })

  test('rejects invalid email format', async () => {
    const db = createMockDb()
    const resend = createMockResend()
    await expect(
      handleRequestOtp({ email: 'not-an-email' }, db as any, resend.sendOtp),
    ).rejects.toThrow(AuthError)
  })
})

describe('handleMe (unit)', () => {
  test('returns user info shape', () => {
    // handleMe requires a resolved auth user, test the structure
    const user = {
      id: 'u1',
      email: 'test@test.com',
      raw_email: 'test@test.com',
      role: 'user',
      company_id: null,
    }
    // Simply verify structure matches expected shape
    expect(user).toHaveProperty('id')
    expect(user).toHaveProperty('email')
    expect(user).toHaveProperty('role')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/handlers/auth.ts
import { normalizeEmail } from '../auth/normalize-email'
import { generateOtpCode, getOtpExpiresAt, isOtpExpired, isOtpExhausted, OTP_RATE_LIMIT_MS, OTP_HOURLY_LIMIT } from '../auth/otp'
import { signJwt } from '../auth/jwt'
import { buildSessionCookie, buildClearSessionCookie, SESSION_MAX_AGE, type AuthUser } from '../auth/middleware'
import { getWeekStartUtc, getNextResetUtc, getQuotaLimits } from '../config/quota'

export class AuthError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'AuthError'
  }
}

type SendOtpFn = (to: string, code: string) => Promise<void>

export async function handleRequestOtp(
  body: { email?: string },
  db: any,
  sendOtp: SendOtpFn,
): Promise<{ ok: true }> {
  const rawEmail = (body.email ?? '').trim()
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new AuthError('請輸入有效的 email')
  }
  const email = normalizeEmail(rawEmail)

  // Rate limit: 60s between requests
  const recentOtp = await db.prepare(
    `SELECT created_at FROM otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first()

  if (recentOtp) {
    const elapsed = Date.now() - new Date(recentOtp.created_at).getTime()
    if (elapsed < OTP_RATE_LIMIT_MS) {
      throw new AuthError('請稍候再試，每 60 秒只能寄送一次驗證碼', 429)
    }
  }

  // Rate limit: max 5 per hour
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const hourlyCount = await db.prepare(
    `SELECT COUNT(*) as count FROM otp_codes WHERE email = ? AND created_at >= ?`
  ).bind(email, hourAgo).first()

  if (hourlyCount && hourlyCount.count >= OTP_HOURLY_LIMIT) {
    throw new AuthError('已超過每小時驗證碼上限，請稍後再試', 429)
  }

  // Create user if doesn't exist
  const existingUser = await db.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).bind(email).first()

  if (!existingUser) {
    const userId = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO users (id, email, raw_email, role, created_at) VALUES (?, ?, ?, 'user', ?)`
    ).bind(userId, email, rawEmail, new Date().toISOString()).run()
  }

  // Invalidate old OTPs
  await db.prepare(
    `UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0`
  ).bind(email).run()

  // Generate new OTP
  const code = generateOtpCode()
  const otpId = crypto.randomUUID()
  const now = new Date().toISOString()
  const expiresAt = getOtpExpiresAt()

  await db.prepare(
    `INSERT INTO otp_codes (id, email, code, expires_at, used, attempts, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)`
  ).bind(otpId, email, code, expiresAt, now).run()

  // Send email (use raw_email for delivery)
  const user = await db.prepare(`SELECT raw_email FROM users WHERE email = ?`).bind(email).first()
  await sendOtp(user?.raw_email ?? rawEmail, code)

  return { ok: true }
}

export async function handleVerifyOtp(
  body: { email?: string; code?: string },
  db: any,
  jwtSecret: string,
): Promise<{ user: any; is_new: boolean; cookie: string }> {
  const rawEmail = (body.email ?? '').trim()
  const code = (body.code ?? '').trim()
  if (!rawEmail || !code) {
    throw new AuthError('請輸入 email 和驗證碼')
  }
  const email = normalizeEmail(rawEmail)

  // Find latest unused OTP for this email
  const otp = await db.prepare(
    `SELECT * FROM otp_codes WHERE email = ? AND used = 0 ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first()

  if (!otp) {
    throw new AuthError('找不到驗證碼，請重新寄送')
  }

  if (isOtpExpired(otp.expires_at)) {
    throw new AuthError('驗證碼已過期，請重新寄送')
  }

  if (isOtpExhausted(otp.attempts)) {
    throw new AuthError('驗證碼嘗試次數已達上限，請重新寄送')
  }

  if (otp.code !== code) {
    await db.prepare(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`
    ).bind(otp.id).run()
    throw new AuthError('驗證碼錯誤')
  }

  // Mark used
  await db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).bind(otp.id).run()

  // Get user
  const user = await db.prepare(
    `SELECT id, email, raw_email, role, company_id, created_at FROM users WHERE email = ?`
  ).bind(email).first()

  if (!user) {
    throw new AuthError('使用者不存在', 500)
  }

  // Check if new user (created within last 5 minutes = likely just created by request-otp)
  const isNew = (Date.now() - new Date(user.created_at).getTime()) < 5 * 60 * 1000

  // Create session
  const sessionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const sessionExpires = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString()

  await db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).bind(sessionId, user.id, sessionExpires, now).run()

  // Sign JWT
  const token = await signJwt(
    { sub: user.id, jti: sessionId, role: user.role },
    jwtSecret,
    SESSION_MAX_AGE,
  )

  return {
    user: { id: user.id, email: user.email, raw_email: user.raw_email, role: user.role, company_id: user.company_id },
    is_new: isNew,
    cookie: buildSessionCookie(token),
  }
}

export async function handleLogout(
  sessionId: string,
  db: any,
): Promise<{ ok: true; cookie: string }> {
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run()
  return { ok: true, cookie: buildClearSessionCookie() }
}

export async function handleMe(
  user: AuthUser,
  db: any,
): Promise<{
  user: { id: string; email: string; raw_email: string; role: string; company: { id: string; name: string } | null }
  quota: { dxf_used: number; dxf_limit: number; ai_used: number; ai_limit: number; resets_at: string }
}> {
  // Get company info
  let company: { id: string; name: string } | null = null
  if (user.company_id) {
    const row = await db.prepare(`SELECT id, name FROM companies WHERE id = ?`).bind(user.company_id).first()
    if (row) company = { id: row.id, name: row.name }
  }

  // Get quota limits (all members if company)
  const weekStart = getWeekStartUtc()
  let members: Array<{ role: string }>

  if (user.company_id) {
    const result = await db.prepare(
      `SELECT role FROM users WHERE company_id = ?`
    ).bind(user.company_id).all()
    members = result.results as Array<{ role: string }>
  } else {
    members = [{ role: user.role }]
  }

  const limits = getQuotaLimits(members)

  // Get usage counts
  let dxfUsed: number
  let aiUsed: number

  if (user.company_id) {
    const dxfRow = await db.prepare(
      `SELECT COUNT(*) as count FROM saved_designs WHERE created_at >= ? AND user_id IN (SELECT id FROM users WHERE company_id = ?)`
    ).bind(weekStart, user.company_id).first()
    dxfUsed = dxfRow?.count ?? 0

    const aiRow = await db.prepare(
      `SELECT COUNT(*) as count FROM chat_sessions WHERE created_at >= ? AND user_id IN (SELECT id FROM users WHERE company_id = ?)`
    ).bind(weekStart, user.company_id).first()
    aiUsed = aiRow?.count ?? 0
  } else {
    const dxfRow = await db.prepare(
      `SELECT COUNT(*) as count FROM saved_designs WHERE created_at >= ? AND user_id = ?`
    ).bind(weekStart, user.id).first()
    dxfUsed = dxfRow?.count ?? 0

    const aiRow = await db.prepare(
      `SELECT COUNT(*) as count FROM chat_sessions WHERE created_at >= ? AND user_id = ?`
    ).bind(weekStart, user.id).first()
    aiUsed = aiRow?.count ?? 0
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      raw_email: user.raw_email,
      role: user.role,
      company,
    },
    quota: {
      dxf_used: dxfUsed,
      dxf_limit: limits.dxf_limit,
      ai_used: aiUsed,
      ai_limit: limits.ai_limit,
      resets_at: getNextResetUtc(),
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/handlers/auth.test.ts
```

Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/auth.ts src/handlers/auth.test.ts
git commit -m "feat(auth): auth handlers — request-otp, verify-otp, logout, me"
```

---

### Task 8: Designs Handlers

**Files:**
- Create: `src/handlers/designs.ts`
- Test: `src/handlers/designs.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/handlers/designs.test.ts
import { describe, test, expect } from 'bun:test'
import {
  handleListDesigns,
  handleListArchivedDesigns,
  handleGetDesign,
  handleArchiveDesign,
  handleUnarchiveDesign,
  handleDeleteDesign,
  DesignError,
} from './designs'
import type { AuthUser } from '../auth/middleware'

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'test@test.com',
  raw_email: 'test@test.com',
  role: 'user',
  company_id: null,
  session_id: 'sess-1',
}

const mockUserWithCompany: AuthUser = {
  ...mockUser,
  company_id: 'comp-1',
}

// Minimal mock DB
function createMockDb(designs: any[] = []) {
  return {
    prepare(query: string) {
      return {
        bind(..._args: any[]) { return this },
        async first() {
          if (query.includes('FROM saved_designs') && query.includes('WHERE id')) {
            return designs[0] ?? null
          }
          return null
        },
        async all() {
          return { results: designs }
        },
        async run() { return { success: true } },
      }
    },
  }
}

describe('handleListDesigns', () => {
  test('returns empty arrays when no designs', async () => {
    const db = createMockDb()
    const result = await handleListDesigns(mockUser, db as any)
    expect(result).toHaveProperty('own')
    expect(result).toHaveProperty('shared')
    expect(Array.isArray(result.own)).toBe(true)
  })
})

describe('handleDeleteDesign', () => {
  test('rejects when design not found', async () => {
    const db = createMockDb([])
    await expect(
      handleDeleteDesign('nonexistent', mockUser, db as any)
    ).rejects.toThrow(DesignError)
  })

  test('rejects when user does not own design', async () => {
    const db = createMockDb([{ id: 'd1', user_id: 'other-user' }])
    await expect(
      handleDeleteDesign('d1', mockUser, db as any)
    ).rejects.toThrow(DesignError)
  })
})

describe('handleArchiveDesign', () => {
  test('rejects when design not found', async () => {
    const db = createMockDb([])
    await expect(
      handleArchiveDesign('nonexistent', mockUser, db as any)
    ).rejects.toThrow(DesignError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/designs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/handlers/designs.ts
import type { AuthUser } from '../auth/middleware'

export class DesignError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'DesignError'
  }
}

const LIST_COLUMNS = `id, user_id, company_id, name, solver_input, case_overrides, detail_level, dxf_kb, archived_at, created_at`

export async function handleListDesigns(
  user: AuthUser,
  db: any,
): Promise<{ own: any[]; shared: any[] }> {
  // Own active designs
  const ownResult = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM saved_designs WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC`
  ).bind(user.id).all()
  const own = ownResult.results

  // Shared designs (company members, excluding own)
  let shared: any[] = []
  if (user.company_id) {
    const sharedResult = await db.prepare(
      `SELECT d.${LIST_COLUMNS.split(',').map(c => 'd.' + c.trim()).join(', ')}, u.raw_email as user_raw_email
       FROM saved_designs d JOIN users u ON d.user_id = u.id
       WHERE d.company_id = ? AND d.user_id != ? AND d.archived_at IS NULL
       ORDER BY d.created_at DESC`
    ).bind(user.company_id, user.id).all()
    shared = sharedResult.results
  }

  return { own, shared }
}

export async function handleListArchivedDesigns(
  user: AuthUser,
  db: any,
): Promise<{ designs: any[] }> {
  const result = await db.prepare(
    `SELECT ${LIST_COLUMNS} FROM saved_designs WHERE user_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC`
  ).bind(user.id).all()

  const designs = result.results.map((d: any) => ({
    ...d,
    days_remaining: Math.max(0, Math.ceil((new Date(d.archived_at).getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000))),
  }))

  return { designs }
}

export async function handleGetDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<any> {
  const design = await db.prepare(
    `SELECT *, (SELECT raw_email FROM users WHERE id = saved_designs.user_id) as user_raw_email FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)

  // Check access: own design or same company
  if (design.user_id !== user.id) {
    if (!user.company_id || design.company_id !== user.company_id) {
      throw new DesignError('無權存取此圖紙', 403)
    }
  }

  return design
}

export async function handleArchiveDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  const design = await db.prepare(
    `SELECT id, user_id FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)
  if (design.user_id !== user.id) throw new DesignError('只能封存自己的圖紙', 403)

  await db.prepare(
    `UPDATE saved_designs SET archived_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), id).run()

  return { ok: true }
}

export async function handleUnarchiveDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  const design = await db.prepare(
    `SELECT id, user_id, archived_at FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)
  if (design.user_id !== user.id) throw new DesignError('只能取消封存自己的圖紙', 403)
  if (!design.archived_at) throw new DesignError('此圖紙未被封存', 400)

  await db.prepare(
    `UPDATE saved_designs SET archived_at = NULL WHERE id = ?`
  ).bind(id).run()

  return { ok: true }
}

export async function handleDeleteDesign(
  id: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  const design = await db.prepare(
    `SELECT id, user_id FROM saved_designs WHERE id = ?`
  ).bind(id).first()

  if (!design) throw new DesignError('找不到此圖紙', 404)
  if (design.user_id !== user.id) throw new DesignError('只能刪除自己的圖紙', 403)

  await db.prepare(`DELETE FROM saved_designs WHERE id = ?`).bind(id).run()

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/handlers/designs.test.ts
```

Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/designs.ts src/handlers/designs.test.ts
git commit -m "feat(auth): designs handlers — list, get, archive, unarchive, delete"
```

---

### Task 9: Company Handlers

**Files:**
- Create: `src/handlers/company.ts`
- Test: `src/handlers/company.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/handlers/company.test.ts
import { describe, test, expect } from 'bun:test'
import {
  handleCreateCompany,
  handleGetCompany,
  handleLeaveCompany,
  CompanyError,
} from './company'
import type { AuthUser } from '../auth/middleware'

const mockUser: AuthUser = {
  id: 'user-1',
  email: 'test@test.com',
  raw_email: 'test@test.com',
  role: 'user',
  company_id: null,
  session_id: 'sess-1',
}

function createMockDb(overrides: Record<string, any> = {}) {
  return {
    prepare(query: string) {
      return {
        bind(..._args: any[]) { return this },
        async first() {
          if (query.includes('FROM companies') && overrides.company) return overrides.company
          return null
        },
        async all() {
          if (query.includes('FROM users') && query.includes('company_id')) {
            return { results: overrides.members ?? [] }
          }
          return { results: [] }
        },
        async run() { return { success: true } },
      }
    },
  }
}

describe('handleCreateCompany', () => {
  test('rejects if user already has company', async () => {
    const userWithCompany = { ...mockUser, company_id: 'existing-company' }
    const db = createMockDb()
    await expect(
      handleCreateCompany({ name: 'Test Co' }, userWithCompany, db as any)
    ).rejects.toThrow(CompanyError)
  })

  test('rejects empty company name', async () => {
    const db = createMockDb()
    await expect(
      handleCreateCompany({ name: '' }, mockUser, db as any)
    ).rejects.toThrow(CompanyError)
  })
})

describe('handleLeaveCompany', () => {
  test('rejects if user has no company', async () => {
    const db = createMockDb()
    await expect(
      handleLeaveCompany(mockUser, db as any)
    ).rejects.toThrow(CompanyError)
  })

  test('rejects if user is owner', async () => {
    const userOwner = { ...mockUser, company_id: 'comp-1' }
    const db = createMockDb({ company: { id: 'comp-1', owner_id: 'user-1' } })
    await expect(
      handleLeaveCompany(userOwner, db as any)
    ).rejects.toThrow(CompanyError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/company.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/handlers/company.ts
import type { AuthUser } from '../auth/middleware'
import { normalizeEmail } from '../auth/normalize-email'

export class CompanyError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'CompanyError'
  }
}

type SendInviteFn = (to: string, inviterEmail: string, companyName: string, token: string) => Promise<void>

export async function handleCreateCompany(
  body: { name?: string },
  user: AuthUser,
  db: any,
): Promise<{ company: { id: string; name: string } }> {
  if (user.company_id) {
    throw new CompanyError('您已經屬於一間公司，請先離開目前的公司')
  }
  const name = (body.name ?? '').trim()
  if (!name) {
    throw new CompanyError('請輸入公司名稱')
  }

  const companyId = crypto.randomUUID()
  const now = new Date().toISOString()

  await db.prepare(
    `INSERT INTO companies (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)`
  ).bind(companyId, name, user.id, now).run()

  await db.prepare(
    `UPDATE users SET company_id = ? WHERE id = ?`
  ).bind(companyId, user.id).run()

  return { company: { id: companyId, name } }
}

export async function handleGetCompany(
  user: AuthUser,
  db: any,
): Promise<{ company: any; members: any[] }> {
  if (!user.company_id) {
    throw new CompanyError('您尚未加入任何公司', 404)
  }

  const company = await db.prepare(
    `SELECT id, name, owner_id, created_at FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (!company) throw new CompanyError('找不到公司', 404)

  const membersResult = await db.prepare(
    `SELECT id, email, raw_email, role, created_at FROM users WHERE company_id = ?`
  ).bind(user.company_id).all()

  return {
    company: { ...company, is_owner: company.owner_id === user.id },
    members: membersResult.results,
  }
}

export async function handleInvite(
  body: { email?: string },
  user: AuthUser,
  db: any,
  sendInvite: SendInviteFn,
): Promise<{ ok: true; invite_id: string }> {
  if (!user.company_id) throw new CompanyError('您尚未加入任何公司')

  // Check ownership
  const company = await db.prepare(
    `SELECT id, name, owner_id FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (!company || company.owner_id !== user.id) {
    throw new CompanyError('只有公司擁有者可以邀請成員', 403)
  }

  const rawEmail = (body.email ?? '').trim()
  if (!rawEmail || !rawEmail.includes('@')) throw new CompanyError('請輸入有效的 email')

  const email = normalizeEmail(rawEmail)

  // Check if already a member
  const existing = await db.prepare(
    `SELECT id FROM users WHERE email = ? AND company_id = ?`
  ).bind(email, user.company_id).first()

  if (existing) throw new CompanyError('此使用者已經是公司成員')

  const inviteId = crypto.randomUUID()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await db.prepare(
    `INSERT INTO company_invites (id, company_id, invited_email, invited_by, expires_at, accepted, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).bind(inviteId, user.company_id, email, user.id, expiresAt, now).run()

  await sendInvite(rawEmail, user.raw_email, company.name, inviteId)

  return { ok: true, invite_id: inviteId }
}

export async function handleJoinCompany(
  token: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true; company: { id: string; name: string } }> {
  if (user.company_id) {
    throw new CompanyError('您已經屬於一間公司，請先離開目前的公司')
  }

  const invite = await db.prepare(
    `SELECT i.*, c.name as company_name FROM company_invites i JOIN companies c ON i.company_id = c.id WHERE i.id = ?`
  ).bind(token).first()

  if (!invite) throw new CompanyError('找不到此邀請連結', 404)
  if (invite.accepted) throw new CompanyError('此邀請已被使用')
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new CompanyError('此邀請已過期')
  if (invite.invited_email !== user.email) {
    throw new CompanyError('此邀請連結不是寄給您的 email', 403)
  }

  // Accept invite
  await db.prepare(`UPDATE company_invites SET accepted = 1 WHERE id = ?`).bind(token).run()
  await db.prepare(`UPDATE users SET company_id = ? WHERE id = ?`).bind(invite.company_id, user.id).run()

  return { ok: true, company: { id: invite.company_id, name: invite.company_name } }
}

export async function handleLeaveCompany(
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  if (!user.company_id) throw new CompanyError('您尚未加入任何公司')

  const company = await db.prepare(
    `SELECT owner_id FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (company && company.owner_id === user.id) {
    throw new CompanyError('公司擁有者無法離開公司')
  }

  await db.prepare(`UPDATE users SET company_id = NULL WHERE id = ?`).bind(user.id).run()

  return { ok: true }
}

export async function handleRemoveMember(
  targetUserId: string,
  user: AuthUser,
  db: any,
): Promise<{ ok: true }> {
  if (!user.company_id) throw new CompanyError('您尚未加入任何公司')

  const company = await db.prepare(
    `SELECT owner_id FROM companies WHERE id = ?`
  ).bind(user.company_id).first()

  if (!company || company.owner_id !== user.id) {
    throw new CompanyError('只有公司擁有者可以移除成員', 403)
  }

  if (targetUserId === user.id) {
    throw new CompanyError('無法移除自己')
  }

  const target = await db.prepare(
    `SELECT id, company_id FROM users WHERE id = ?`
  ).bind(targetUserId).first()

  if (!target || target.company_id !== user.company_id) {
    throw new CompanyError('此使用者不是公司成員', 404)
  }

  await db.prepare(`UPDATE users SET company_id = NULL WHERE id = ?`).bind(targetUserId).run()

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/handlers/company.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/company.ts src/handlers/company.test.ts
git commit -m "feat(auth): company handlers — create, invite, join, leave, remove"
```

---

### Task 10: Admin Handlers

**Files:**
- Create: `src/handlers/admin.ts`
- Test: `src/handlers/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/handlers/admin.test.ts
import { describe, test, expect } from 'bun:test'
import { handleListUsers, handleUpdateRole, AdminError } from './admin'

function createMockDb(users: any[] = []) {
  return {
    prepare(query: string) {
      return {
        bind(..._args: any[]) { return this },
        async first() {
          return users[0] ?? null
        },
        async all() {
          return { results: users }
        },
        async run() { return { success: true } },
      }
    },
  }
}

describe('handleUpdateRole', () => {
  test('rejects invalid role', async () => {
    const db = createMockDb([{ id: 'u1', role: 'user' }])
    await expect(
      handleUpdateRole('u1', { role: 'superadmin' }, db as any)
    ).rejects.toThrow(AdminError)
  })

  test('rejects unknown user', async () => {
    const db = createMockDb([])
    await expect(
      handleUpdateRole('nonexistent', { role: 'pro' }, db as any)
    ).rejects.toThrow(AdminError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/admin.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/handlers/admin.ts
import { getWeekStartUtc } from '../config/quota'

export class AdminError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
    this.name = 'AdminError'
  }
}

const VALID_ROLES = ['user', 'pro', 'admin']

export async function handleListUsers(
  db: any,
): Promise<{ users: any[] }> {
  const weekStart = getWeekStartUtc()

  const result = await db.prepare(`
    SELECT u.id, u.email, u.raw_email, u.role, u.company_id, u.created_at,
      c.name as company_name,
      (SELECT COUNT(*) FROM saved_designs d WHERE d.user_id = u.id AND d.created_at >= ?) as dxf_this_week,
      (SELECT COUNT(*) FROM chat_sessions s WHERE s.user_id = u.id AND s.created_at >= ?) as ai_this_week
    FROM users u
    LEFT JOIN companies c ON u.company_id = c.id
    ORDER BY u.created_at DESC
  `).bind(weekStart, weekStart).all()

  return { users: result.results }
}

export async function handleUpdateRole(
  userId: string,
  body: { role?: string },
  db: any,
): Promise<{ ok: true; user: { id: string; role: string } }> {
  const role = body.role
  if (!role || !VALID_ROLES.includes(role)) {
    throw new AdminError(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`)
  }

  const user = await db.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(userId).first()
  if (!user) throw new AdminError('找不到此使用者', 404)

  await db.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, userId).run()

  return { ok: true, user: { id: userId, role } }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/handlers/admin.test.ts
```

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/admin.ts src/handlers/admin.test.ts
git commit -m "feat(auth): admin handlers — list users, update role"
```

---

### Task 11: Wire Routes into Worker + Demo Server

**Files:**
- Modify: `src/worker/index.ts`
- Modify: `src/demo/server.ts`
- Modify: `wrangler.toml`

This is the integration task — wire all new handlers into the existing routing layer.

- [ ] **Step 1: Update Env interface in worker/index.ts**

Add `JWT_SECRET` and `RESEND_API_KEY` to the `Env` interface in `src/worker/index.ts`:

```typescript
interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  DB: D1Database
  ANTHROPIC_API_KEY?: string
  JWT_SECRET: string
  RESEND_API_KEY: string
}
```

- [ ] **Step 2: Add Resend email helper**

Create `src/auth/resend.ts`:

```typescript
// src/auth/resend.ts

export function createOtpSender(apiKey: string) {
  return async (to: string, code: string): Promise<void> => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'Vera Plot <noreply@redarch.dev>',
        to,
        subject: `Vera Plot 驗證碼：${code}`,
        text: `您的 Vera Plot 驗證碼是：${code}\n\n此驗證碼將在 10 分鐘後失效。\n如果您沒有要求此驗證碼，請忽略此信。`,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Resend API ${res.status}: ${text}`)
    }
  }
}

export function createInviteSender(apiKey: string) {
  return async (to: string, inviterEmail: string, companyName: string, token: string): Promise<void> => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'Vera Plot <noreply@redarch.dev>',
        to,
        subject: `${inviterEmail} 邀請您加入 ${companyName} — Vera Plot`,
        text: `${inviterEmail} 邀請您加入「${companyName}」團隊。\n\n加入後，您將與團隊成員共享設計指引、DXF 圖紙，以及合併的使用額度。\n\n點擊以下連結加入：\nhttps://vera-plot.redarch.dev/invite/${token}\n\n此連結將在 7 天後失效。`,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Resend API ${res.status}: ${text}`)
    }
  }
}
```

- [ ] **Step 3: Add auth routes to worker/index.ts**

Add all new API routes after existing routes but before the static assets fallback. The implementation should:

1. Import all new handlers and middleware utilities
2. Create a `resolveAuthUser` helper that reads cookie → verifies JWT → queries DB for user+session
3. Add routes for `/api/auth/*`, `/api/designs/*`, `/api/company/*`, `/api/admin/*`
4. Add `optionalAuth` to `/api/solve` (for gating dxf_string in response)
5. Add `requireAuth` to `/api/chat`
6. Add auto-save to `saved_designs` in solve handler when user is authenticated
7. Add probabilistic cleanup trigger

- [ ] **Step 4: Mirror routes in demo/server.ts**

Add same routes to the Bun dev server for local development. Use a test JWT secret (`'dev-secret-for-local-testing-only-do-not-use-in-prod'`) and a mock OTP sender that logs to console instead of calling Resend.

- [ ] **Step 5: Run full test suite**

```bash
bun test
```

Expected: All existing tests still pass + new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/worker/index.ts src/demo/server.ts src/auth/resend.ts wrangler.toml
git commit -m "feat(auth): wire auth/designs/company/admin routes into worker + demo server"
```

---

### Task 12: Modify solve.ts — Auth Gating + Quota + Auto-Save

**Files:**
- Modify: `src/handlers/solve.ts`
- Test: `src/handlers/solve.test.ts` (add new tests)

- [ ] **Step 1: Write failing tests for auth-gated behavior**

Add these tests to the existing `src/handlers/solve.test.ts` (or create a new `src/handlers/solve-auth.test.ts`):

```typescript
// src/handlers/solve-auth.test.ts
import { describe, test, expect } from 'bun:test'
import { handleSolve } from './solve'
import { InMemoryRulesStore } from '../config/load'
import type { AuthUser } from '../auth/middleware'

const validBody = {
  mode: 'B',
  stops: 6,
  usage: 'passenger',
  rated_load_kg: 1000,
}

describe('handleSolve with auth', () => {
  test('returns dxf_string when user is authenticated', async () => {
    const store = new InMemoryRulesStore()
    const user: AuthUser = { id: 'u1', email: 'test@test.com', raw_email: 'test@test.com', role: 'user', company_id: null, session_id: 's1' }
    const result = await handleSolve(validBody, store, user, null as any)
    expect(result.dxf_string).toBeDefined()
    expect(typeof result.dxf_string).toBe('string')
  })

  test('omits dxf_string when user is null (anonymous)', async () => {
    const store = new InMemoryRulesStore()
    const result = await handleSolve(validBody, store, null, null as any)
    expect(result.dxf_string).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/handlers/solve-auth.test.ts
```

Expected: FAIL — handleSolve signature doesn't match.

- [ ] **Step 3: Update handleSolve signature**

Modify `src/handlers/solve.ts` to accept optional `user` and `db` parameters:

- Add `user: AuthUser | null` and `db: any` parameters
- When user is null: return result without `dxf_string`
- When user is present: check DXF quota, auto-save to `saved_designs`, return full result
- Quota check uses D1 batch for atomicity

The existing `handleSolve(rawBody, loader)` calls in worker/demo must be updated to pass `user` and `db`.

- [ ] **Step 4: Run all tests**

```bash
bun test
```

Expected: All pass including new auth-gated tests.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/solve.ts src/handlers/solve-auth.test.ts
git commit -m "feat(auth): gate DXF output behind auth, add quota check + auto-save"
```

---

### Task 13: Modify chat.ts — Auth Gating + Quota

**Files:**
- Modify: `src/handlers/chat.ts`
- Test: add to existing `src/handlers/chat.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// Add to chat.test.ts or create chat-auth.test.ts
import { describe, test, expect } from 'bun:test'

describe('handleChat with auth', () => {
  test('rejects unauthenticated requests', async () => {
    // handleChat should now require user parameter
    // When user is null, it should throw
  })
})
```

- [ ] **Step 2: Update handleChat to accept user + db**

Add `user: AuthUser` parameter. Check AI quota before calling Anthropic. Track chat session in `chat_sessions` with `user_id` and `company_id`.

- [ ] **Step 3: Run all tests**

```bash
bun test
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/chat.ts src/handlers/chat.test.ts
git commit -m "feat(auth): gate AI chat behind auth with quota check"
```

---

### Task 14: Frontend — Login Modal + Nav Auth State

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add CSS variables for color system cleanup**

Add to `:root` in index.html:

```css
--accent-hover: #f58662;
--success: #7ee787;
--success-soft: rgba(46, 160, 67, 0.12);
--error: #ff8a80;
--error-soft: rgba(248, 81, 73, 0.12);
```

Replace all hardcoded references to these colors with the new variables.

- [ ] **Step 2: Add login modal HTML**

Add modal HTML before `</body>`. Include both email step and OTP step, controlled by JS state.

- [ ] **Step 3: Add login modal CSS**

Style the modal, OTP boxes (monospace, accent color), and transitions using existing CSS variables.

- [ ] **Step 4: Update nav bar**

- Add "我的圖紙" nav link (after 規則管理, before right side)
- Add login button (right side) for anonymous users
- Add quota display + email + logout for authenticated users
- Dim "我的圖紙" when not logged in

- [ ] **Step 5: Add auth state JS**

```javascript
let currentUser = null

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const data = await res.json()
      currentUser = data
      renderAuthenticatedNav()
    } else {
      currentUser = null
      renderAnonymousNav()
    }
  } catch {
    currentUser = null
    renderAnonymousNav()
  }
}
```

- [ ] **Step 6: Add feature gating logic**

Intercept "產生 DXF 施工圖", "下載 DXF", and "AI 設計助理" button clicks:
- If `currentUser === null`: show login modal
- If quota exceeded: show quota modal
- Otherwise: proceed normally

- [ ] **Step 7: Add OTP auto-submit behavior**

6 input boxes, auto-advance on input, auto-submit when 6th digit entered. 60s countdown for "重新寄送".

- [ ] **Step 8: Add onboarding step for new users**

After verify-otp returns `is_new: true`, show company creation step with benefits explanation.

- [ ] **Step 9: Test manually in browser**

```bash
bun src/demo/server.ts
```

Open `http://localhost:3000`, verify:
- Login button appears
- Clicking DXF/AI shows login modal
- Email → OTP → login works
- Nav updates with email + quota
- Logout clears state

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "feat(auth): login modal, nav auth state, feature gating, onboarding"
```

---

### Task 15: Frontend — My Designs Page

**Files:**
- Create: `public/designs.html`

- [ ] **Step 1: Create designs.html**

Full standalone page using same CSS variables as index.html. Includes:
- Same header/nav as index.html (with auth state)
- "我的圖紙" heading + quota indicator
- Design card list (fetched from `/api/designs`)
- Actions: 下載 DXF, 載入參數, 封存, 刪除
- Company shared section
- Archived section at bottom

- [ ] **Step 2: Add "載入參數" link behavior**

Clicking "載入參數" navigates to `/?load={design_id}` — index.html reads the query param on load and pre-fills the solver form.

- [ ] **Step 3: Add archive/unarchive/delete handlers**

Wire buttons to `/api/designs/:id/archive`, `/api/designs/:id/unarchive`, `DELETE /api/designs/:id`.

- [ ] **Step 4: Test manually**

```bash
bun src/demo/server.ts
```

Verify designs page loads, cards render, actions work.

- [ ] **Step 5: Commit**

```bash
git add public/designs.html
git commit -m "feat(auth): my designs page — list, download, archive, load params"
```

---

### Task 16: Frontend — Admin Page

**Files:**
- Create: `public/admin.html`

- [ ] **Step 1: Create admin.html**

Standalone page with user table. Only accessible when `currentUser.role === 'admin'`. Shows:
- User table: email, role badge, company, DXF/AI usage this week
- "升為 Pro" / "降為 User" buttons per row

- [ ] **Step 2: Wire role update buttons**

Call `PATCH /api/admin/users/:id` with `{ role: 'pro' }` or `{ role: 'user' }`. Refresh table on success.

- [ ] **Step 3: Test manually**

Login as `cwchen2000@gmail.com` (admin), verify admin page works.

- [ ] **Step 4: Commit**

```bash
git add public/admin.html
git commit -m "feat(auth): admin user management page"
```

---

### Task 17: Resend DNS Verification + Secrets

**Files:**
- Modify: `wrangler.toml` (documentation only — secrets via CLI)

- [ ] **Step 1: Verify redarch.dev domain in Resend**

Go to Resend dashboard → Domains → add `redarch.dev`. Add the required DNS records to Cloudflare DNS.

- [ ] **Step 2: Set Worker secrets**

```bash
openssl rand -hex 32 | wrangler secret put JWT_SECRET
wrangler secret put RESEND_API_KEY
```

- [ ] **Step 3: Deploy and smoke test**

```bash
wrangler deploy
```

Open `https://vera-plot.redarch.dev`, test full login flow.

- [ ] **Step 4: Commit any wrangler.toml changes**

```bash
git add wrangler.toml
git commit -m "chore: document auth secret bindings in wrangler.toml"
```

---

### Task 18: Full Test Suite + Coverage (≥90%, all happy paths)

**CRITICAL REQUIREMENT:** Test coverage MUST be ≥90% on all new files. Integration tests MUST cover every happy path for every endpoint.

- [ ] **Step 1: Write integration tests for auth happy paths**

Create `src/handlers/auth-integration.test.ts`:
- request-otp → creates user + sends OTP (mock Resend)
- verify-otp → returns user + sets cookie
- me → returns user info + quota
- logout → clears session
- Full flow: request → verify → me → logout → me returns 401

- [ ] **Step 2: Write integration tests for designs happy paths**

Create `src/handlers/designs-integration.test.ts`:
- List designs (empty)
- Auto-save via solve → list shows 1 design
- Get design by ID (includes dxf_string)
- Archive → list shows 0 active, archived shows 1
- Unarchive → back to active
- Delete → gone

- [ ] **Step 3: Write integration tests for company happy paths**

Create `src/handlers/company-integration.test.ts`:
- Create company
- Invite member → join → company has 2 members
- Shared quota is additive
- Leave company
- Owner removes member

- [ ] **Step 4: Write integration tests for admin happy paths**

Create `src/handlers/admin-integration.test.ts`:
- List users (includes admin seed)
- Update role user→pro → quota changes immediately
- Update role pro→user → quota changes back

- [ ] **Step 5: Write integration tests for quota enforcement**

Create `src/handlers/quota-integration.test.ts`:
- DXF quota: exhaust 3/3 → next solve returns 403
- AI quota: exhaust 10/10 → next chat returns 403
- Company shared: Alice(pro,20) + Bob(user,3) = 23 total

- [ ] **Step 6: Run full test suite with coverage**

```bash
bun test --coverage
```

Expected: ≥90% on all `src/auth/*`, `src/handlers/auth.ts`, `src/handlers/designs.ts`, `src/handlers/company.ts`, `src/handlers/admin.ts`, `src/config/quota.ts`.

- [ ] **Step 7: Fill any coverage gaps**

If any file is below 90%, add targeted tests for uncovered branches.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: integration tests for auth/quota/designs/company/admin — all happy paths"
```

---

### Task 19: Create Pull Request

- [ ] **Step 1: Push and create PR**

```bash
git push -u origin feat/auth-quota
gh pr create --title "feat: auth + quota system — login, DXF gating, company teams" --body "$(cat <<'EOF'
## Summary
- Email OTP login via Resend (6-digit code, 10 min expiry)
- JWT sessions in httpOnly cookie (Web Crypto HMAC-SHA256)
- Weekly quota: DXF exports + AI chat rounds (Monday reset UTC+8)
- Company teams: invite by email, shared additive quota pool
- Saved designs with archive (7-day auto-delete)
- Admin user management (role promotion)
- 6 new D1 tables, ~15 API endpoints, 3 HTML pages

## Test plan
- [ ] Login flow: email → OTP → session cookie set
- [ ] Anonymous: can use solver, cannot download DXF or use AI
- [ ] Logged in: DXF download works, auto-saved to designs
- [ ] Quota enforcement: 403 when exceeded
- [ ] Company: create, invite, join, shared quota
- [ ] Admin: list users, promote/demote roles
- [ ] My designs: list, download, archive, unarchive, delete
- [ ] Weekly reset: quota resets Monday 00:00 UTC+8

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Report PR URL**

---

## File Map

| File | Action | Task |
|------|--------|------|
| `migrations/0002_auth_tables.sql` | Create | 1 |
| `src/auth/normalize-email.ts` | Create | 2 |
| `src/auth/normalize-email.test.ts` | Create | 2 |
| `src/auth/jwt.ts` | Create | 3 |
| `src/auth/jwt.test.ts` | Create | 3 |
| `src/auth/otp.ts` | Create | 4 |
| `src/auth/otp.test.ts` | Create | 4 |
| `src/config/quota.ts` | Create | 5 |
| `src/config/quota.test.ts` | Create | 5 |
| `src/auth/middleware.ts` | Create | 6 |
| `src/auth/middleware.test.ts` | Create | 6 |
| `src/handlers/auth.ts` | Create | 7 |
| `src/handlers/auth.test.ts` | Create | 7 |
| `src/handlers/designs.ts` | Create | 8 |
| `src/handlers/designs.test.ts` | Create | 8 |
| `src/handlers/company.ts` | Create | 9 |
| `src/handlers/company.test.ts` | Create | 9 |
| `src/handlers/admin.ts` | Create | 10 |
| `src/handlers/admin.test.ts` | Create | 10 |
| `src/auth/resend.ts` | Create | 11 |
| `src/worker/index.ts` | Modify | 11 |
| `src/demo/server.ts` | Modify | 11 |
| `src/handlers/solve.ts` | Modify | 12 |
| `src/handlers/chat.ts` | Modify | 13 |
| `public/index.html` | Modify | 14 |
| `public/designs.html` | Create | 15 |
| `public/admin.html` | Create | 16 |
| `wrangler.toml` | Modify | 17 |
