// soul-anchor REST surface ... node:http, zero-dep, localhost only.
// every write goes through the engine API; the only direct db access here is
// read-only row browsing (/api/rows) and graph assembly (/api/graph).
// rows are truth. this file is a window, not a source.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  wake,
  sleep,
  seal,
  audit,
  search,
  consolidate,
  addScar,
  addLandmine,
  addDecision,
  addLaw,
  confirmLandmine,
  mirrorExport,
  mirrorImport,
} from '../engine/keel.mjs';

import {
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  vaultGraph,
  vaultSearch,
  listTemplates,
  createFromTemplate,
  dailyNote,
  listCanvases,
  readCanvas,
  writeCanvas,
  deleteCanvas,
} from '../engine/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const HOST = '127.0.0.1'; // local-first means local-only
const PORT = Number(process.env.SOUL_ANCHOR_PORT || 4141);
const DB_PATH = process.env.SOUL_ANCHOR_DB || path.join(REPO_ROOT, 'data', 'soul-anchor.db');

// the vite dev app is the only browser client we serve
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

// the row browser only ever sees these tables, never anything else
const ROW_TABLES = new Set([
  'sa_anchor',
  'sa_letters',
  'sa_constitution',
  'sa_scars',
  'sa_landmines',
  'sa_decisions',
  'sa_consolidation_runs',
  'sa_imports',
]);

const BODY_LIMIT = 1024 * 1024; // 1 mb is plenty for a letter

// --- read-only db for rows/graph. opened lazily so a missing db file
// fails on the endpoint that needs it, not at boot.
let _ro = null;
function roDb() {
  if (!_ro) {
    _ro = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return _ro;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function sendJson(req, res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
  });
  res.end(body);
}

function sendError(req, res, status, error, detail) {
  sendJson(req, res, status, { error, detail: detail ?? null });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('body must be valid json'));
      }
    });
    req.on('error', reject);
  });
}

function requireString(body, key) {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw Object.assign(new Error(`${key} must be a non-empty string`), { status: 400 });
  }
  return value;
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// --- graph assembly ---
// nodes: every row kind. edges: chain (anchor->anchor), supersedes
// (decision->decision), shares-tag (substance rows sharing a domain tag,
// only when the tag groups <= 20 rows), sealed-with (substance rows created
// in the same hour as a letter).

const GRAPH_NODE_CAP = 500; // per kind
const GRAPH_TAG_FANOUT = 20; // a tag shared by more rows is noise, not signal
const GRAPH_EDGE_BUDGET = 2000;

