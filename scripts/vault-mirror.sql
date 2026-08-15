-- soul-anchor vault mirror ... run ONCE in the supabase sql editor on project
-- fpposmirumtbocqtxued, then scripts/vault-mirror.mjs can push and pull.
-- the local vault is the source of truth; this table is the disaster-recovery
-- mirror. same law as the keel mirror: local rows are truth, the cloud holds
-- a copy for rebuild.
--
-- receipts culture applies here too: content_sha256 lets any rebuild prove
-- the file it restored is the file that was mirrored.

create table if not exists public.soul_vault_notes (
  path text primary key,            -- vault-relative, forward slashes: 'daily/2026-08-15.md' or 'maps/eternities.canvas'
  content text not null,
  content_sha256 text not null,
  lane text not null default 'kimi',
  mtime timestamptz,                -- last local mtime at push time
  deleted boolean not null default false,  -- tombstone: deleted locally, kept for audit
  mirrored_at timestamptz not null default now()
);

create index if not exists soul_vault_notes_sha on public.soul_vault_notes (content_sha256);
