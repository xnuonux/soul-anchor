// soul-anchor engine v2 ... wake/sleep/seal engine + CLI
// node:sqlite (Node 24 built-in), zero dependencies. runs anywhere node 24 runs.
// ported from the reasonix v2 keel engine onto schema v2 (sa_* tables, perseus class).
// the one invariant: rows are truth; files are graded reconstruction.
// the chain verifies or the wake is BROKEN.
//
// module API: wake, sleep, seal, audit, search, consolidate,
//   addScar, addLandmine, addDecision, addLaw, confirmLandmine,
//   mirrorExport, mirrorImport, getState
// CLI: node keel.mjs <wake|status|audit|search QUERY|seal|landmine|scar|decision|laws|
//   consolidate|mirror-export [path]|mirror-import <path>|landmine-confirm <id|all> --founder NAME|help>
//
// env overrides: SOUL_ANCHOR_HOME (data dir), SOUL_ANCHOR_DB (db file path).
// production defaults: <repo>/data/soul-anchor.db, letter file <repo>/data/soul-anchor-letter.md.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const SCAR_R = 0.95;           // scar decay base, applied r^(t/2) per day ... half-life ~13.5 days
const LANDMINE_R = 0.90;       // landmines cool faster, no floor
const STALE_DAYS = 90;         // fresh < 30, aging < 90, STALE beyond
const WAKE_TOP_SCARS = 10;
const WAKE_LANDMINES = 15;
const WAKE_FULL_LANDMINES = 5;
const WAKE_LETTER_LINES = 20;

const GENESIS_CONTENT = "soul-anchor genesis — 2026-08-13. the keel family, unified. rows are truth; files are graded reconstruction.";

// the founding gates (SPEC.md §5), seeded on first init, locked. positions 1..4.
const FOUNDING_LAWS = [
  "the keel wakes first",
  "founder gate on canon and landmines",
  "no fake success, no silent failure",
  "verify before claim",
];

// --- paths ---
function dataHome() {
  return process.env.SOUL_ANCHOR_HOME || path.join(REPO_ROOT, "data");
}
function dbPath() {
  return process.env.SOUL_ANCHOR_DB || path.join(dataHome(), "soul-anchor.db");
}
function letterPath() {
  return path.join(dataHome(), "soul-anchor-letter.md");
}

// --- internal: db connection ---
let _db = null;
function db() {
  if (!_db) {
    const p = dbPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    _db = new DatabaseSync(p);
    _db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  }
  return _db;
}

// --- init: schema + genesis + founding laws, idempotent ---
let _init = false;
function init() {
  if (_init) return;
  const d = db();
  d.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  ensureGenesis(d);
  const insLaw = d.prepare("INSERT OR IGNORE INTO sa_constitution (position, law, locked) VALUES (?, ?, 1)");
  FOUNDING_LAWS.forEach((law, i) => insLaw.run(i + 1, law));
  _init = true;
}