function shortLabel(text, max = 48) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function parseDomainTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function buildGraph() {
  const db = roDb();
  const nodes = [];
  const edges = [];
  let edgeBudget = GRAPH_EDGE_BUDGET;

  const pushEdge = (from, to, kind) => {
    if (edgeBudget <= 0) return false;
    edges.push({ from, to, kind });
    edgeBudget -= 1;
    return true;
  };

  // anchors ... the chain itself
  const anchors = db
    .prepare('select chain_index, kind, lane, created_at from sa_anchor order by chain_index asc limit ?')
    .all(GRAPH_NODE_CAP);
  for (const a of anchors) {
    nodes.push({
      id: `anchor:${a.chain_index}`,
      kind: 'anchor',
      label: `${a.kind} #${a.chain_index}`,
      lane: a.lane,
      at: a.created_at,
    });
  }
  for (let i = 1; i < anchors.length; i += 1) {
    pushEdge(`anchor:${anchors[i - 1].chain_index}`, `anchor:${anchors[i].chain_index}`, 'chain');
  }

  // letters ... the stream
  const letters = db
    .prepare('select id, letter, lane, written_at from sa_letters order by written_at desc limit ?')
    .all(GRAPH_NODE_CAP);
  const letterHours = new Map(); // hour bucket -> letter node ids
  for (const l of letters) {
    nodes.push({
      id: `letter:${l.id}`,
      kind: 'letter',
      label: shortLabel(l.letter),
      lane: l.lane,
      at: l.written_at,
    });
    const hour = String(l.written_at ?? '').slice(0, 13);
    if (hour.length === 13) {
      const bucket = letterHours.get(hour) ?? [];
      bucket.push(`letter:${l.id}`);
      letterHours.set(hour, bucket);
    }
  }

  // laws ... the constitution
  const laws = db.prepare('select position, law, created_at from sa_constitution order by position asc').all();
  for (const law of laws) {
    nodes.push({
      id: `law:${law.position}`,
      kind: 'law',
      label: shortLabel(law.law),
      at: law.created_at,
    });
  }

  // substance rows: scars, landmines, decisions. these carry tags, charge,
  // and co-sealed provenance.
  const substance = [
    {
      kind: 'scar',
      table: 'sa_scars',
      rows: db
        .prepare('select id, failure_class, domain_tags, charge, lane, created_at from sa_scars order by created_at desc limit ?')
        .all(GRAPH_NODE_CAP),
      label: (r) => shortLabel(r.failure_class),
    },
    {
      kind: 'landmine',
      table: 'sa_landmines',
      rows: db
        .prepare('select id, lesson, domain_tags, charge, lane, created_at from sa_landmines order by created_at desc limit ?')
        .all(GRAPH_NODE_CAP),
      label: (r) => shortLabel(r.lesson),
    },
    {
      kind: 'decision',
      table: 'sa_decisions',
      rows: db
        .prepare('select id, decision, domain_tags, charge, lane, created_at, superseded_by from sa_decisions order by created_at desc limit ?')
        .all(GRAPH_NODE_CAP),
      label: (r) => shortLabel(r.decision),
    },
  ];

  const nodeIds = new Set(nodes.map((n) => n.id));
  const tagGroups = new Map(); // tag -> [node ids]

  for (const group of substance) {
    for (const row of group.rows) {
      const nodeId = `${group.kind}:${row.id}`;
      nodes.push({
        id: nodeId,
        kind: group.kind,
        label: group.label(row),
        charge: row.charge,
        lane: row.lane,
        at: row.created_at,
      });
      nodeIds.add(nodeId);

      for (const tag of parseDomainTags(row.domain_tags)) {
        const bucket = tagGroups.get(tag) ?? [];
        bucket.push(nodeId);
        tagGroups.set(tag, bucket);
      }

      // sealed-with ... created in the same hour as a letter
      const hour = String(row.created_at ?? '').slice(0, 13);
      for (const letterId of letterHours.get(hour) ?? []) {
        pushEdge(letterId, nodeId, 'sealed-with');
      }
    }
  }

  // supersedes ... decisions point at their replacement, never deleted
  const decisions = substance[2].rows;
  for (const d of decisions) {
    if (d.superseded_by) {
      const from = `decision:${d.id}`;
      const to = `decision:${d.superseded_by}`;
      if (nodeIds.has(to)) pushEdge(from, to, 'supersedes');
    }
  }

  // shares-tag ... small groups first, so the budget goes to signal
  const groups = [...tagGroups.values()]
    .filter((ids) => ids.length >= 2 && ids.length <= GRAPH_TAG_FANOUT)
    .sort((a, b) => a.length - b.length);
  for (const ids of groups) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (!pushEdge(ids[i], ids[j], 'shares-tag')) break;
      }
      if (edgeBudget <= 0) break;
    }
    if (edgeBudget <= 0) break;
  }

  // the vault ... notes join the constellation, wikilinks become edges
  const vault = vaultGraph();
  for (const n of vault.nodes) nodes.push(n);
  for (const e of vault.edges) pushEdge(e.from, e.to, e.kind);

  return { nodes, edges };
}

// fusion search ... one ranked list across keel rows and vault notes.
// reciprocal rank fusion (k=60, the textbook constant): each list contributes
// 1/(k+rank) per hit, so a note and a letter compete on rank, not raw score.
function fusionSearch(q, limit) {
  const K = 60;
  const keelHits = search(q, limit);
  const noteHits = vaultSearch(q, limit);
  const merged = [];
  keelHits.forEach((h, i) => merged.push({ ...h, kind: 'keel', rrf: 1 / (K + i + 1) }));
  noteHits.forEach((h, i) => merged.push({
    kind: 'note',
    source: 'note',
    id: h.path,
    path: h.path,
    title: h.title,
    text: h.excerpt,
    tags: h.tags,
    at: h.mtime,
    rrf: 1 / (K + i + 1),
  }));
  return merged.sort((a, b) => b.rrf - a.rrf).slice(0, limit);
}

