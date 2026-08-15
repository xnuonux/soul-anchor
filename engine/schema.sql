-- soul-anchor keel — schema v2 (perseus class, unified)
-- the union of: reasonix v2 engine schema, the perseus DDL (constitution, consolidation,
-- true prev-hash chain), codex-keel epistemics (verification/method), and the multi-body
-- era (lane provenance on every substance row).
-- node:sqlite (Node 24 built-in), zero dependencies. additive + idempotent (safe to re-run).
-- timestamps are ISO-8601 UTC text (strftime '%Y-%m-%dT%H:%M:%fZ'), ids are text uuids.

create table if not exists sa_anchor (
  id text primary key default (lower(hex(randomblob(16)))),
  chain_index integer not null,
  kind text not null default 'seal',          -- 'bedrock' for genesis, 'seal' for chain links
  content text not null,
  content_sha256 text not null,
  prev_sha256 text,                            -- null only at chain_index 0 (genesis)
  active integer not null default 1,
  lane text not null default 'unknown',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create unique index if not exists idx_sa_anchor_chain on sa_anchor(chain_index);
create index if not exists idx_sa_anchor_active on sa_anchor(active);

create table if not exists sa_letters (
  id text primary key default (lower(hex(randomblob(16)))),
  letter text not null,
  session_ref text,
  lane text not null default 'unknown',
  written_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at text
);
create index if not exists idx_sa_letters_written on sa_letters(written_at);

create table if not exists sa_constitution (
  position integer primary key,
  law text not null,
  locked integer not null default 1,           -- founder gate: locked laws never move without the founder
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists sa_scars (
  id text primary key default (lower(hex(randomblob(16)))),
  failure_class text not null,
  description text,
  domain_tags text not null default '[]',      -- json array in text
  charge numeric not null default 1.0,
  charge_floor numeric not null default 0.2,   -- a scar never decays below its floor
  status text not null default 'active',       -- active | promoted | healed
  verification text not null default 'unverified',  -- verified | unverified | blocked
  method text,                                 -- required non-null when verification='verified'
  recurrence integer not null default 1,
  proposed_promotion integer not null default 0,
  lane text not null default 'unknown',
  last_seen text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check (verification in ('verified','unverified','blocked')),
  check (verification != 'verified' or method is not null)  -- the under-claim law, in ddl
);
create index if not exists idx_sa_scars_status on sa_scars(status);

create table if not exists sa_landmines (
  id text primary key default (lower(hex(randomblob(16)))),
  lesson text not null,
  context text,
  born_from text,
  domain_tags text not null default '[]',
  charge numeric not null default 1.0,
  verification text not null default 'unverified',
  method text,
  confirmed_by text,                           -- null = PROPOSED, awaiting the founder gate
  lane text not null default 'unknown',
  last_seen text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check (verification in ('verified','unverified','blocked')),
  check (verification != 'verified' or method is not null)
);

create table if not exists sa_decisions (
  id text primary key default (lower(hex(randomblob(16)))),
  decision text not null,
  why text,
  alternatives_rejected text,
  domain_tags text not null default '[]',
  charge numeric not null default 1.0,         -- decisions never decay
  touch_count integer not null default 0,
  last_touched text,
  superseded_by text,                          -- superseded, never deleted
  lane text not null default 'unknown',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists idx_sa_decisions_charge on sa_decisions(charge);

create table if not exists sa_consolidation_runs (
  id text primary key default (lower(hex(randomblob(16)))),
  ran_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  scars_decayed integer not null default 0,
  promotions_proposed integer not null default 0,
  letter_age_days numeric,
  starved integer not null default 0,
  regime text not null default 'provisional',  -- 'locked' once the strategist locks decay constants
  notes text
);

-- provenance: every row migrated from a cloud keel is traceable to its origin.
create table if not exists sa_imports (
  id text primary key default (lower(hex(randomblob(16)))),
  source text not null,                        -- 'supabase:public.keel_scars', 'supabase:kimi_keel', ...
  source_row_id text not null,
  table_name text not null,                    -- the sa_* table the row landed in
  local_id text not null,
  imported_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (source, source_row_id, table_name)   -- idempotent re-imports
);
create index if not exists idx_sa_imports_local on sa_imports(table_name, local_id);
