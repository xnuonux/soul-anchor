#!/usr/bin/env node
// soul-anchor — cloud-keel migration. pulls the live lunari supabase keels into the
// local sqlite keel (schema v2). READ-ONLY on the cloud side; never writes to supabase.
//
//   node scripts/migrate-supabase.mjs [--dry-run]
//
// env: SOUL_ANCHOR_DB — target sqlite path (default <repo>/data/soul-anchor.db)
// idempotent: provenance in sa_imports, unique(source, source_row_id, table_name).

import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudKey, SUPA_URL } from './cloud-key.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.SOUL_ANCHOR_DB || path.join(REPO, 'data', 'soul-anchor.db');
const SCHEMA_PATH = path.join(REPO, 'engine', 'schema.sql');
const DRY_RUN = process.argv.includes('--dry-run');

const SUPA_KEY = cloudKey();
if (!SUPA_KEY) process.exit(2);
const PAGE = 1000;

// ---------- helpers ----------

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const newId = () => randomBytes(16).toString('hex');
const jsonArr = (v) => (v == null ? '[]' : typeof v === 'string' ? v : JSON.stringify(v));
const num = (v, d) => (v == null || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v) => (v ? 1 : 0);

async function fetchTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    const body = await res.json().catch(() => ({ error: `non-json response, http ${res.status}` }));
    if (!res.ok || !Array.isArray(body)) {
      console.log(`  !! ${table}: REST returned non-array (http ${res.status}), aborting this source:`);
      console.log(`     ${JSON.stringify(body)}`);
      return null;
    }
    rows.push(...body);
    if (body.length < PAGE) return rows;
  }
}

// ---------- db ----------

let db = null;
if (DRY_RUN && !fs.existsSync(DB_PATH)) {
  console.log(`[dry-run] ${DB_PATH} does not exist yet; treating every row as would-import.\n`);
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH, DRY_RUN ? { readOnly: true } : {});
  if (!DRY_RUN) db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

const qImported = db?.prepare(
  'select local_id from sa_imports where source = ? and source_row_id = ? and table_name = ?'
);
const qRecord = db?.prepare(
  'insert or ignore into sa_imports (id, source, source_row_id, table_name, local_id) values (?, ?, ?, ?, ?)'
);

const importedBefore = (source, rowId, table) =>
  db ? qImported.get(source, String(rowId), table)?.local_id ?? null : null;

function record(source, rowId, table, localId) {
  if (db && !DRY_RUN) qRecord.run(newId(), source, String(rowId), table, String(localId));
}

const stats = () => ({ found: 0, imported: 0, skipped: 0, failed: 0 });

function report(name, s, note = '') {
  console.log(
    `${name.padEnd(38)} found=${String(s.found).padEnd(4)} imported=${String(s.imported).padEnd(4)} skipped=${String(s.skipped).padEnd(4)} failed=${s.failed}${note ? '  ' + note : ''}`
  );
}

// ---------- source migrations ----------