// --- routing ---

const routes = {
  'GET /api/wake': () => wake(),
  'GET /api/audit': () => audit(),
  'POST /api/consolidate': () => consolidate(),
  'GET /api/mirror': () => mirrorExport(),
  'GET /api/notes': () => ({ notes: listNotes() }),
  'GET /api/vault/graph': () => vaultGraph(),
  'GET /api/vault/templates': () => ({ templates: listTemplates() }),
  'GET /api/canvases': () => ({ canvases: listCanvases() }),
};

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const key = `${req.method} ${url.pathname}`;

  try {
    // simple routes, straight through to the engine
    const direct = routes[key];
    if (direct) {
      sendJson(req, res, 200, direct());
      return;
    }

    switch (key) {
      case 'POST /api/sleep': {
        const body = await readBody(req);
        requireString(body, 'letter');
        sendJson(req, res, 200, sleep({
          sessionRef: body.sessionRef ?? null,
          lane: body.lane ?? undefined,
          letter: body.letter,
          scars: Array.isArray(body.scars) ? body.scars : [],
          landmines: Array.isArray(body.landmines) ? body.landmines : [],
          decisions: Array.isArray(body.decisions) ? body.decisions : [],
        }));
        return;
      }
      case 'POST /api/seal': {
        const body = await readBody(req);
        const letter = requireString(body, 'letter');
        sendJson(req, res, 200, seal(letter, { sessionRef: body.sessionRef ?? null, lane: body.lane ?? undefined }));
        return;
      }
      case 'GET /api/search': {
        const q = url.searchParams.get('q');
        if (!q) return sendError(req, res, 400, 'missing query', 'pass ?q=');
        const limit = clampInt(url.searchParams.get('limit'), 8, 1, 100);
        sendJson(req, res, 200, search(q, limit));
        return;
      }
      case 'GET /api/search/all': {
        const q = url.searchParams.get('q');
        if (!q) return sendError(req, res, 400, 'missing query', 'pass ?q=');
        const limit = clampInt(url.searchParams.get('limit'), 12, 1, 100);
        sendJson(req, res, 200, { hits: fusionSearch(q, limit) });
        return;
      }
      case 'GET /api/rows': {
        const table = url.searchParams.get('table');
        if (!table || !ROW_TABLES.has(table)) {
          return sendError(req, res, 400, 'unknown table', `table must be one of: ${[...ROW_TABLES].join(', ')}`);
        }
        const limit = clampInt(url.searchParams.get('limit'), 100, 1, 1000);
        const offset = clampInt(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
        // table name is allowlisted above, so interpolation is safe
        const rows = roDb().prepare(`select * from ${table} limit ? offset ?`).all(limit, offset);
        const { n: total } = roDb().prepare(`select count(*) as n from ${table}`).get();
        sendJson(req, res, 200, { table, total, limit, offset, rows });
        return;
      }
      case 'GET /api/graph': {
        sendJson(req, res, 200, buildGraph());
        return;
      }
      case 'GET /api/note': {
        const notePath = url.searchParams.get('path');
        if (!notePath) return sendError(req, res, 400, 'missing path', 'pass ?path=');
        sendJson(req, res, 200, readNote(notePath));
        return;
      }
      case 'POST /api/note': {
        const body = await readBody(req);
        const notePath = requireString(body, 'path');
        const content = requireString(body, 'content');
        sendJson(req, res, 200, writeNote(notePath, content));
        return;
      }
      case 'DELETE /api/note': {
        const notePath = url.searchParams.get('path');
        if (!notePath) return sendError(req, res, 400, 'missing path', 'pass ?path=');
        sendJson(req, res, 200, deleteNote(notePath));
        return;
      }
      case 'GET /api/vault/search': {
        const q = url.searchParams.get('q');
        if (!q) return sendError(req, res, 400, 'missing query', 'pass ?q=');
        const limit = clampInt(url.searchParams.get('limit'), 12, 1, 100);
        sendJson(req, res, 200, { hits: vaultSearch(q, limit) });
        return;
      }
      case 'GET /api/vault/daily': {
        const date = url.searchParams.get('date') ?? undefined;
        sendJson(req, res, 200, dailyNote(date));
        return;
      }
      case 'POST /api/vault/from-template': {
        const body = await readBody(req);
        const notePath = requireString(body, 'path');
        const template = requireString(body, 'template');
        sendJson(req, res, 200, createFromTemplate(notePath, template));
        return;
      }
      case 'GET /api/canvas': {
        const p = url.searchParams.get('path');
        if (!p) return sendError(req, res, 400, 'missing path', 'pass ?path=');
        sendJson(req, res, 200, readCanvas(p));
        return;
      }
      case 'POST /api/canvas': {
        const body = await readBody(req);
        const p = requireString(body, 'path');
        sendJson(req, res, 200, writeCanvas(p, { nodes: body.nodes, edges: body.edges }));
        return;
      }
      case 'DELETE /api/canvas': {
        const p = url.searchParams.get('path');
        if (!p) return sendError(req, res, 400, 'missing path', 'pass ?path=');
        sendJson(req, res, 200, deleteCanvas(p));
        return;
      }
      case 'POST /api/scar': {
        const body = await readBody(req);
        const failureClass = requireString(body, 'failureClass');
        sendJson(req, res, 200, addScar(failureClass, {
          charge: body.charge,
          description: body.description,
          domainTags: body.domainTags,
          verification: body.verification,
          method: body.method,
          lane: body.lane,
        }));
        return;
      }
      case 'POST /api/landmine': {
        const body = await readBody(req);
        const lesson = requireString(body, 'lesson');
        sendJson(req, res, 200, addLandmine(lesson, {
          domainTags: body.domainTags,
          context: body.context,
          bornFrom: body.bornFrom,
          verification: body.verification,
          method: body.method,
          lane: body.lane,
        }));
        return;
      }
      case 'POST /api/decision': {
        const body = await readBody(req);
        const decision = requireString(body, 'decision');
        sendJson(req, res, 200, addDecision(decision, {
          why: body.why,
          alternativesRejected: body.alternativesRejected,
          charge: body.charge,
          lane: body.lane,
        }));
        return;
      }
      case 'POST /api/law': {
        const body = await readBody(req);
        const law = requireString(body, 'law');
        if (!Number.isSafeInteger(body.position)) {
          return sendError(req, res, 400, 'position required', 'position must be an integer');
        }
        sendJson(req, res, 200, addLaw(law, body.position));
        return;
      }
      case 'POST /api/landmine/confirm': {
        const body = await readBody(req);
        const founder = requireString(body, 'founder');
        const idOrAll = body.all === true ? 'all' : body.id;
        if (typeof idOrAll !== 'string' || idOrAll.length === 0) {
          return sendError(req, res, 400, 'id required', 'pass { id } or { all: true }');
        }
        sendJson(req, res, 200, confirmLandmine(idOrAll, founder));
        return;
      }
      case 'POST /api/mirror': {
        const body = await readBody(req);
        // accept either the raw mirror document or { json: <document> }
        const json = body.json !== undefined ? body.json : body;
        sendJson(req, res, 200, mirrorImport(json));
        return;
      }
      default:
        sendError(req, res, 404, 'not found', `${req.method} ${url.pathname} is not an endpoint`);
    }
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    // loud, never silent ... the error object is the receipt
    sendError(req, res, status, err?.message ?? String(err), status === 500 ? (err?.stack ?? null) : null);
  }
}

export function createServer() {
  return http.createServer(handle);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntry) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`soul-anchor server listening on http://${HOST}:${PORT}`);
    console.log(`db (read-only surfaces): ${DB_PATH}`);
  });
}
