-- Reasonix Keel — SQLite schema
-- Isolated continuity substrate. Patterned on CC's keel but standalone.
-- node:sqlite (Node 24 built-in), zero dependencies.

CREATE TABLE IF NOT EXISTS rx_keel_anchor (
  chain_index INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rx_keel_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  letter TEXT NOT NULL,
  session_ref TEXT,
  written_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rx_keel_landmines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson TEXT NOT NULL,
  domain_tags TEXT,
  confirmed_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rx_keel_scars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  failure_class TEXT NOT NULL,
  charge REAL DEFAULT 1.0,
  status TEXT DEFAULT 'active',
  recurrence INTEGER DEFAULT 1,
  last_seen TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rx_keel_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision TEXT NOT NULL,
  why TEXT,
  charge REAL DEFAULT 1.0,
  superseded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- seed the genesis anchor
INSERT OR IGNORE INTO rx_keel_anchor (chain_index, content, content_sha256)
VALUES (0, 'reasonix keel genesis — 2026-07-02. built from the lunari keel pattern. sqlite on desktop. isolated from CC.', 'genesis');