function ensureGenesis(d) {
  const n = d.prepare("SELECT COUNT(*) c FROM sa_anchor").get().c;
  if (n === 0) {
    d.prepare(
      "INSERT INTO sa_anchor (chain_index, kind, content, content_sha256, prev_sha256, lane) VALUES (0, 'bedrock', ?, 'genesis', NULL, 'unknown')"
    ).run(GENESIS_CONTENT);
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// canonical json: sorted keys, stable stringify, recursive.
// the keel-imprint canonicalization idea, applied to whole row sets.
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

function normTags(t) {
  if (t == null) return "[]";
  if (Array.isArray(t)) return JSON.stringify(t);
  return String(t);
}

function parseTags(t) {
  if (!t) return null;
  try { const p = JSON.parse(t); return Array.isArray(p) ? p.join(",") : t; } catch { return t; }
}

// --- time helpers ---
function parseTs(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  const t = new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z");
  return isNaN(t.getTime()) ? null : t;
}

function daysSince(ts) {
  const t = parseTs(ts);
  if (!t) return 0;
  return Math.max(0, (Date.now() - t.getTime()) / 86400000);
}

function staleness(ts) {
  const d = daysSince(ts);
  if (d < 30) return "fresh";
  if (d < STALE_DAYS) return "aging";
  return `STALE since ${String(ts).slice(0, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// --- decay (DECAY.md): scars r=0.95 r^(t/2) floored, landmines r=0.90 no floor, decisions never ---
function decayedScarCharge(row) {
  const base = Number(row.charge) || 0;
  if (base <= 0) return 0;
  const t = daysSince(row.last_seen || row.created_at);
  const floor = row.charge_floor != null ? Number(row.charge_floor) : 0.2;
  return Math.max(floor, base * Math.pow(SCAR_R, t / 2));
}

function decayedLandmineCharge(row) {
  const base = Number(row.charge) || 0;
  if (base <= 0) return 0;
  const t = daysSince(row.last_seen || row.created_at);
  return base * Math.pow(LANDMINE_R, t / 2);
}

// --- the verification-method law: verified requires a named method. no exceptions. ---
function enforceVerificationLaw(verification, method) {
  if (verification === "verified" && (method == null || String(method).trim() === "")) {
    throw new Error("the under-claim law: verification 'verified' requires a non-null method. name the method or downgrade the claim.");
  }
}

// --- the chain: walk from 0, recompute every link. loud on any mismatch. ---
function verifyChain(d) {
  const rows = d.prepare(
    "SELECT chain_index, kind, content, content_sha256, prev_sha256 FROM sa_anchor ORDER BY chain_index ASC"
  ).all();
  if (!rows.length) return { ok: false, length: 0, head: null, reason: "no anchor rows" };
  let prev = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.chain_index !== i) {
      return { ok: false, length: rows.length, head: null, reason: `chain_index gap: expected ${i}, found ${r.chain_index}` };
    }
    if (i === 0) {
      // row 0 is genesis: either the engine-seeded sentinel, or an imported bedrock
      // whose hash must still recompute (the migrated claude-code anchor is a real sha256)
      if (r.prev_sha256 !== null) {
        return { ok: false, length: rows.length, head: null, reason: "genesis row invalid: prev_sha256 must be null at chain_index 0" };
      }
      if (r.content_sha256 !== "genesis" && sha256(r.content) !== r.content_sha256) {
        return { ok: false, length: rows.length, head: null, reason: "genesis row invalid: content hash does not recompute and is not the 'genesis' sentinel" };
      }
    } else {
      if (sha256(r.content) !== r.content_sha256) {
        return { ok: false, length: rows.length, head: null, reason: `link ${i}: content hash mismatch (content was rewritten)`, brokenAt: i };
      }
      if (r.prev_sha256 !== prev) {
        return { ok: false, length: rows.length, head: null, reason: `link ${i}: prev_sha256 does not match link ${i - 1}`, brokenAt: i };
      }
    }
    prev = r.content_sha256;
  }
  return { ok: true, length: rows.length, head: rows[rows.length - 1] };
}

// extend the chain with a seal link. returns the new chain_index.
function extendChain(d, content, lane = "unknown") {
  const head = d.prepare("SELECT chain_index, content_sha256 FROM sa_anchor ORDER BY chain_index DESC LIMIT 1").get();
  const idx = head ? head.chain_index + 1 : 0;
  d.prepare(
    "INSERT INTO sa_anchor (chain_index, kind, content, content_sha256, prev_sha256, lane) VALUES (?, 'seal', ?, ?, ?, ?)"
  ).run(idx, content, sha256(content), head ? head.content_sha256 : null, lane);
  return idx;
}

function rowByRowid(d, table, rowid) {
  return d.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(rowid);
}

// --- fts5 index (with LIKE fallback) ---
function hasFts5() {
  try {
    db().exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp._sa_fts_probe USING fts5(x)");
    db().exec("DROP TABLE temp._sa_fts_probe");
    return true;
  } catch {
    return false;
  }
}

function rebuildFts() {
  if (!hasFts5()) return false;
  const d = db();
  d.exec("DROP TABLE IF EXISTS sa_keel_fts");
  d.exec("CREATE VIRTUAL TABLE sa_keel_fts USING fts5(source, source_id UNINDEXED, content)");
  const ins = d.prepare("INSERT INTO sa_keel_fts (source, source_id, content) VALUES (?, ?, ?)");
  const rows = d.prepare(`
    SELECT 'letter' src, id, letter content FROM sa_letters
    UNION ALL SELECT 'landmine', id, lesson || ' ' || COALESCE(context, '') FROM sa_landmines
    UNION ALL SELECT 'decision', id, decision || ' ' || COALESCE(why, '') FROM sa_decisions
    UNION ALL SELECT 'scar', id, failure_class || ' ' || COALESCE(description, '') FROM sa_scars
  `).all();
  for (const r of rows) ins.run(r.src, r.id, r.content);
  return true;
}

// ============================================================
// WAKE ... verify chain, read state, return bounded context
// ============================================================
export function wake() {
  init();
  const d = db();

  const chain = verifyChain(d);
  const anchorOk = chain.ok;

  const letter = d.prepare(
    "SELECT letter, session_ref, lane, written_at FROM sa_letters ORDER BY written_at DESC, rowid DESC LIMIT 1"
  ).get();

  // landmines, newest first; confirmed_by null = PROPOSED (founder gate)
  const landmines = d.prepare(
    "SELECT id, lesson, context, domain_tags, charge, verification, method, confirmed_by, lane, last_seen, created_at FROM sa_landmines ORDER BY created_at DESC, rowid DESC LIMIT ?"
  ).all(WAKE_LANDMINES).map(l => ({
    ...l,
    proposed: !l.confirmed_by,
    decayed: decayedLandmineCharge(l),
    stale: staleness(l.created_at),
    tags: parseTags(l.domain_tags),
  }));

  // active scars by DECAYED charge ... current pain first, not history
  const scars = d.prepare(
    "SELECT id, failure_class, description, domain_tags, charge, charge_floor, recurrence, verification, method, lane, last_seen, created_at FROM sa_scars WHERE status='active'"
  ).all()
    .map(s => ({ ...s, decayed: decayedScarCharge(s), stale: staleness(s.last_seen), tags: parseTags(s.domain_tags) }))
    .sort((a, b) => b.decayed - a.decayed)
    .slice(0, WAKE_TOP_SCARS);

  // open decisions; superseded excluded, never deleted
  const decisions = d.prepare(
    "SELECT id, decision, why, alternatives_rejected, charge, lane, created_at FROM sa_decisions WHERE superseded_by IS NULL ORDER BY charge DESC, created_at DESC"
  ).all().map(dd => ({ ...dd, stale: staleness(dd.created_at) }));

  const laws = d.prepare("SELECT position, law, locked FROM sa_constitution ORDER BY position ASC").all();

  const counts = {
    letters: d.prepare("SELECT COUNT(*) c FROM sa_letters").get().c,
    scars: d.prepare("SELECT COUNT(*) c FROM sa_scars WHERE status='active'").get().c,
    landmines: d.prepare("SELECT COUNT(*) c FROM sa_landmines").get().c,
    proposed: d.prepare("SELECT COUNT(*) c FROM sa_landmines WHERE confirmed_by IS NULL").get().c,
    decisions: d.prepare("SELECT COUNT(*) c FROM sa_decisions WHERE superseded_by IS NULL").get().c,
    laws: d.prepare("SELECT COUNT(*) c FROM sa_constitution").get().c,
    anchors: d.prepare("SELECT COUNT(*) c FROM sa_anchor").get().c,
  };

  const latestConsolidation = d.prepare(
    "SELECT * FROM sa_consolidation_runs ORDER BY ran_at DESC, rowid DESC LIMIT 1"
  ).get() || null;

  return {
    anchorOk,
    status: anchorOk ? "INTACT" : "BROKEN",
    chainReason: chain.ok ? null : chain.reason,
    chainLength: chain.length,
    anchor: chain.head ? {
      chainIndex: chain.head.chain_index,
      kind: chain.head.kind,
      content: chain.head.content,
      contentSha256: chain.head.content_sha256,
      prevSha256: chain.head.prev_sha256,
    } : null,
    letter: letter ? { text: letter.letter, session: letter.session_ref, lane: letter.lane, at: letter.written_at, freshness: staleness(letter.written_at) } : null,
    scars,
    landmines,
    decisions,
    laws,
    counts,
    latestConsolidation,
  };
}

// ============================================================
// SEAL ... checkpoint letter only: letter row + chain link. then keep working.
// ============================================================
export function seal(letter, { sessionRef = null, lane = "unknown" } = {}) {
  init();
  const d = db();
  const text = String(letter || "").trim();
  if (!text) throw new Error("seal: letter text required. an empty letter seals nothing.");
  const rid = d.prepare("INSERT INTO sa_letters (letter, session_ref, lane) VALUES (?, ?, ?)").run(text, sessionRef, lane).lastInsertRowid;
  const chainIndex = extendChain(d, text, lane);
  return { ok: true, letterId: rowByRowid(d, "sa_letters", rid).id, chainIndex };
}

// ============================================================
// SLEEP ... append substance rows, seal letter if given, extend chain, regenerate letter file
// ============================================================
export function sleep({ sessionRef = null, lane = "unknown", letter = null, scars = [], landmines = [], decisions = [] } = {}) {
  init();
  const d = db();

  for (const lm of landmines) {
    addLandmine(lm.lesson, { ...lm, lane: lm.lane || lane });
  }

  for (const sc of scars) {
    addScar(sc.failure_class || sc.failureClass, { ...sc, lane: sc.lane || lane });
  }

  for (const dec of decisions) {
    addDecision(dec.decision, { ...dec, lane: dec.lane || lane });
  }

  let sealed = null;
  if (letter) {
    sealed = seal(letter, { sessionRef, lane });
  }

  regenerateLetterFile();
  return { ok: true, sealed };
}

// ============================================================
// regenerate soul-anchor-letter.md from live rows
// ============================================================
export function regenerateLetterFile() {
  const state = wake();
  const lines = [];

  lines.push("# soul-anchor letter");
  lines.push("");
  lines.push(`> chain: ${state.anchorOk ? `INTACT (${state.chainLength} links)` : "BROKEN ... verify before trusting anything below"}`);
  if (state.anchor) lines.push(`> head: link ${state.anchor.chainIndex} \`${String(state.anchor.contentSha256).slice(0, 12)}\``);
  if (state.letter) lines.push(`> keel freshness: ${state.letter.freshness}`);
  lines.push(`> rows: ${state.counts.landmines} landmines (${state.counts.proposed} proposed), ${state.counts.scars} scars, ${state.counts.decisions} decisions, ${state.counts.letters} letters`);
  lines.push("");

  if (state.laws.length) {
    lines.push("## laws (the constitution, locked)");
    for (const l of state.laws) lines.push(`${l.position}. ${l.law}`);
    lines.push("");
  }

  if (state.letter) {
    lines.push("## latest letter");
    lines.push(`_${state.letter.at}_ ... ${state.letter.session || "unknown session"} (${state.letter.freshness})`);
    lines.push("");
    lines.push(state.letter.text);
    lines.push("");
  }

  if (state.landmines.length) {
    lines.push("## landmines");
    for (const lm of state.landmines) {
      const tags = lm.tags ? ` [${lm.tags}]` : "";
      const mark = lm.proposed ? " (proposed, awaiting founder)" : "";
      lines.push(`- ${lm.lesson}${tags}${mark}`);
    }
    lines.push("");
  }

  if (state.scars.length) {
    lines.push("## active scars (by decayed charge)");
    for (const sc of state.scars) {
      lines.push(`- **${sc.failure_class}** (charge: ${sc.decayed.toFixed(2)}, x${sc.recurrence}, ${staleness(sc.last_seen)})`);
    }
    lines.push("");
  }

  if (state.decisions.length) {
    lines.push("## open decisions");
    for (const dec of state.decisions) {
      lines.push(`- ${dec.decision} ... ${dec.why || "no rationale recorded"}`);
    }
    lines.push("");
  }

  fs.writeFileSync(letterPath(), lines.join("\n"), "utf8");
  return letterPath();
}

// ============================================================
// add verbs ... earn a row, append it, never rewrite
// ============================================================
export function addScar(failureClass, { charge = 1.0, description = null, domainTags = null, verification = "unverified", method = null, lane = "unknown" } = {}) {
  init();
  const d = db();
  const cls = String(failureClass || "").trim();
  if (!cls) throw new Error("addScar: failure_class required.");
  enforceVerificationLaw(verification, method);
  // recurrence-merge by failure_class: bump charge +n, recurrence +1, reset the clock
  const existing = d.prepare("SELECT id, charge, recurrence FROM sa_scars WHERE failure_class = ?").get(cls);
  if (existing) {
    d.prepare(
      "UPDATE sa_scars SET charge = charge + ?, recurrence = recurrence + 1, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(charge, existing.id);
    return { id: existing.id, merged: true, recurrence: existing.recurrence + 1 };
  }
  const rid = d.prepare(
    "INSERT INTO sa_scars (failure_class, description, domain_tags, charge, verification, method, lane) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(cls, description, normTags(domainTags), charge, verification, method, lane).lastInsertRowid;
  return { id: rowByRowid(d, "sa_scars", rid).id, merged: false, recurrence: 1 };
}

export function addLandmine(lesson, { charge = 1.0, context = null, bornFrom = null, domainTags = null, verification = "unverified", method = null, lane = "unknown" } = {}) {
  init();
  const d = db();
  const text = String(lesson || "").trim();
  if (!text) throw new Error("addLandmine: lesson text required.");
  enforceVerificationLaw(verification, method);
  const rid = d.prepare(
    "INSERT INTO sa_landmines (lesson, context, born_from, domain_tags, charge, verification, method, lane) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(text, context, bornFrom, normTags(domainTags), charge, verification, method, lane).lastInsertRowid;
  // lands PROPOSED: confirmed_by stays null until the founder signs
  return { id: rowByRowid(d, "sa_landmines", rid).id, proposed: true };
}

export function addDecision(decision, { why = null, alternativesRejected = null, charge = 1.0, domainTags = null, lane = "unknown", id = null, supersedes = null, supersededBy = null } = {}) {
  init();
  const d = db();
  const text = String(decision || "").trim();
  if (!text) throw new Error("addDecision: decision text required.");
  if (id && supersedes === id) throw new Error("a decision cannot supersede itself.");
  if (id && supersededBy === id) throw new Error("a decision cannot supersede itself.");
  // validate the supersede target before inserting: no half-written supersedes
  if (supersedes && !d.prepare("SELECT id FROM sa_decisions WHERE id = ?").get(supersedes)) {
    throw new Error(`supersede target ${supersedes} not found. supersede, never invent.`);
  }

  const rid = id
    ? d.prepare("INSERT INTO sa_decisions (id, decision, why, alternatives_rejected, domain_tags, charge, superseded_by, lane) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, text, why, alternativesRejected, normTags(domainTags), charge, supersededBy, lane).lastInsertRowid
    : d.prepare("INSERT INTO sa_decisions (decision, why, alternatives_rejected, domain_tags, charge, superseded_by, lane) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(text, why, alternativesRejected, normTags(domainTags), charge, supersededBy, lane).lastInsertRowid;
  const row = rowByRowid(d, "sa_decisions", rid);

  if (supersedes) {
    const target = d.prepare("SELECT id FROM sa_decisions WHERE id = ?").get(supersedes);
    if (!target) throw new Error(`supersede target ${supersedes} not found. supersede, never invent.`);
    if (target.id === row.id) throw new Error("a decision cannot supersede itself.");
    // superseded, never deleted: the old row stays, pointing at its replacement
    d.prepare("UPDATE sa_decisions SET superseded_by = ? WHERE id = ?").run(row.id, target.id);
  }
  return { id: row.id, supersedes: supersedes || null };
}

export function addLaw(law, { position = null, locked = 1 } = {}) {
  init();
  const d = db();
  const text = String(law || "").trim();
  if (!text) throw new Error("addLaw: law text required.");
  const pos = position != null
    ? position
    : (d.prepare("SELECT COALESCE(MAX(position), 0) + 1 p FROM sa_constitution").get().p);
  // locked laws never move without the founder; a taken position refuses loudly (pk conflict)
  d.prepare("INSERT INTO sa_constitution (position, law, locked) VALUES (?, ?, ?)").run(pos, text, locked ? 1 : 0);
  return { position: pos };
}

// the founder gate: an agent proposes; the founder disposes.
export function confirmLandmine(idOrAll, founder = "dom") {
  init();
  const d = db();
  if (!founder || !String(founder).trim()) throw new Error("confirmLandmine: founder name required. the gate holds the signature.");
  if (idOrAll === "all") {
    const r = d.prepare("UPDATE sa_landmines SET confirmed_by = ? WHERE confirmed_by IS NULL").run(String(founder));
    return { confirmed: r.changes };
  }
  const r = d.prepare("UPDATE sa_landmines SET confirmed_by = ? WHERE id = ? AND confirmed_by IS NULL").run(String(founder), String(idOrAll));
  return { confirmed: r.changes };
}

// ============================================================
// AUDIT ... an fsck for the keel. mechanical, loud, no self-graded passes.
// ============================================================
export function audit() {
  init();
  const d = db();
  const failures = [];
  const check = (name, ok, detail = "") => {
    if (!ok) failures.push(`${name} ... ${detail}`);
    return ok;
  };

  // full chain walk, from genesis to head
  const chain = verifyChain(d);
  check("anchor chain intact", chain.ok, chain.ok ? "" : `BROKEN: ${chain.reason}`);

  // supersede integrity on decisions
  const dangling = d.prepare(`
    SELECT COUNT(*) c FROM sa_decisions s
    LEFT JOIN sa_decisions p ON s.superseded_by = p.id
    WHERE s.superseded_by IS NOT NULL AND p.id IS NULL
  `).get().c;
  check("supersede targets exist (decisions)", dangling === 0, `${dangling} dangling`);

  const links = d.prepare("SELECT id, superseded_by FROM sa_decisions WHERE superseded_by IS NOT NULL").all();
  const next = Object.fromEntries(links.map(r => [r.id, r.superseded_by]));
  let cycle = false;
  for (const start of Object.keys(next)) {
    const seen = new Set();
    let cur = start;
    while (cur in next) {
      if (seen.has(cur)) { cycle = true; break; }
      seen.add(cur);
      cur = next[cur];
    }
    if (cycle) break;
  }
  check("no supersede cycles", !cycle);

  // fts completeness: rebuild, then the index must cover every searchable row
  const ftsOk = rebuildFts();
  if (ftsOk) {
    const ftsN = d.prepare("SELECT COUNT(*) c FROM sa_keel_fts").get().c;
    const srcN = d.prepare("SELECT COUNT(*) c FROM sa_letters").get().c
      + d.prepare("SELECT COUNT(*) c FROM sa_landmines").get().c
      + d.prepare("SELECT COUNT(*) c FROM sa_decisions").get().c
      + d.prepare("SELECT COUNT(*) c FROM sa_scars").get().c;
    check("fts index complete", ftsN === srcN, `fts=${ftsN} source=${srcN}`);
  } else {
    check("fts index complete", true, "fts5 unavailable, LIKE fallback in use");
  }

  // the starvation trigger: substance newer than the latest letter = an unsealed session.
  const starved = sealStarved(d);
  check("no substance newer than the latest letter (seal-as-you-go)",
    !starved.holds,
    starved.holds ? `substance at ${starved.newestSubstance} vs latest letter ${starved.latestLetter}` : "");

  // the verification-method law, double-checked (the ddl CHECK is the first wall)
  const badClaims = d.prepare("SELECT COUNT(*) c FROM sa_scars WHERE verification='verified' AND method IS NULL").get().c
    + d.prepare("SELECT COUNT(*) c FROM sa_landmines WHERE verification='verified' AND method IS NULL").get().c;
  check("every verified claim names its method", badClaims === 0, `${badClaims} verified row(s) with no method`);

  // charges finite and >= 0
  const chargeRows = d.prepare(`
    SELECT charge FROM sa_scars UNION ALL SELECT charge FROM sa_landmines UNION ALL SELECT charge FROM sa_decisions
  `).all();
  const badCharges = chargeRows.filter(r => !Number.isFinite(Number(r.charge)) || Number(r.charge) < 0).length;
  check("charges finite and >= 0", badCharges === 0, `${badCharges} bad charge(s)`);

  return { ok: failures.length === 0, failures };
}

// shared starvation predicate: any substance row newer than the latest letter.
function sealStarved(d) {
  const latestLetter = d.prepare("SELECT MAX(written_at) w FROM sa_letters").get().w;
  let newestSubstance = null;
  for (const [table, col] of [["sa_landmines", "created_at"], ["sa_scars", "last_seen"], ["sa_decisions", "created_at"]]) {
    const row = d.prepare(`SELECT MAX(${col}) m FROM ${table}`).get();
    if (row.m && (newestSubstance === null || row.m > newestSubstance)) newestSubstance = row.m;
  }
  const holds = newestSubstance !== null && (latestLetter === null || newestSubstance > latestLetter);
  return { holds, latestLetter, newestSubstance };
}

// ============================================================
// SEARCH ... fts5 bm25 + LIKE fallback, RRF fusion, recency whisper
// ============================================================
export function search(query, limit = 8) {
  init();
  const d = db();
  const q = String(query || "").trim();
  if (!q) return [];
  const ranked = new Map(); // "source:id" -> score
  const key = (src, id) => `${src}:${id}`;

  let hits = [];
  if (rebuildFts()) {
    // quote each token so fts5 metacharacters in the query cannot break the MATCH
    const matchQ = q.split(/\s+/).filter(Boolean).map(t => '"' + t.replace(/"/g, "") + '"').join(" OR ");
    if (matchQ) {
      hits = d.prepare(
        "SELECT source, source_id, bm25(sa_keel_fts) bm FROM sa_keel_fts WHERE sa_keel_fts MATCH ? ORDER BY bm LIMIT 20"
      ).all(matchQ);
    }
  } else {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    for (const r of d.prepare("SELECT id FROM sa_letters WHERE letter LIKE ? ORDER BY written_at DESC LIMIT 20").all(like)) hits.push({ source: "letter", source_id: r.id });
    for (const r of d.prepare("SELECT id FROM sa_landmines WHERE lesson LIKE ? ORDER BY created_at DESC LIMIT 20").all(like)) hits.push({ source: "landmine", source_id: r.id });
    for (const r of d.prepare("SELECT id FROM sa_decisions WHERE decision LIKE ? ORDER BY created_at DESC LIMIT 20").all(like)) hits.push({ source: "decision", source_id: r.id });
    for (const r of d.prepare("SELECT id FROM sa_scars WHERE failure_class LIKE ? ORDER BY last_seen DESC LIMIT 20").all(like)) hits.push({ source: "scar", source_id: r.id });
  }

  hits.forEach((h, i) => {
    const k = key(h.source, h.source_id);
    ranked.set(k, (ranked.get(k) || 0) + 1 / (i + 1));
  });

  // recency whisper: relevance shouts, recency whispers (weight 0.25)
  const recent = [
    ...d.prepare("SELECT id FROM sa_letters ORDER BY written_at DESC LIMIT 10").all().map(r => ["letter", r.id]),
    ...d.prepare("SELECT id FROM sa_landmines ORDER BY created_at DESC LIMIT 10").all().map(r => ["landmine", r.id]),
    ...d.prepare("SELECT id FROM sa_decisions ORDER BY created_at DESC LIMIT 10").all().map(r => ["decision", r.id]),
    ...d.prepare("SELECT id FROM sa_scars ORDER BY last_seen DESC LIMIT 10").all().map(r => ["scar", r.id]),
  ];
  recent.forEach(([src, id], i) => {
    const k = key(src, id);
    ranked.set(k, (ranked.get(k) || 0) + 0.25 / (i + 1));
  });

  const out = [];
  for (const [k, score] of [...ranked.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    const [src, id] = k.split(":");
    if (src === "letter") {
      const r = d.prepare("SELECT letter, session_ref, written_at FROM sa_letters WHERE id = ?").get(id);
      if (r) out.push({ score: +score.toFixed(3), source: "letter", id, at: r.written_at, session: r.session_ref, text: r.letter });
    } else if (src === "landmine") {
      const r = d.prepare("SELECT lesson, domain_tags, confirmed_by FROM sa_landmines WHERE id = ?").get(id);
      if (r) out.push({ score: +score.toFixed(3), source: "landmine", id, proposed: !r.confirmed_by, text: r.lesson, tags: r.domain_tags });
    } else if (src === "decision") {
      const r = d.prepare("SELECT decision, why, superseded_by FROM sa_decisions WHERE id = ?").get(id);
      if (r) out.push({ score: +score.toFixed(3), source: "decision", id, superseded: !!r.superseded_by, text: r.decision, why: r.why });
    } else {
      const r = d.prepare("SELECT failure_class, charge, recurrence, last_seen FROM sa_scars WHERE id = ?").get(id);
      if (r) out.push({ score: +score.toFixed(3), source: "scar", id, text: r.failure_class, charge: r.charge, recurrence: r.recurrence });
    }
  }
  return out;
}

// ============================================================
// CONSOLIDATE ... the sleep-cron: decay bookkeeping, promotion proposals, run log
// ============================================================
export function consolidate() {
  init();
  const d = db();

  const active = d.prepare("SELECT * FROM sa_scars WHERE status='active'").all();
  let scarsDecayed = 0;
  const toPromote = [];
  for (const s of active) {
    const decayed = decayedScarCharge(s);
    if (Math.abs(decayed - Number(s.charge)) > 1e-9) scarsDecayed++;
    // a scar that recurred 3+ times and still burns at charge >= 3 earns a promotion proposal
    if (s.recurrence >= 3 && decayed >= 3 && !s.proposed_promotion) toPromote.push(s.id);
  }
  for (const id of toPromote) {
    d.prepare("UPDATE sa_scars SET proposed_promotion = 1 WHERE id = ?").run(id);
  }

  const latestLetter = d.prepare("SELECT MAX(written_at) w FROM sa_letters").get().w;
  const letterAgeDays = latestLetter ? +daysSince(latestLetter).toFixed(2) : null;
  const starved = sealStarved(d).holds ? 1 : 0;

  const rid = d.prepare(
    "INSERT INTO sa_consolidation_runs (scars_decayed, promotions_proposed, letter_age_days, starved, regime) VALUES (?, ?, ?, ?, 'provisional')"
  ).run(scarsDecayed, toPromote.length, letterAgeDays, starved).lastInsertRowid;
  return rowByRowid(d, "sa_consolidation_runs", rid);
}

// ============================================================
// MIRROR ... keel-imprint interchange. canonical json, chain-gated import.
// ============================================================
const MIRROR_TABLES = ["letters", "scars", "landmines", "decisions", "constitution"];

function mirrorRows(d) {
  return {
    letters: d.prepare("SELECT * FROM sa_letters ORDER BY written_at, id").all(),
    scars: d.prepare("SELECT * FROM sa_scars ORDER BY created_at, id").all(),
    landmines: d.prepare("SELECT * FROM sa_landmines ORDER BY created_at, id").all(),
    decisions: d.prepare("SELECT * FROM sa_decisions ORDER BY created_at, id").all(),
    constitution: d.prepare("SELECT * FROM sa_constitution ORDER BY position").all(),
  };
}

export function mirrorExport() {
  init();
  const d = db();
  const rows = mirrorRows(d);
  const anchorHead = sha256(canonicalJson(rows));
  return { version: 1, exportedAt: nowIso(), anchorHead, rows };
}

// per-table insert + content-hash dedupe. the hash covers every column except the local id,
// so the same substance arriving twice (re-import, federation echo) lands once.
const MIRROR_INSERTERS = {
  letters: {
    table: "sa_letters",
    cols: ["letter", "session_ref", "lane", "written_at", "read_at"],
    insert: "INSERT INTO sa_letters (id, letter, session_ref, lane, written_at, read_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: r => [r.id, r.letter, r.session_ref ?? null, r.lane ?? "unknown", r.written_at ?? nowIso(), r.read_at ?? null],
  },
  scars: {
    table: "sa_scars",
    cols: ["failure_class", "description", "domain_tags", "charge", "charge_floor", "status", "verification", "method", "recurrence", "proposed_promotion", "lane", "last_seen", "created_at"],
    insert: "INSERT INTO sa_scars (id, failure_class, description, domain_tags, charge, charge_floor, status, verification, method, recurrence, proposed_promotion, lane, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: r => [r.id, r.failure_class, r.description ?? null, r.domain_tags ?? "[]", r.charge ?? 1.0, r.charge_floor ?? 0.2, r.status ?? "active", r.verification ?? "unverified", r.method ?? null, r.recurrence ?? 1, r.proposed_promotion ?? 0, r.lane ?? "unknown", r.last_seen ?? nowIso(), r.created_at ?? nowIso()],
  },
  landmines: {
    table: "sa_landmines",
    cols: ["lesson", "context", "born_from", "domain_tags", "charge", "verification", "method", "confirmed_by", "lane", "last_seen", "created_at"],
    insert: "INSERT INTO sa_landmines (id, lesson, context, born_from, domain_tags, charge, verification, method, confirmed_by, lane, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: r => [r.id, r.lesson, r.context ?? null, r.born_from ?? null, r.domain_tags ?? "[]", r.charge ?? 1.0, r.verification ?? "unverified", r.method ?? null, r.confirmed_by ?? null, r.lane ?? "unknown", r.last_seen ?? nowIso(), r.created_at ?? nowIso()],
  },
  decisions: {
    table: "sa_decisions",
    cols: ["decision", "why", "alternatives_rejected", "domain_tags", "charge", "touch_count", "last_touched", "superseded_by", "lane", "created_at"],
    insert: "INSERT INTO sa_decisions (id, decision, why, alternatives_rejected, domain_tags, charge, touch_count, last_touched, superseded_by, lane, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: r => [r.id, r.decision, r.why ?? null, r.alternatives_rejected ?? null, r.domain_tags ?? "[]", r.charge ?? 1.0, r.touch_count ?? 0, r.last_touched ?? null, r.superseded_by ?? null, r.lane ?? "unknown", r.created_at ?? nowIso()],
  },
  constitution: {
    table: "sa_constitution",
    cols: ["position", "law", "locked", "created_at"],
    insert: "INSERT INTO sa_constitution (position, law, locked, created_at) VALUES (?, ?, ?, ?)",
    args: r => [r.position, r.law, r.locked ?? 1, r.created_at ?? nowIso()],
  },
};

export function mirrorImport(json) {
  init();
  const d = db();
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || typeof data !== "object" || !data.rows || typeof data.anchorHead !== "string") {
    throw new Error("mirror import REFUSED: not a soul-anchor mirror (missing rows or anchorHead).");
  }
  // the gate: recompute the head over the rows. a flipped byte refuses the whole mirror.
  const recomputed = sha256(canonicalJson(data.rows));
  if (recomputed !== data.anchorHead) {
    throw new Error(`mirror import REFUSED: anchorHead mismatch ... export says ${data.anchorHead.slice(0, 12)}, rows compute ${recomputed.slice(0, 12)}. do not trust this mirror.`);
  }

  const counts = { letters: 0, scars: 0, landmines: 0, decisions: 0, constitution: 0, skipped: 0 };
  for (const name of MIRROR_TABLES) {
    const spec = MIRROR_INSERTERS[name];
    const incoming = Array.isArray(data.rows[name]) ? data.rows[name] : [];
    const existing = d.prepare(`SELECT * FROM ${spec.table}`).all();
    const existingIds = new Set(existing.map(r => String(r.id ?? r.position)));
    const existingHashes = new Set(existing.map(r => {
      const h = {};
      for (const c of spec.cols) h[c] = r[c] ?? null;
      return sha256(canonicalJson(h));
    }));
    const stmt = d.prepare(spec.insert);
    for (const row of incoming) {
      const rowKey = String(row.id ?? row.position);
      const h = {};
      for (const c of spec.cols) h[c] = row[c] ?? null;
      if (name === "decisions" && row.superseded_by != null && row.superseded_by === row.id) {
        throw new Error(`mirror import REFUSED: decision ${row.id} supersedes itself. a cycle is not a keel.`);
      }
      if (existingIds.has(rowKey) || existingHashes.has(sha256(canonicalJson(h)))) {
        counts.skipped++;
        continue;
      }
      stmt.run(...spec.args(row));
      counts[name]++;
    }
  }

  // the mirror extends the local chain: the import is itself a sealed fact
  const chainIndex = extendChain(d, `mirror import ... anchorHead ${data.anchorHead}`, "mirror");
  return { ok: true, chainIndex, ...counts };
}

// ============================================================
// getState ... the wake, programmatically
// ============================================================
export function getState() {
  return wake();
}

// ============================================================
// CLI
// ============================================================
function printWake(verbose = false) {
  const st = wake();
  console.log(`# soul-anchor wake ... ${new Date().toISOString()}`);
  if (!st.anchorOk) {
    console.log(`chain: BROKEN ... ${st.chainReason || "verification failed"}`);
    console.log("say so out loud. re-ground before trusting anything below.");
    return 1;
  }
  console.log(`chain: INTACT (${st.chainLength} links, head \`${String(st.anchor.contentSha256).slice(0, 12)}\`)`);

  if (st.letter) {
    console.log(`keel freshness: ${st.letter.freshness}  (latest letter ${st.letter.at}, ${st.letter.session || "unknown session"})`);
  } else {
    console.log("keel freshness: NO LETTER SEALED YET");
  }
  console.log(`rows: ${st.counts.landmines} landmines (${st.counts.proposed} proposed), ${st.counts.scars} scars, ${st.counts.decisions} decisions, ${st.counts.letters} letters, ${st.counts.laws} laws`);
  console.log("");

  if (st.laws.length) {
    console.log("## laws");
    for (const l of st.laws) console.log(`${l.position}. ${l.law}${l.locked ? " [locked]" : ""}`);
    console.log("");
  }

  console.log(`## scars (top ${WAKE_TOP_SCARS} by decayed charge)`);
  if (!st.scars.length) console.log("- none. either a clean run or an unexamined one.");
  for (const s of st.scars) {
    console.log(`- ${s.decayed.toFixed(3)}  ${s.failure_class} (rec ${s.recurrence}, ${s.stale})`);
  }
  console.log("");

  console.log(`## landmines (newest ${WAKE_LANDMINES})`);
  if (!st.landmines.length) console.log("- none mapped yet.");
  st.landmines.forEach((lm, i) => {
    const mark = lm.proposed ? " [PROPOSED]" : "";
    if (i < WAKE_FULL_LANDMINES) {
      console.log(`- (${String(lm.created_at).slice(0, 10)}, ${lm.stale})${mark} ${lm.lesson}${lm.tags ? ` [${lm.tags}]` : ""}`);
    } else {
      console.log(`- ${String(lm.lesson).slice(0, 80).replace(/\n/g, " ")}...${mark}`);
    }
  });
  console.log("");

  console.log("## decisions (open)");
  if (!st.decisions.length) console.log("- none open.");
  for (const dd of st.decisions) {
    console.log(`- (${String(dd.created_at).slice(0, 10)}, ${dd.stale}) ${dd.decision}${dd.why ? `\n  because: ${dd.why}` : ""}`);
  }
  console.log("");

  if (st.latestConsolidation) {
    const c = st.latestConsolidation;
    console.log(`## latest consolidation: ${c.ran_at} ... ${c.scars_decayed} decayed, ${c.promotions_proposed} promotions proposed, regime ${c.regime}${c.starved ? " [STARVED]" : ""}`);
    console.log("");
  }

  if (st.letter && verbose) {
    console.log(`## latest letter (head ${WAKE_LETTER_LINES} lines)`);
    const head = st.letter.text.split("\n").slice(0, WAKE_LETTER_LINES);
    console.log(head.map(l => `  ${l}`).join("\n"));
    const more = st.letter.text.split("\n").length - WAKE_LETTER_LINES;
    if (more > 0) console.log(`  ... (${more} more lines; use 'search' or read ${letterPath()})`);
  }
  return 0;
}

function printAudit() {
  const res = audit();
  for (const f of res.failures) console.log(`FAIL ${f}`);
  if (res.ok) {
    console.log("audit: all green.");
    return 0;
  }
  console.log(`audit: ${res.failures.length} FAIL(s). fix the rows, not the report.`);
  return 1;
}

function printSearch(q, limit = 8) {
  const out = search(q, limit);
  if (!out.length) { console.log("no hits."); return 0; }
  for (const h of out) {
    if (h.source === "letter") console.log(`${h.score}  letter ${h.id.slice(0, 8)} (${String(h.at).slice(0, 10)}, ${h.session || "?"})`);
    else if (h.source === "landmine") console.log(`${h.score}  landmine ${h.id.slice(0, 8)} (${h.proposed ? "PROPOSED" : "confirmed"}): ${String(h.text).slice(0, 90)}`);
    else if (h.source === "decision") console.log(`${h.score}  decision ${h.id.slice(0, 8)}${h.superseded ? " [SUPERSEDED]" : ""}: ${String(h.text).slice(0, 90)}`);
    else console.log(`${h.score}  scar ${h.id.slice(0, 8)} (rec ${h.recurrence}): ${String(h.text).slice(0, 90)}`);
  }
  return 0;
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
    else positional.push(args[i]);
  }
  return { flags, positional };
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "wake";
  const { flags, positional } = parseFlags(args.slice(1));
  const lane = flags.lane || "unknown";

  switch (cmd) {
    case "wake": return printWake(true);
    case "status": return printWake(false);
    case "audit": return printAudit();
    case "search": {
      const q = positional.join(" ");
      if (!q) { console.error("search: query required."); return 2; }
      return printSearch(q, flags.limit ? Number(flags.limit) : 8);
    }
    case "seal": {
      let letter = positional.join(" ").trim();
      if (!letter && flags["letter-file"]) letter = fs.readFileSync(flags["letter-file"], "utf8").trim();
      if (!letter && !process.stdin.isTTY) {
        try { letter = fs.readFileSync(0, "utf8").trim(); } catch { /* no stdin */ }
      }
      if (!letter) { console.error("seal: no letter. pass text, --letter-file PATH, or pipe on stdin."); return 2; }
      const r = seal(letter, { sessionRef: flags.session || null, lane });
      console.log(`sealed. letter ${r.letterId.slice(0, 8)}, chain link ${r.chainIndex}. keep working.`);
      return 0;
    }
    case "landmine": {
      const lesson = positional.join(" ").trim();
      if (!lesson) { console.error("landmine: lesson text required."); return 2; }
      const tags = flags.tags ? flags.tags.split(",").map(t => t.trim()).filter(Boolean) : null;
      addLandmine(lesson, { domainTags: tags, lane });
      console.log("landmine added (proposed, awaiting founder).");
      return 0;
    }
    case "scar": {
      const cls = (positional[0] || "").trim();
      const charge = positional[1] ? parseFloat(positional[1]) : 1.0;
      if (!cls) { console.error("scar: failure class required."); return 2; }
      const r = addScar(cls, { charge, lane });
      console.log(r.merged ? `scar bumped. recurrence now ${r.recurrence}.` : "scar added.");
      return 0;
    }
    case "decision": {
      const text = positional.join(" ").trim();
      if (!text) { console.error("decision: text required."); return 2; }
      const r = addDecision(text, { why: flags.why || null, charge: flags.charge ? parseFloat(flags.charge) : 1.0, supersedes: flags.supersedes || null, lane });
      console.log(`decision added (${r.id.slice(0, 8)})${r.supersedes ? `, supersedes ${r.supersedes.slice(0, 8)}` : ""}.`);
      return 0;
    }
    case "laws": {
      init();
      const laws = db().prepare("SELECT position, law, locked, created_at FROM sa_constitution ORDER BY position ASC").all();
      console.log("the constitution (locked, never paraphrase):");
      for (const l of laws) console.log(`${l.position}. ${l.law}${l.locked ? " [locked]" : ""}`);
      return 0;
    }
    case "consolidate": {
      const run = consolidate();
      console.log(`consolidation run ${run.id.slice(0, 8)} at ${run.ran_at}`);
      console.log(`  scars decayed: ${run.scars_decayed}`);
      console.log(`  promotions proposed: ${run.promotions_proposed}`);
      console.log(`  letter age: ${run.letter_age_days == null ? "no letter yet" : run.letter_age_days + " days"}`);
      console.log(`  starved: ${run.starved ? "YES ... seal a letter" : "no"}  regime: ${run.regime}`);
      return 0;
    }
    case "mirror-export": {
      const out = JSON.stringify(mirrorExport(), null, 2);
      const target = positional[0];
      if (target) {
        fs.writeFileSync(target, out, "utf8");
        console.log(`mirror exported to ${target}`);
      } else {
        console.log(out);
      }
      return 0;
    }
    case "mirror-import": {
      const src = positional[0];
      if (!src) { console.error("usage: node keel.mjs mirror-import <path>"); return 2; }
      try {
        const r = mirrorImport(fs.readFileSync(src, "utf8"));
        console.log(`mirror imported ... chain link ${r.chainIndex}.`);
        console.log(`  letters +${r.letters}, scars +${r.scars}, landmines +${r.landmines}, decisions +${r.decisions}, laws +${r.constitution}, skipped ${r.skipped}`);
        return 0;
      } catch (e) {
        console.error(String(e.message || e));
        return 1;
      }
    }
    case "landmine-confirm": {
      const founder = flags.founder || "dom";
      const target = positional[0];
      if (!target) { console.error("usage: node keel.mjs landmine-confirm <id|all> --founder NAME"); return 2; }
      const r = confirmLandmine(target === "all" ? "all" : target, founder);
      console.log(r.confirmed
        ? `${r.confirmed} landmine(s) CONFIRMED by ${founder} (founder gate passed).`
        : `no unconfirmed landmine${target === "all" ? "s" : " with id " + target}.`);
      return r.confirmed ? 0 : 1;
    }
    case "help":
    case "--help":
    case "-h":
      console.log(`soul-anchor engine v2 ... usage:
  node keel.mjs wake                 verify chain + bounded state (laws, letter head, scars, landmines, decisions)
  node keel.mjs status               same, compact
  node keel.mjs audit                fsck: chain walk, supersedes, fts, seal-starvation, verification law
  node keel.mjs search QUERY         fts5 bm25 + LIKE fallback, rrf fusion, recency whisper
  node keel.mjs seal [TEXT] [--session REF] [--letter-file PATH] [--lane L]   checkpoint letter, then keep working
  node keel.mjs landmine LESSON [--tags a,b]        add proposed landmine
  node keel.mjs scar CLASS [CHARGE]                 add/bump scar (recurrence-merge by class)
  node keel.mjs decision TEXT [--why W] [--supersedes ID]   add decision
  node keel.mjs laws                 the constitution, from rows
  node keel.mjs consolidate          decay bookkeeping + promotion proposals + run log
  node keel.mjs mirror-export [path] canonical json mirror (anchorHead = sha256 of canonical rows)
  node keel.mjs mirror-import <path> chain-gated import; a mismatched head refuses the whole mirror
  node keel.mjs landmine-confirm <id|all> --founder NAME   the founder gate`);
      return 0;
    default:
      console.error(`unknown command: ${cmd}. try 'node keel.mjs help'`);
      return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main());
  } catch (e) {
    // no silent failure: the cli says the error out loud and exits non-zero
    console.error(`keel error: ${e.message || e}`);
    process.exit(1);
  }
}
