// soul-anchor engine v2 ... node:test suite.
// each test gets a fresh temp data dir via SOUL_ANCHOR_HOME and runs the engine
// in a subprocess, so the db singleton and env overrides behave like production.
// run: node --test engine/  (from the repo root)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENGINE_URL = new URL("./keel.mjs", import.meta.url).href;

const tmpDirs = [];
function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-test-"));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* wal handles may linger on windows; temp dir, harmless */ }
  }
});

// run engine code in a subprocess. the body has `m` (the engine module) and `fs` in scope.
// body must end by console.log(JSON.stringify(...)) for out() to parse.
function runEng(home, body, { expectFail = false } = {}) {
  const script = [
    "import fs from 'node:fs';",
    `const m = await import(${JSON.stringify(ENGINE_URL)});`,
    body,
  ].join("\n");
  const res = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, SOUL_ANCHOR_HOME: home },
    encoding: "utf8",
  });
  if (!expectFail && res.status !== 0) {
    throw new Error(`engine subprocess failed (exit ${res.status}):\n${res.stderr}\n${res.stdout}`);
  }
  return res;
}

function out(res) {
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function openDb(home) {
  return new DatabaseSync(path.join(home, "soul-anchor.db"));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// --- chain: seal 3 letters, walk verifies; tamper one row, wake says BROKEN ---
test("chain: seals extend a verifiable chain; tampering breaks it loudly", () => {
  const home = freshHome();
  const w = out(runEng(home, `
    m.seal("letter one ... the keel wakes", { sessionRef: "t1" });
    m.seal("letter two ... work in progress", { sessionRef: "t1" });
    m.seal("letter three ... closing the day", { sessionRef: "t2" });
    console.log(JSON.stringify(m.wake()));
  `));
  assert.equal(w.anchorOk, true);
  assert.equal(w.status, "INTACT");
  assert.equal(w.chainLength, 4); // genesis + 3 seals
  assert.equal(w.anchor.chainIndex, 3);

  // tamper: rewrite one anchor row's content directly, like an attacker or a bad disk
  const d = openDb(home);
  d.prepare("UPDATE sa_anchor SET content = content || ' ... rewritten' WHERE chain_index = 2").run();
  d.close();

  const w2 = out(runEng(home, `console.log(JSON.stringify(m.wake()));`));
  assert.equal(w2.anchorOk, false);
  assert.equal(w2.status, "BROKEN");
  assert.match(w2.chainReason, /link 2/);
});

// --- decay: charge 1 at 27 days ~= 0.5; floor clamps at 0.2 after long time ---
test("decay: scar charge decays r^(t/2) and the floor clamps", () => {
  const home = freshHome();
  const added = out(runEng(home, `
    const r = m.addScar("decay-probe", { charge: 1.0 });
    console.log(JSON.stringify(r));
  `));
  const d = openDb(home);
  d.prepare("UPDATE sa_scars SET last_seen = ? WHERE id = ?").run(isoDaysAgo(27), added.id);
  d.close();

  const w = out(runEng(home, `console.log(JSON.stringify(m.wake()));`));
  const scar = w.scars.find(s => s.failure_class === "decay-probe");
  assert.ok(scar, "scar should be in wake");
  assert.ok(Math.abs(scar.decayed - 0.5) < 0.02, `expected ~0.5, got ${scar.decayed}`);

  // long time: the floor clamps at 0.2, the scar never decays to invisible
  const d2 = openDb(home);
  d2.prepare("UPDATE sa_scars SET last_seen = ? WHERE id = ?").run(isoDaysAgo(500), added.id);
  d2.close();
  const w2 = out(runEng(home, `console.log(JSON.stringify(m.wake()));`));
  const scar2 = w2.scars.find(s => s.failure_class === "decay-probe");
  assert.equal(scar2.decayed, 0.2);
});

// --- recurrence: same failure_class twice bumps recurrence to 2 ---
test("recurrence: same failure_class merges and bumps recurrence", () => {
  const home = freshHome();
  const r = out(runEng(home, `
    m.addScar("silent-failure", { charge: 1.0 });
    const r2 = m.addScar("silent-failure", { charge: 1.0 });
    console.log(JSON.stringify(r2));
  `));
  assert.equal(r.merged, true);
  assert.equal(r.recurrence, 2);
  const d = openDb(home);
  const row = d.prepare("SELECT charge, recurrence FROM sa_scars WHERE failure_class = 'silent-failure'").get();
  d.close();
  assert.equal(row.recurrence, 2);
  assert.equal(row.charge, 2.0);
});

// --- verification law: verified without a method is refused ---
test("verification law: 'verified' with no method throws", () => {
  const home = freshHome();
  const res = runEng(home, `
    m.addScar("unproven-claim", { verification: "verified" });
    console.log(JSON.stringify({ sealed: true }));
  `, { expectFail: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /method/);

  // and the same law holds on landmines
  const res2 = runEng(home, `
    m.addLandmine("another unproven claim", { verification: "verified", method: null });
    console.log(JSON.stringify({ sealed: true }));
  `, { expectFail: true });
  assert.notEqual(res2.status, 0);

  // with a method named, it goes through
  const ok = out(runEng(home, `
    const r = m.addScar("proven-claim", { verification: "verified", method: "the test run is the citation" });
    console.log(JSON.stringify(r));
  `));
  assert.ok(ok.id);
});

// --- founder gate: landmine starts proposed; confirmLandmine sets confirmed_by ---
test("founder gate: landmines land proposed, the founder confirms", () => {
  const home = freshHome();
  const lm = out(runEng(home, `
    const r = m.addLandmine("never trust a silent exit code");
    console.log(JSON.stringify(r));
  `));
  assert.equal(lm.proposed, true);

  const before = out(runEng(home, `console.log(JSON.stringify(m.wake()));`));
  const row = before.landmines.find(l => l.id === lm.id);
  assert.equal(row.proposed, true);
  assert.equal(row.confirmed_by, null);

  const conf = out(runEng(home, `
    console.log(JSON.stringify(m.confirmLandmine(${JSON.stringify(lm.id)}, "dom")));
  `));
  assert.equal(conf.confirmed, 1);

  const afterW = out(runEng(home, `console.log(JSON.stringify(m.wake()));`));
  const row2 = afterW.landmines.find(l => l.id === lm.id);
  assert.equal(row2.proposed, false);
  assert.equal(row2.confirmed_by, "dom");

  // confirming 'all' when nothing is pending is a no-op, not a fake success
  const none = out(runEng(home, `console.log(JSON.stringify(m.confirmLandmine("all", "dom")));`));
  assert.equal(none.confirmed, 0);
});

// --- supersede: old row stays, superseded excluded from wake; self-supersede refused ---
test("supersede: superseded never deleted, cycles refused", () => {
  const home = freshHome();
  const ids = out(runEng(home, `
    const a = m.addDecision("store state in flat files", { why: "simplest thing" });
    const b = m.addDecision("store state in sqlite rows", { why: "rows are truth", supersedes: a.id });
    console.log(JSON.stringify({ a: a.id, b: b.id }));
  `));

  const w = out(runEng(home, `console.log(JSON.stringify(m.wake()));`));
  assert.ok(!w.decisions.some(dd => dd.id === ids.a), "superseded decision must be excluded from wake");
  assert.ok(w.decisions.some(dd => dd.id === ids.b), "the replacement is open");

  // the superseded row still exists, pointing at its replacement
  const d = openDb(home);
  const old = d.prepare("SELECT superseded_by FROM sa_decisions WHERE id = ?").get(ids.a);
  d.close();
  assert.equal(old.superseded_by, ids.b);

  // supersede to self is refused
  const res = runEng(home, `
    m.addDecision("a loop", { id: "self-loop-1", supersedes: "self-loop-1" });
    console.log(JSON.stringify({ sealed: true }));
  `, { expectFail: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /supersede itself/);

  // audit stays green on the healthy supersede graph
  const au = out(runEng(home, `console.log(JSON.stringify(m.audit()));`));
  assert.ok(!au.failures.some(f => /supersede/.test(f)), au.failures.join("; "));
});

// --- seal-starvation: substance without a seal fails audit; sealing fixes it ---
test("seal-starvation: unsealed substance fails audit, sealing a letter fixes it", () => {
  const home = freshHome();
  const a1 = out(runEng(home, `
    m.addScar("worked-without-sealing");
    console.log(JSON.stringify(m.audit()));
  `));
  assert.equal(a1.ok, false);
  assert.ok(a1.failures.some(f => /seal-as-you-go/.test(f)), a1.failures.join("; "));

  const a2 = out(runEng(home, `
    m.seal("checkpoint ... the scar above is this session's earning", { sessionRef: "t-starve" });
    console.log(JSON.stringify(m.audit()));
  `));
  assert.equal(a2.ok, true, a2.failures.join("; "));
});

// --- mirror: export, import into a fresh db, chain verifies, rows present; corruption refuses ---
test("mirror: export/import round-trips rows; a corrupted mirror is refused", () => {
  const homeA = freshHome();
  const exportFile = path.join(homeA, "mirror.json");
  runEng(homeA, `
    m.sleep({
      sessionRef: "mirror-source",
      lane: "test",
      letter: "sleep letter ... state of the world at session end",
      scars: [{ failure_class: "assumption-debugging", charge: 2.0, lane: "test" }],
      landmines: [{ lesson: "the frotz renderer eats frames", lane: "test" }],
      decisions: [{ decision: "node:sqlite over better-sqlite3", why: "zero deps is law", lane: "test" }],
    });
    m.seal("second letter ... kept working after the checkpoint", { sessionRef: "mirror-source" });
    const ex = m.mirrorExport();
    fs.writeFileSync(${JSON.stringify(exportFile)}, JSON.stringify(ex));
    console.log(JSON.stringify({ anchorHead: ex.anchorHead }));
  `);

  const homeB = freshHome();
  const imp = out(runEng(homeB, `
    const ex = JSON.parse(fs.readFileSync(${JSON.stringify(exportFile)}, "utf8"));
    const r = m.mirrorImport(ex);
    const w = m.wake();
    console.log(JSON.stringify({ r, anchorOk: w.anchorOk, counts: w.counts }));
  `));
  assert.equal(imp.anchorOk, true);
  assert.equal(imp.r.letters, 2);
  assert.equal(imp.r.scars, 1);
  assert.equal(imp.r.landmines, 1);
  assert.equal(imp.r.decisions, 1);
  assert.equal(imp.counts.letters, 2);
  assert.equal(imp.counts.scars, 1);

  // re-import is idempotent: everything dedupes
  const imp2 = out(runEng(homeB, `
    const ex = JSON.parse(fs.readFileSync(${JSON.stringify(exportFile)}, "utf8"));
    console.log(JSON.stringify(m.mirrorImport(ex)));
  `));
  assert.equal(imp2.letters, 0);
  assert.equal(imp2.scars, 0);
  assert.ok(imp2.skipped > 0);

  // corrupt the export: flip a letter, keep the head. the gate must refuse.
  const homeC = freshHome();
  const res = runEng(homeC, `
    const ex = JSON.parse(fs.readFileSync(${JSON.stringify(exportFile)}, "utf8"));
    ex.rows.letters[0].letter = ex.rows.letters[0].letter + " ... tampered in transit";
    m.mirrorImport(ex);
    console.log(JSON.stringify({ imported: true }));
  `, { expectFail: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /REFUSED/);
});

// --- search: fts (or LIKE fallback) finds rows by keyword ---
test("search: keyword finds landmines, letters, scars, decisions", () => {
  const home = freshHome();
  const hits = out(runEng(home, `
    m.sleep({
      sessionRef: "search-seed",
      letter: "the gribble protocol governs session handoff",
      landmines: [{ lesson: "the frotz renderer eats frames under load" }],
      scars: [{ failure_class: "quasar-cache-invalidation" }],
      decisions: [{ decision: "adopt the nebula indexing scheme", why: "locality" }],
    });
    console.log(JSON.stringify({
      frotz: m.search("frotz"),
      gribble: m.search("gribble"),
      quasar: m.search("quasar"),
      nebula: m.search("nebula"),
    }));
  `));
  assert.ok(hits.frotz.some(h => h.source === "landmine"), JSON.stringify(hits.frotz));
  assert.ok(hits.gribble.some(h => h.source === "letter"), JSON.stringify(hits.gribble));
  assert.ok(hits.quasar.some(h => h.source === "scar"), JSON.stringify(hits.quasar));
  assert.ok(hits.nebula.some(h => h.source === "decision"), JSON.stringify(hits.nebula));
});

// --- consolidate: decay bookkeeping, promotion proposals, starvation flag ---
test("consolidate: logs a run, proposes promotions for hot recurring scars", () => {
  const home = freshHome();
  runEng(home, `
    m.addScar("cool-old-scar", { charge: 1.0 });
    m.addScar("hot-recurring", { charge: 2.0 });
    m.addScar("hot-recurring", { charge: 2.0 });
    m.addScar("hot-recurring", { charge: 2.0 });
    console.log(JSON.stringify({ ok: true }));
  `);
  // backdate the cool scar so decay has something to bite on ... a fresh scar moves nothing
  {
    const d = openDb(home);
    d.prepare("UPDATE sa_scars SET last_seen = ? WHERE failure_class = 'cool-old-scar'").run(isoDaysAgo(60));
    d.close();
  }
  const run = out(runEng(home, `
    const run = m.consolidate();
    console.log(JSON.stringify(run));
  `));
  assert.equal(run.regime, "provisional");
  assert.equal(run.promotions_proposed, 1); // recurrence 3, charge 6, fresh
  assert.ok(run.scars_decayed >= 1); // the backdated cool scar decayed from 1.0 (floor clamped)
  assert.equal(run.starved, 1); // scars written, no letter sealed

  const d = openDb(home);
  const hot = d.prepare("SELECT proposed_promotion FROM sa_scars WHERE failure_class = 'hot-recurring'").get();
  const cool = d.prepare("SELECT proposed_promotion FROM sa_scars WHERE failure_class = 'cool-old-scar'").get();
  d.close();
  assert.equal(hot.proposed_promotion, 1);
  assert.equal(cool.proposed_promotion, 0);
});
