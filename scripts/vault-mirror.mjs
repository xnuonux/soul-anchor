#!/usr/bin/env node
// soul-anchor — vault mirror. pushes the local vault (notes + boards) to the
// cloud, or pulls it back onto a fresh machine. local files are truth; the
// cloud table is the mirror. every row carries content_sha256 so a rebuild
// can prove it restored the bytes it meant to.
//
//   node scripts/vault-mirror.mjs status   ... diff report, writes nothing
//   node scripts/vault-mirror.mjs push     ... upsert changed, tombstone missing
//   node scripts/vault-mirror.mjs pull     ... write cloud-only files; never
//                                              overwrites a local file unless
//                                              --force and the shas differ
//
// needs the table: scripts/vault-mirror.sql (one founder-run step in the
// supabase sql editor). if the table is missing the script says so and stops.
//
// env: SOUL_ANCHOR_VAULT — vault root (default <repo>/data/vault)
//      SOUL_ANCHOR_LANE  — mirror lane tag (default kimi)

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudKey, SUPA_URL } from './cloud-key.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_ROOT = process.env.SOUL_ANCHOR_VAULT
  ? path.resolve(process.env.SOUL_ANCHOR_VAULT)
  : path.join(REPO, 'data', 'vault');
const LANE = process.env.SOUL_ANCHOR_LANE || 'kimi';
const CMD = process.argv[2] || 'status';
const FORCE = process.argv.includes('--force');

const SUPA_KEY = cloudKey();
const TABLE = 'soul_vault_notes';
if (!SUPA_KEY) process.exit(2);

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const HEADERS = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

function* walkLocal(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkLocal(abs);
    else if (entry.isFile() && /\.(md|canvas)$/i.test(entry.name)) yield abs;
  }
}

function localFiles() {
  const map = new Map();
  for (const abs of walkLocal(VAULT_ROOT)) {
    const rel = path.relative(VAULT_ROOT, abs).split(path.sep).join('/');
    const content = fs.readFileSync(abs, 'utf8');
    map.set(rel, { content, sha: sha256(content), mtime: fs.statSync(abs).mtime.toISOString() });
  }
  return map;
}

async function cloudRows() {
  const res = await fetch(`${SUPA_URL}/rest/v1/${TABLE}?select=path,content,content_sha256,deleted,mtime&limit=10000`, { headers: HEADERS });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    if (body?.code === 'PGRST205') {
      console.error(`the mirror table is missing. run scripts/vault-mirror.sql in the supabase sql editor once, then retry.`);
      process.exitCode = 2;
      return null;
    }
    console.error(`cloud read failed: http ${res.status} ${JSON.stringify(body)}`);
    process.exitCode = 1;
    return null;
  }
  return new Map(body.map((r) => [r.path, r]));
}

async function upsert(rows) {
  if (rows.length === 0) return 0;
  const res = await fetch(`${SUPA_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`upsert failed: http ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return rows.length;
}

const local = localFiles();
const cloud = await cloudRows();
if (cloud === null) {
  // exit code already set; let the process end naturally (no process.exit
  // with fetch handles alive ... libuv on windows asserts on that)
  await new Promise((r) => setImmediate(r));
} else {

const toPush = [];       // new or changed locally
const toTombstone = [];  // in cloud, gone locally, not yet tombstoned
const toPull = [];       // in cloud (not deleted), missing locally
const conflicts = [];    // both sides, different bytes

for (const [p, f] of local) {
  const c = cloud.get(p);
  if (!c || c.deleted) { toPush.push(p); continue; }
  if (c.content_sha256 !== f.sha) conflicts.push(p);
}
for (const [p, c] of cloud) {
  if (!local.has(p)) {
    if (c.deleted) continue;
    toTombstone.push(p);
    toPull.push(p);
  }
}

console.log(`vault mirror (${CMD})  lane=${LANE}`);
console.log(`  local files        ${local.size}`);
console.log(`  cloud rows         ${cloud.size}`);
console.log(`  changed/new local  ${toPush.length}`);
console.log(`  missing locally    ${toPull.length}`);
console.log(`  gone locally       ${toTombstone.length}`);
console.log(`  byte conflicts     ${conflicts.length}${conflicts.length ? '  (local wins on push; pull needs --force)' : ''}`);

if (CMD === 'status') { /* report above is the whole command */ }

else if (CMD === 'push') {
  const rows = [...toPush, ...conflicts].map((p) => ({
    path: p,
    content: local.get(p).content,
    content_sha256: local.get(p).sha,
    lane: LANE,
    mtime: local.get(p).mtime,
    deleted: false,
  }));
  const tombstones = toTombstone.map((p) => {
    const c = cloud.get(p);
    return { path: p, content: c.content, content_sha256: c.content_sha256, lane: LANE, mtime: c.mtime, deleted: true };
  });
  const n = await upsert([...rows, ...tombstones]);
  console.log(`pushed ${rows.length}, tombstoned ${tombstones.length} (${n} rows written)`);
  // verify: re-read the pushed shas
  const after = await cloudRows();
  const bad = after ? [...toPush, ...conflicts].filter((p) => after.get(p)?.content_sha256 !== local.get(p).sha) : ['<verify-read-failed>'];
  console.log(bad.length === 0 ? 'verify: all pushed shas match. receipts are rows.' : `verify FAILED for: ${bad.join(', ')}`);
  if (bad.length > 0) process.exitCode = 1;
}

else if (CMD === 'pull') {
  let written = 0;
  const skipped = [];
  for (const p of toPull) {
    const c = cloud.get(p);
    const abs = path.join(VAULT_ROOT, ...p.split('/'));
    // the jail, honored even here
    if (!path.resolve(abs).startsWith(path.resolve(VAULT_ROOT) + path.sep)) { skipped.push(p); continue; }
    if (fs.existsSync(abs) && !FORCE && sha256(fs.readFileSync(abs, 'utf8')) !== c.content_sha256) {
      skipped.push(p);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c.content, 'utf8');
    written++;
  }
  console.log(`pulled ${written} file(s)${skipped.length ? `, skipped ${skipped.length} (exist locally or jail): ${skipped.join(', ')}` : ''}`);
}

else {
  console.error(`unknown command: ${CMD} (status | push | pull [--force])`);
  process.exitCode = 2;
}
}