// keel_anchor / perseus_keel_anchor -> sa_anchor. never overwrite an occupied chain_index.
function migrateAnchor(source, rows, lane) {
  const s = stats();
  const qAtIndex = db?.prepare('select id from sa_anchor where chain_index = ?');
  const qInsert = db?.prepare(
    'insert into sa_anchor (id, chain_index, kind, content, content_sha256, prev_sha256, active, lane, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  rows.sort((a, b) => (a.chain_index ?? 0) - (b.chain_index ?? 0));
  for (const row of rows) {
    s.found++;
    try {
      if (importedBefore(source, row.id, 'sa_anchor')) { s.skipped++; continue; }
      const existing = db ? qAtIndex.get(row.chain_index) : null;
      if (existing) {
        // chain slot occupied locally: provenance only, never overwrite
        record(source, row.id, 'sa_anchor', existing.id);
        s.skipped++;
        continue;
      }
      const id = newId();
      if (!DRY_RUN) {
        qInsert.run(id, row.chain_index, row.kind ?? 'seal', row.content, row.content_sha256,
          row.prev_sha256 ?? null, bool(row.active ?? true), lane, row.created_at);
      }
      record(source, row.id, 'sa_anchor', id);
      s.imported++;
    } catch (e) { s.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }
  return s;
}

function migrateLetters(source, rows, lane) {
  const s = stats();
  const qInsert = db?.prepare(
    'insert into sa_letters (id, letter, session_ref, lane, written_at, read_at) values (?, ?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    s.found++;
    try {
      if (importedBefore(source, row.id, 'sa_letters')) { s.skipped++; continue; }
      const id = newId();
      if (!DRY_RUN) qInsert.run(id, row.letter, row.session_ref ?? null, lane, row.written_at, row.read_at ?? null);
      record(source, row.id, 'sa_letters', id);
      s.imported++;
    } catch (e) { s.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }
  return s;
}

function migrateScars(source, rows, lane) {
  const s = stats();
  const qInsert = db?.prepare(
    `insert into sa_scars (id, failure_class, description, domain_tags, charge, charge_floor, status,
       verification, method, recurrence, proposed_promotion, lane, last_seen, created_at)
     values (?, ?, ?, ?, ?, ?, ?, 'unverified', null, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    s.found++;
    try {
      if (importedBefore(source, row.id, 'sa_scars')) { s.skipped++; continue; }
      const id = newId();
      // cloud rows carry no proof of verification, so epistemics start at 'unverified'
      if (!DRY_RUN) {
        qInsert.run(id, row.failure_class, row.description ?? null, jsonArr(row.domain_tags),
          num(row.charge, 1.0), num(row.charge_floor, 0.2), row.status ?? 'active',
          row.recurrence_count ?? 1, bool(row.proposed_promotion), lane,
          row.last_recurred ?? row.created_at, row.created_at);
      }
      record(source, row.id, 'sa_scars', id);
      s.imported++;
    } catch (e) { s.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }
  return s;
}

function migrateLandmines(source, rows, lane) {
  const s = stats();
  const qInsert = db?.prepare(
    `insert into sa_landmines (id, lesson, context, born_from, domain_tags, charge, verification, method,
       confirmed_by, lane, last_seen, created_at)
     values (?, ?, ?, ?, ?, 1.0, 'unverified', null, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    s.found++;
    try {
      if (importedBefore(source, row.id, 'sa_landmines')) { s.skipped++; continue; }
      const id = newId();
      if (!DRY_RUN) {
        qInsert.run(id, row.lesson, row.context ?? null, row.born_from ?? null, jsonArr(row.domain_tags),
          row.confirmed_by ?? null, lane, row.created_at, row.created_at);
      }
      record(source, row.id, 'sa_landmines', id);
      s.imported++;
    } catch (e) { s.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }
  return s;
}

// two passes: insert all, then remap superseded_by (source uuid -> local id via sa_imports).
function migrateDecisions(source, rows, lane) {
  const s = stats();
  const qInsert = db?.prepare(
    `insert into sa_decisions (id, decision, why, alternatives_rejected, domain_tags, charge,
       touch_count, last_touched, superseded_by, lane, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)`
  );
  const localByRowId = new Map();
  for (const row of rows) {
    s.found++;
    try {
      const prior = importedBefore(source, row.id, 'sa_decisions');
      if (prior) { localByRowId.set(row.id, prior); s.skipped++; continue; }
      const id = newId();
      if (!DRY_RUN) {
        qInsert.run(id, row.decision, row.why ?? null,
          row.alternatives_rejected == null ? null : JSON.stringify(row.alternatives_rejected),
          jsonArr(row.domain_tags), num(row.charge, 1.0), row.touch_count ?? 0,
          row.last_touched ?? null, lane, row.created_at);
      }
      record(source, row.id, 'sa_decisions', id);
      localByRowId.set(row.id, id);
      s.imported++;
    } catch (e) { s.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }
  // pass 2: superseded_by remap (runs on re-imports too, so interrupted first runs heal)
  let remapped = 0;
  if (!DRY_RUN) {
    const qFind = db.prepare(
      'select local_id from sa_imports where source = ? and source_row_id = ? and table_name = \'sa_decisions\''
    );
    const qUpd = db.prepare('update sa_decisions set superseded_by = ? where id = ? and (superseded_by is null or superseded_by != ?)');
    for (const row of rows) {
      if (!row.superseded_by) continue;
      const localId = localByRowId.get(row.id);
      const target = qFind.get(source, String(row.superseded_by))?.local_id;
      if (!localId || !target) continue;
      remapped += qUpd.run(target, localId, target).changes;
    }
  }
  if (remapped) console.log(`  .. ${source}: remapped ${remapped} superseded_by link(s)`);
  return s;
}

// sa_constitution position is the PK: skip positions already present, provenance either way.
function migrateConstitution(source, rows, laneIgnored) {
  const s = stats();
  const qAtPos = db?.prepare('select position from sa_constitution where position = ?');
  const qInsert = db?.prepare(
    'insert into sa_constitution (position, law, locked, created_at) values (?, ?, 1, ?)'
  );
  for (const row of rows) {
    s.found++;
    try {
      if (importedBefore(source, row.id, 'sa_constitution')) { s.skipped++; continue; }
      if (db && qAtPos.get(row.position)) {
        record(source, row.id, 'sa_constitution', row.position);
        s.skipped++;
        continue;
      }
      if (!DRY_RUN) qInsert.run(row.position, row.law, row.created_at);
      record(source, row.id, 'sa_constitution', row.position);
      s.imported++;
    } catch (e) { s.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }
  return s;
}

// kimi_keel single-table dialect: letters -> sa_letters, anchors -> appended after the
// local chain head (recomputed content_sha256, prev_sha256 linked into the local chain,
// original source sha preserved as sa_imports.source_row_id).
function migrateKimiKeel(source, rows) {
  const s = { letters: stats(), anchors: stats(), other: 0 };
  const qLetter = db?.prepare(
    'insert into sa_letters (id, letter, session_ref, lane, written_at, read_at) values (?, ?, ?, ?, ?, null)'
  );
  const qAnchor = db?.prepare(
    'insert into sa_anchor (id, chain_index, kind, content, content_sha256, prev_sha256, active, lane, created_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?)'
  );
  const head = db?.prepare('select chain_index, content_sha256 from sa_anchor order by chain_index desc limit 1').get();
  let nextIndex = head ? head.chain_index + 1 : 0;
  let prevSha = head ? head.content_sha256 : null;

  const anchors = rows.filter((r) => r.kind === 'anchor').sort((a, b) => (a.chain_index ?? 0) - (b.chain_index ?? 0));

  for (const row of rows) {
    if (row.kind !== 'letter') continue;
    s.letters.found++;
    try {
      if (importedBefore(source, row.id, 'sa_letters')) { s.letters.skipped++; continue; }
      const id = newId();
      if (!DRY_RUN) qLetter.run(id, row.content, row.title ?? null, 'kimi-k3', row.sealed_at);
      record(source, row.id, 'sa_letters', id);
      s.letters.imported++;
    } catch (e) { s.letters.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }

  for (const row of anchors) {
    s.anchors.found++;
    const rowId = row.sha256 ?? String(row.id); // original source sha is the provenance key
    try {
      if (importedBefore(source, rowId, 'sa_anchor')) { s.anchors.skipped++; continue; }
      const id = newId();
      const contentSha = sha256(row.content); // local linking rule: recomputed locally
      if (!DRY_RUN) qAnchor.run(id, nextIndex, 'import-kimi', row.content, contentSha, prevSha, 'kimi-k3', row.sealed_at);
      record(source, rowId, 'sa_anchor', id);
      prevSha = contentSha;
      nextIndex++;
      s.anchors.imported++;
    } catch (e) { s.anchors.failed++; console.log(`  !! ${source} row ${row.id}: ${e.message}`); }
  }

  s.other = rows.length - s.letters.found - s.anchors.found;
  return s;
}

// ---------- main ----------

const LANE_CC = 'claude-code';
const LANE_PERSEUS = 'perseus';

async function runSource(label, table, migrate) {
  const rows = await fetchTable(table);
  if (rows === null) {
    console.log(`${label.padEnd(38)} ABORTED (see above)`);
    return;
  }
  const s = migrate(`supabase:public.${table}`, rows);
  report(label, s);
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}migrating cloud keels -> ${DB_PATH}\n`);

// 1-6. public.keel_* (lane claude-code)
await runSource('keel_anchor -> sa_anchor', 'keel_anchor', (src, r) => migrateAnchor(src, r, LANE_CC));
await runSource('keel_letters -> sa_letters', 'keel_letters', (src, r) => migrateLetters(src, r, LANE_CC));
await runSource('keel_scars -> sa_scars', 'keel_scars', (src, r) => migrateScars(src, r, LANE_CC));
await runSource('keel_landmines -> sa_landmines', 'keel_landmines', (src, r) => migrateLandmines(src, r, LANE_CC));
await runSource('keel_decisions -> sa_decisions', 'keel_decisions', (src, r) => migrateDecisions(src, r, LANE_CC));
await runSource('keel_constitution -> sa_constitution', 'keel_constitution', migrateConstitution);

// 7. public.kimi_keel (lane kimi-k3)
{
  const rows = await fetchTable('kimi_keel');
  if (rows === null) {
    console.log('kimi_keel -> sa_letters/sa_anchor        ABORTED (see above)');
  } else {
    const s = migrateKimiKeel('supabase:public.kimi_keel', rows);
    report('kimi_keel(letter) -> sa_letters', s.letters);
    report('kimi_keel(anchor) -> sa_anchor', s.anchors, s.other ? `(${s.other} row(s) of other kinds ignored)` : '');
  }
}

// 8. public.perseus_keel_* (lane perseus). perseus_keel_consolidation_runs has no v2
// target in the migration brief and holds 0 rows; not migrated.
await runSource('perseus_keel_anchor -> sa_anchor', 'perseus_keel_anchor', (src, r) => migrateAnchor(src, r, LANE_PERSEUS));
await runSource('perseus_keel_letters -> sa_letters', 'perseus_keel_letters', (src, r) => migrateLetters(src, r, LANE_PERSEUS));
await runSource('perseus_keel_scars -> sa_scars', 'perseus_keel_scars', (src, r) => migrateScars(src, r, LANE_PERSEUS));
await runSource('perseus_keel_landmines -> sa_landmines', 'perseus_keel_landmines', (src, r) => migrateLandmines(src, r, LANE_PERSEUS));
await runSource('perseus_keel_decisions -> sa_decisions', 'perseus_keel_decisions', (src, r) => migrateDecisions(src, r, LANE_PERSEUS));
await runSource('perseus_keel_constitution -> sa_constitution', 'perseus_keel_constitution', migrateConstitution);

// ---------- verification block ----------

console.log('\n--- verification ---');
if (!db) {
  console.log('no local db (dry-run against a not-yet-created db); nothing to count.');
} else {
  const count = (t) => db.prepare(`select count(*) as n from ${t}`).get().n;
  for (const t of ['sa_anchor', 'sa_letters', 'sa_scars', 'sa_landmines', 'sa_decisions', 'sa_constitution', 'sa_consolidation_runs', 'sa_imports']) {
    console.log(`${t.padEnd(24)} ${count(t)}`);
  }
  const chain = db.prepare('select count(*) as n, max(chain_index) as top from sa_anchor').get();
  console.log(`anchor chain length      ${chain.n} (max chain_index ${chain.top ?? 'n/a'})`);
  if (DRY_RUN) console.log('(dry-run: counts are the pre-existing db state; nothing was written)');
}
db?.close();
