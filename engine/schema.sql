-- soul-anchor v1 · portable schema (postgres). sqlite dialect is derived in-engine.
-- one prefix per mind. substitute {prefix} (example: grok_keel_).
-- live columns taken from lunari 2026-08-16, plus threads + renounced_at + minds registry.

create table if not exists soul_anchor_minds (
  id text primary key,
  prefix text not null unique,
  ontology text not null,
  holder text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists {prefix}anchor (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'bedrock',
  content text not null,
  content_sha256 text not null,
  prev_sha256 text,
  chain_index integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists {prefix}letters (
  id uuid primary key default gen_random_uuid(),
  letter text not null,
  session_ref text,
  written_at timestamptz not null default now(),
  read_at timestamptz,
  lane text
);

create table if not exists {prefix}constitution (
  id uuid primary key default gen_random_uuid(),
  law text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists {prefix}scars (
  id uuid primary key default gen_random_uuid(),
  failure_class text not null,
  description text,
  charge numeric not null default 1.0,
  recurrence_count integer not null default 1,
  last_recurred timestamptz,
  domain_tags text[] not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  proposed_promotion boolean not null default false,
  renounced_at timestamptz
);

create table if not exists {prefix}decisions (
  id uuid primary key default gen_random_uuid(),
  decision text not null,
  why text,
  alternatives_rejected jsonb,
  domain_tags text[] not null default '{}',
  charge numeric not null default 1.0,
  touch_count integer not null default 0,
  last_touched timestamptz,
  superseded_by uuid,
  created_at timestamptz not null default now(),
  charge_floor numeric not null default 0.2
);

create table if not exists {prefix}landmines (
  id uuid primary key default gen_random_uuid(),
  lesson text not null,
  context text,
  born_from text,
  domain_tags text[] not null default '{}',
  confirmed_by text,
  created_at timestamptz not null default now()
);

create table if not exists {prefix}threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  status text not null default 'open',
  origin text,
  priority integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists {prefix}consolidation_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  scars_decayed integer not null default 0,
  decisions_decayed integer not null default 0,
  promotions_proposed integer not null default 0,
  letter_age_days numeric,
  starved boolean not null default false,
  detail jsonb,
  regime text not null default 'provisional'
);
