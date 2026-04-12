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
