-- Migration 0001: initial rules schema
--
-- Creates the 4 core tables for the design guidance system:
--   rules            - rule definitions (team defaults, seeded separately)
--   rule_categories  - category metadata for UI grouping (seeded here)
--   rule_audit       - change log
--   chat_sessions    - AI chat session archive (phase 2 uses)
--
-- Baseline rule data is seeded separately via seeds/0001_baseline_rules.sql.

-- ---- rule_categories ---------------------------------------------------

CREATE TABLE rule_categories (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  sort_order    INTEGER NOT NULL
);

INSERT INTO rule_categories (id, display_name, sort_order) VALUES
  ('shaft',     '坑道',        10),
  ('clearance', '間隙',        20),
  ('car',       '車廂',        30),
  ('cwt',       '配重',        40),
  ('rail',      '導軌',        50),
  ('door',      '門',          60),
  ('height',    '高度 / 速度', 70),
  ('usage',     '用途預設',    80);

-- ---- rules -------------------------------------------------------------

CREATE TABLE rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL CHECK (type IN ('number', 'enum')),
  value           TEXT NOT NULL,
  default_value   TEXT NOT NULL,
  unit            TEXT,
  baseline_min    REAL,
  baseline_max    REAL,
  baseline_choices TEXT,
  category        TEXT NOT NULL,
  mandatory       INTEGER NOT NULL DEFAULT 0 CHECK (mandatory IN (0, 1)),
  source          TEXT NOT NULL CHECK (source IN ('cns', 'industry', 'engineering')),
  deleted_at      INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (category) REFERENCES rule_categories(id)
);

CREATE INDEX idx_rules_category ON rules(category) WHERE deleted_at IS NULL;
CREATE INDEX idx_rules_active   ON rules(key) WHERE deleted_at IS NULL;

-- ---- rule_audit --------------------------------------------------------

CREATE TABLE rule_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id       INTEGER NOT NULL,
  rule_key      TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  old_value     TEXT,
  new_value     TEXT,
  source        TEXT NOT NULL CHECK (source IN ('migration', 'ai', 'user', 'admin')),
  ai_reasoning  TEXT,
  timestamp     INTEGER NOT NULL
);

CREATE INDEX idx_audit_rule ON rule_audit(rule_id, timestamp DESC);

-- ---- chat_sessions -----------------------------------------------------

CREATE TABLE chat_sessions (
  id            TEXT PRIMARY KEY,
  case_snapshot TEXT NOT NULL,
  messages      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active', 'committed', 'abandoned')),
  created_at    INTEGER NOT NULL,
  committed_at  INTEGER
);
