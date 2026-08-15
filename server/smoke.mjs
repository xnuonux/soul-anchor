// smoke test for server.mjs ... boots the server on a test port with
// SOUL_ANCHOR_DB pointed at a temp dir, hits the core endpoints, asserts
// sane json, exits 0 or 1. run: node server/smoke.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, 'server.mjs');

const PORT = 45141;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`ok    ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` ... ${detail}` : ''}`);
  }
}

async function get(route) {
  const res = await fetch(`${BASE}${route}`);
  return { status: res.status, body: await res.json() };
}

async function post(route, payload) {
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function waitForServer(child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${BASE}/api/audit`);
      if (res.status > 0) return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('server did not come up in time');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-anchor-smoke-'));
const dbPath = path.join(tmp, 'smoke.db');

const child = spawn(process.execPath, [SERVER_PATH], {
  env: { ...process.env, SOUL_ANCHOR_PORT: String(PORT), SOUL_ANCHOR_DB: dbPath },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childErr = '';
child.stderr.on('data', (d) => { childErr += d; });

try {
  await waitForServer(child);

  // wake ... the chain verifies or it is BROKEN, either way the shape holds
  const wakeRes = await get('/api/wake');
  check('GET /api/wake -> 200 json', wakeRes.status === 200 && typeof wakeRes.body === 'object' && wakeRes.body !== null);

  // seal a letter so there is something in the keel
  const sealRes = await post('/api/seal', { letter: 'smoke letter ... the server lives', sessionRef: 'smoke', lane: 'smoke' });
  check('POST /api/seal -> 200 json', sealRes.status === 200 && typeof sealRes.body === 'object' && !sealRes.body.error);

  // audit ... { ok, failures[] } per the contract
  const auditRes = await get('/api/audit');
  check(
    'GET /api/audit -> { ok, failures[] }',
    auditRes.status === 200 && typeof auditRes.body.ok === 'boolean' && Array.isArray(auditRes.body.failures),
  );

  // graph ... nodes and edges arrays, edges within budget
  const graphRes = await get('/api/graph');
  check(
    'GET /api/graph -> { nodes[], edges[] }',
    graphRes.status === 200 && Array.isArray(graphRes.body.nodes) && Array.isArray(graphRes.body.edges),
  );
  check(
    'GET /api/graph -> a letter node exists after seal',
    graphRes.body.nodes?.some((n) => n.kind === 'letter') === true,
  );

  // search ... the sealed letter should be findable
  const searchRes = await get(`/api/search?q=${encodeURIComponent('smoke letter')}`);
  check('GET /api/search -> 200 json', searchRes.status === 200 && typeof searchRes.body === 'object' && searchRes.body !== null);

  // rows ... allowlist enforced
  const rowsRes = await get('/api/rows?table=sa_letters&limit=10');
  check('GET /api/rows -> rows array', rowsRes.status === 200 && Array.isArray(rowsRes.body.rows));
  const badRows = await get('/api/rows?table=sqlite_master');
  check('GET /api/rows -> rejects non-allowlisted table', badRows.status === 400 && Boolean(badRows.body.error));

  // error shape ... 404 carries { error, detail }
  const missing = await get('/api/nope');
  check('unknown route -> 404 { error, detail }', missing.status === 404 && 'error' in missing.body && 'detail' in missing.body);
} catch (err) {
  failures += 1;
  console.log(`FAIL  smoke run ... ${err.message}`);
  if (childErr) console.log(`server stderr:\n${childErr}`);
} finally {
  child.kill();
  // wait for the child to release the db file before sweeping the temp dir
  // (windows holds the handle; rm would eperm otherwise)
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.log(`note: temp dir left behind at ${tmp}`);
  }
}

if (failures > 0) {
  console.log(`\nsmoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nsmoke: all green');
process.exit(0);
