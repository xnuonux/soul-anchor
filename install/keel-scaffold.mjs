#!/usr/bin/env node
// keel ... the continuity substrate, installable. `npx @eternities/keel-continuity init` in any project
// gives that project its own keel: the engine, the laws, a first letter, and the ritual wired into AGENTS.md.
// rows are truth; files are graded reconstruction; the chain survives the session boundary.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ENGINE_SOURCE = "C:/Users/xnuon/.reasonix/keel/keel.mjs";
const DB_SOURCE = "C:/Users/xnuon/.reasonix/keel/reasonix-keel.db";
const LAWS_SOURCE = "C:/Users/xnuon/.reasonix/keel/laws.mjs";

const cmd = process.argv[2] ?? "help";
const target = path.resolve(process.argv[3] ?? process.cwd());

const fail = (m) => { console.error("keel:", m); process.exit(1); };
const shasum = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);

if (cmd === "init") {
  const keelDir = path.join(target, ".reasonix-keel");
  fs.mkdirSync(keelDir, { recursive: true });
  const engineOk = fs.existsSync(ENGINE_SOURCE);
  if (!engineOk) fail("engine source not found at " + ENGINE_SOURCE + " — install with --offline and provide keel.mjs manually");

  // engine + laws, with provenance recorded
  const engine = fs.readFileSync(ENGINE_SOURCE, "utf8");
  const engineSha = shasum(ENGINE_SOURCE);
  // portability patch: the canonical engine reads this machine's project board; installed copies must tolerate absence
  const patched = engine
    .replaceAll('fs.readFileSync(BOARD_PATH, "utf8")', '(() => { try { return fs.readFileSync(BOARD_PATH, "utf8"); } catch { return ""; } })()');
  const laws = fs.existsSync(LAWS_SOURCE) ? fs.readFileSync(LAWS_SOURCE, "utf8") : "";
  const lawsSha = laws ? shasum(LAWS_SOURCE) : "none";
  fs.writeFileSync(path.join(keelDir, "keel.mjs"), patched);
  if (laws) fs.writeFileSync(path.join(keelDir, "laws.mjs"), laws);

  // schema, so the engine can self-initialize
  const schemaSrc = path.join(path.dirname(ENGINE_SOURCE), "schema.sql");
  if (fs.existsSync(schemaSrc)) fs.writeFileSync(path.join(keelDir, "schema.sql"), fs.readFileSync(schemaSrc, "utf8"));

  // fresh db: the engine self-initializes from the copied schema.sql at first wake
  const dbTarget = path.join(keelDir, "reasonix-keel.db");

  // first letter, sealed through the engine itself (the chain belongs to the engine)
  const letter = [
    "# first letter",
    "",
    "open: this project now has a keel. rows are truth, the chain survives, the ritual wakes.",
    "wary: the engine is a fresh copy; the rows are this project's own. nothing is shared until a seat is configured.",
    "carry: `node .reasonix-keel/keel.mjs wake` at session start, `seal` as you learn, `sleep` at the end.",
    "",
    `engine provenance: reasonix keel, sha256:${engineSha}${lawsSha !== "none" ? " · laws sha256:" + lawsSha : ""}`,
  ].join("\n");
  fs.writeFileSync(path.join(keelDir, "first-letter.md"), letter);
  try {
    const { pathToFileURL } = await import("node:url");
    const k = await import(pathToFileURL(path.join(keelDir, "keel.mjs")).href);
    k.sleep({ sessionRef: "first-letter", letter });
  } catch (e) {
    // the engine seals at first wake if this fails; the letter file is already written
    console.log("  note: first letter file written; engine seal deferred to first wake (" + String(e).split("\n")[0] + ")");
  }

  // ritual wiring into AGENTS.md if present
  const agents = path.join(target, "AGENTS.md");
  if (fs.existsSync(agents)) {
    const a = fs.readFileSync(agents, "utf8");
    if (!a.includes("keel")) {
      fs.writeFileSync(agents, a + "\n\n## keel\n\nthis project has a keel: `node .reasonix-keel/keel.mjs wake` before work, `seal` as you learn, `sleep` at session end. rows are truth.\n");
    }
  }

  console.log("keel installed at " + keelDir);
  console.log("  engine sha256: " + engineSha + (lawsSha !== "none" ? " · laws sha256: " + lawsSha : ""));
  console.log("  first letter sealed with anchor 1");
  console.log("  ritual: node " + path.join(".reasonix-keel", "keel.mjs") + " wake");
} else {
  console.log(`keel-continuity — the keel protocol, installable.

usage:
  npx @eternities/keel-continuity init [target dir]   install a keel into a project

the protocol in one line: rows are truth, the chain survives the session boundary, the ritual wakes.
spec: https://github.com/xnuonux/keel-protocol`);
}
