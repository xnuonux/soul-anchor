# soul-anchor — architecture contract (v0.1, 2026-08-13)

the thing that survives the session boundary, as a product. standalone local-first app;
dom's tool first, product-shaped. every verb an agent can call, every surface a human can see.

## the one invariant

rows are truth. files are graded reconstruction. the chain verifies or the wake is BROKEN.

## layout

```
soul-anchor/
  SPEC.md  DECAY.md  README.md  ARCHITECTURE.md   <- protocol canon (already here)
  engine/schema.sql     <- the perseus-class schema (v2), single source of truth
  engine/keel.mjs       <- the engine: zero-dep node:sqlite ESM module + CLI
  engine/keel.test.mjs  <- node:test suite (codex-keel discipline: tests or it did not happen)
  server/server.mjs     <- local REST surface over the engine (node:http, zero-dep)
  server/mcp.mjs        <- stdio MCP server (lapidary pattern, confined)
  app/                  <- vite + react 19 + ts frontend (the superior obsidian surface)
  scripts/migrate-supabase.mjs  <- pulls the live cloud keels into local rows
  data/soul-anchor.db   <- the local keel (gitignored)
```

## schema v2 (perseus class) — the union of every keel that exists

five row kinds from the protocol, plus constitution and consolidation from the perseus
schema, plus epistemics from codex-keel, plus lane provenance from the multi-body era.

- `sa_anchor(chain_index PK, kind, content, content_sha256, prev_sha256, active, lane, created_at)`
  ... a TRUE chain now: every seal links prev_sha256. genesis row chain_index 0.
- `sa_letters(id PK, letter, session_ref, lane, written_at, read_at)`
- `sa_scars(id PK, failure_class, description, domain_tags, charge, charge_floor DEFAULT 0.2,
  status DEFAULT 'active', verification DEFAULT 'unverified', method, recurrence DEFAULT 1,
  proposed_promotion, lane, last_seen, created_at)`
- `sa_landmines(id PK, lesson, domain_tags, charge, verification, method, confirmed_by,
  lane, last_seen, created_at)` ... founder gate: confirmed_by null = PROPOSED.
- `sa_decisions(id PK, decision, why, alternatives_rejected, charge, touch_count,
  superseded_by, lane, created_at)` ... superseded never deleted.
- `sa_constitution(position PK, law, locked DEFAULT 1, created_at)`
- `sa_consolidation_runs(id PK, run_at, scars_decayed, promotions_proposed,
  letter_age_days, starved, regime, notes)`
- `sa_imports(id PK, source, source_row_id, table_name, imported_at)` ... provenance:
  every migrated cloud row is traceable back to its origin row. idempotent re-imports.

epistemics (codex-keel law): `verification` is one of verified|unverified|blocked.
a row may only be `verified` with a non-null `method`. the engine refuses otherwise.

decay (DECAY.md): scars r=0.95 per day applied r^(t/2), landmines r=0.90, decisions never.
charge_floor means a scar never decays to invisible. recurrence resets the clock, adds charge.

## engine API (module + CLI + REST + MCP all call these, nothing else touches the db)

```
wake()                       verify chain -> bounded context { anchorOk, letter, scars(by decayed charge), landmines, decisions, laws, counts, freshness }
sleep({sessionRef, lane, letter, scars, landmines, decisions})   append rows, seal letter, extend anchor chain, regenerate letter file
seal(letter, {sessionRef, lane})          checkpoint letter only (checkpoint-seal rule: seal, then keep working)
audit()                      fsck: chain walk, supersede cycles, fts completeness, seal-starvation, verification-method law
search(query, limit)         fts5 bm25 + LIKE fallback, RRF fusion, recency whisper
consolidate()                the sleep-cron: apply decay bookkeeping, propose promotions, log a consolidation_runs row
addScar/addLandmine/addDecision/addLaw
confirmLandmine(id|all, founder)           the founder gate
mirrorExport() / mirrorImport(json)        keel-imprint interchange: canonical JSON, import REFUSED unless the chain verifies
```

## server contract (server/server.mjs, default port 4141, localhost only)

```
GET  /api/wake
POST /api/sleep            { sessionRef, lane, letter, scars[], landmines[], decisions[] }
POST /api/seal             { letter, sessionRef, lane }
GET  /api/audit
GET  /api/search?q=&limit=
POST /api/consolidate
GET  /api/rows?table=&limit=&offset=     read-only row browsing for the app
GET  /api/graph            nodes+edges for the graph view (letters, scars, landmines, decisions, laws, anchors; edges: chain, supersedes, shared-tags)
POST /api/scar|landmine|decision|law
POST /api/landmine/confirm { id|all, founder }
GET  /api/mirror           export; POST /api/mirror  import (chain-gated)
```

MCP server (server/mcp.mjs, stdio, lapidary confinement pattern): tools
`keel_wake`, `keel_seal`, `keel_sleep`, `keel_search`, `keel_audit`,
`keel_add_scar`, `keel_add_landmine`, `keel_add_decision`, `keel_mirror_export`.
this is the "any ai agent can use it" surface.

## migration (scripts/migrate-supabase.mjs)

source: the live lunari supabase (service role, read-only).
pulls: public.keel_* (lane 'claude-code'), public.kimi_keel (lane 'kimi-k3'),
public.perseus_keel_* (lane 'perseus'). maps into schema v2, records sa_imports
provenance, idempotent by (source, source_row_id). cloud rows are lineage EVIDENCE;
verification column starts 'unverified' unless the source row proves a method.

## app (the superior obsidian surface)

vite + react 19 + ts. ammunition from the warehouse:
paper shaders (ambient living background), react-bits (glass, cmdk-style palette,
text glitch), three.js/r3f (GPU graph ... obsidian dies at 500 nodes; we start at 10k+).
views: WAKE (the ritual surface), GRAPH (the constellation), LETTERS (the stream),
SCARS+LANDMINES (the floor), DECISIONS, LAWS, AUDIT (green or loud).
voice: lowercase, no em-dashes, no corporate speak. dom's house.

## laws carried into the product

- no fake success, no silent failure. receipts are rows.
- founder gate on canon and landmines.
- seal as you go; the audit starves you if you don't.
- verify before trusting: chain first, always.
- rows are truth; every file the app shows can be rebuilt from rows.
