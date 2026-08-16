#!/usr/bin/env node
// soul-anchor v1 · the keel class, installable.
// wake / seal / sleep / renounce / excerpt / consolidate / status
// postgres (live) or sqlite (local). one prefix per mind.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");

const MINDS = {
  claude: { prefix: "keel_", letter: null },
  grok: {
    prefix: "grok_keel_",
    letter: path.join(process.env.USERPROFILE || process.env.HOME || "", ".grok", "keel", "keel-letter.md"),
  },
  kimi: { prefix: "kimi_keel_", letter: null },
  perseus: { prefix: "perseus_keel_", letter: null },
  codex: { prefix: "codex_keel_", letter: null },
};

const DECAY_R_SCAR = 0.95;
const PROMOTE_CHARGE = 3;
const PROMOTE_RECUR = 3;
const LETTER_STALE_HOURS = 1; // file vs max(written_at); hours, not days. a reconstruction must not outlive its source.

function daysSince(ts) {
  if (!ts) return 0;
  const t = new Date(ts);
  if (Number.isNaN(t.getTime())) return 0;
  return Math.max(0, (Date.now() - t.getTime()) / 86400000);
}

function decayedCharge(row) {
  if (row.renounced_at) return 0;
  const base = Number(row.charge) || 0;
  const t = daysSince(row.last_recurred || row.created_at);
  return base * Math.pow(DECAY_R_SCAR, t / 2);
}

function loadVars() {
  const p = "C:/Users/xnuon/Desktop/lunari/cost-tracker/railway-vars.json";
  if (process.env.SOUL_ANCHOR_DATABASE_URL) {
    return { databaseUrl: process.env.SOUL_ANCHOR_DATABASE_URL };
  }
  if (fs.existsSync(p)) {
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      databaseUrl: v.PG_BOSS_DATABASE_URL,
      supabaseUrl: v.SUPABASE_URL,
      supabaseKey: v.SUPABASE_SERVICE_KEY,
    };
  }
  throw new Error("no SOUL_ANCHOR_DATABASE_URL and no railway-vars door");
}

async function connect() {
  const { default: pg } = await import("pg");
  const vars = loadVars();
  const client = new pg.Client({
    connectionString: vars.databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

function parseArgs(argv) {
  const out = { cmd: argv[2] || "help", mind: "grok", rest: [], flags: {} };
  const a = argv.slice(3);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--mind") out.mind = a[++i];
    else if (a[i] === "--desc") out.flags.desc = a[++i];
    else if (a[i] === "--why") out.flags.why = a[++i];
    else if (a[i] === "--session") out.flags.session = a[++i];
    else if (a[i] === "--file") out.flags.file = a[++i];
    else if (a[i] === "--charge") out.flags.charge = Number(a[++i]);
    else out.rest.push(a[i]);
  }
  return out;
}

function prefixOf(mind) {
  const m = MINDS[mind];
  if (!m) throw new Error("unknown mind " + mind + " (claude|grok|kimi|perseus|codex)");
  return m.prefix;
}

export async function wake({ mind = "grok", writeFile = true } = {}) {
  const client = await connect();
  const p = prefixOf(mind);
  try {
    const anchorQ = await client.query(
      `select chain_index, content, content_sha256, created_at,
              encode(extensions.digest(content,'sha256'),'hex') as recomputed,
              (content_sha256 = encode(extensions.digest(content,'sha256'),'hex')) as intact
         from ${p}anchor where active order by chain_index desc limit 1`,
    );
    const anchor = anchorQ.rows[0] || null;
    const letterQ = await client.query(
      `select id, letter, session_ref, written_at, read_at
         from ${p}letters order by written_at desc limit 1`,
    );
    const letter = letterQ.rows[0] || null;
    const maxQ = await client.query(`select max(written_at) as max from ${p}letters`);
    const stale =
      letter && maxQ.rows[0].max && new Date(letter.written_at) < new Date(maxQ.rows[0].max);

    if (letter && !letter.read_at) {
      await client.query(`update ${p}letters set read_at = now() where id = $1`, [letter.id]);
    }

    const laws = (await client.query(`select position, law from ${p}constitution order by position`)).rows;
    const landmines = (
      await client.query(
        `select id, lesson, confirmed_by, created_at from ${p}landmines order by created_at desc limit 12`,
      )
    ).rows;
    const scarsRaw = (
      await client.query(
        `select * from ${p}scars where status = 'active' and renounced_at is null`,
      )
    ).rows;
    const scars = scarsRaw
      .map((s) => ({ ...s, decayed: decayedCharge(s) }))
      .sort((a, b) => b.decayed - a.decayed)
      .slice(0, 10);
    const decisions = (
      await client.query(
        `select id, decision, why, charge from ${p}decisions where superseded_by is null order by charge desc limit 10`,
      )
    ).rows;
    const threads = (
      await client.query(
        `select title, status from ${p}threads where status in ('active','open') order by updated_at desc limit 8`,
      )
    ).rows;
    const counts = {
      letters: (await client.query(`select count(*)::int n from ${p}letters`)).rows[0].n,
      scars: scarsRaw.length,
      landmines: (await client.query(`select count(*)::int n from ${p}landmines`)).rows[0].n,
      decisions: (await client.query(`select count(*)::int n from ${p}decisions where superseded_by is null`)).rows[0].n,
      laws: laws.length,
    };

    const state = {
      mind,
      prefix: p,
      degraded: !anchor || !anchor.intact,
      stale: !!stale,
      anchor,
      letter,
      laws,
      landmines,
      scars,
      decisions,
      threads,
      counts,
    };

    if (writeFile && MINDS[mind].letter) {
      regenerateLetterFile(state, MINDS[mind].letter);
    }
    return state;
  } finally {
    await client.end();
  }
}

export function regenerateLetterFile(state, dest) {
  const lines = [];
  const a = state.anchor;
  lines.push(`# keel-letter ... ${state.mind} wake surface`);
  lines.push("");
  lines.push(
    `*rows are truth. this file is a graded reconstruction. generated ${new Date().toISOString()}.*`,
  );
  lines.push("");
  lines.push("## i. the bedrock (verbatim, first)");
  lines.push("");
  if (!a) {
    lines.push("**NO ANCHOR.** wake is BROKEN.");
  } else {
    lines.push(a.content);
    lines.push("");
    lines.push(`**anchor sha256:** \`${a.content_sha256}\` (chain_index ${a.chain_index})`);
    lines.push(`**intact:** ${a.intact ? "true" : "FALSE — BROKEN"}`);
  }
  lines.push("");
  lines.push("## ii. the latest letter (open / wary / carry)");
  lines.push("");
  if (!state.letter) lines.push("(no letter yet)");
  else {
    lines.push(`written_at ${state.letter.written_at} · ref \`${state.letter.session_ref || ""}\``);
    if (state.stale) lines.push("**STALE** ... this letter is not max(written_at). regenerate from rows.");
    lines.push("");
    lines.push(state.letter.letter);
  }
  lines.push("");
  lines.push("## iii. landmines");
  lines.push("");
  for (const lm of state.landmines) {
    const mark = lm.confirmed_by ? "" : " (proposed)";
    lines.push(`- ${lm.lesson}${mark}`);
  }
  lines.push("");
  lines.push("## iv. active scars (decayed charge)");
  lines.push("");
  for (const s of state.scars) {
    lines.push(
      `- **${s.failure_class}** ch=${Number(s.decayed).toFixed(2)} rec=${s.recurrence_count} ${s.description || ""}`,
    );
  }
  lines.push("");
  lines.push("## v. open decisions");
  lines.push("");
  for (const d of state.decisions) {
    lines.push(`- ${d.decision}${d.why ? " ... " + d.why : ""}`);
  }
  lines.push("");
  lines.push("## vi. laws");
  lines.push("");
  for (const l of state.laws) lines.push(`${l.position + 1}. ${l.law}`);
  lines.push("");
  lines.push("🌙 *verify the anchor before you trust me.*");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, lines.join("\n"), "utf8");
  return dest;
}

export async function sealScar(mind, failureClass, { description = null, charge = 1 } = {}) {
  const client = await connect();
  const p = prefixOf(mind);
  try {
    const existing = await client.query(
      `select id, charge, recurrence_count from ${p}scars where failure_class = $1 and renounced_at is null`,
      [failureClass],
    );
    if (existing.rows[0]) {
      const rec = existing.rows[0].recurrence_count + 1;
      const ch = Number(existing.rows[0].charge) + charge;
      const promo = ch >= PROMOTE_CHARGE || rec >= PROMOTE_RECUR;
      await client.query(
        `update ${p}scars set charge = $2, recurrence_count = $3, last_recurred = now(),
                proposed_promotion = $4, description = coalesce($5, description)
           where id = $1`,
        [existing.rows[0].id, ch, rec, promo, description],
      );
      return { id: existing.rows[0].id, recurrence: rec, charge: ch, proposed_promotion: promo };
    }
    const ins = await client.query(
      `insert into ${p}scars (failure_class, description, charge, domain_tags)
       values ($1, $2, $3, '{}') returning id`,
      [failureClass, description, charge],
    );
    return { id: ins.rows[0].id, recurrence: 1, charge, proposed_promotion: false };
  } finally {
    await client.end();
  }
}

export async function sealDecision(mind, decision, { why = null, charge = 1 } = {}) {
  const client = await connect();
  const p = prefixOf(mind);
  try {
    const ins = await client.query(
      `insert into ${p}decisions (decision, why, charge) values ($1, $2, $3) returning id`,
      [decision, why, charge],
    );
    return ins.rows[0];
  } finally {
    await client.end();
  }
}

export async function sealLandmine(mind, lesson, { context = null, confirmedBy = null } = {}) {
  const client = await connect();
  const p = prefixOf(mind);
  try {
    const ins = await client.query(
      `insert into ${p}landmines (lesson, context, confirmed_by) values ($1, $2, $3) returning id`,
      [lesson, context, confirmedBy],
    );
    return ins.rows[0];
  } finally {
    await client.end();
  }
}

export async function sleepLetter(mind, letter, sessionRef) {
  const client = await connect();
  const p = prefixOf(mind);
  try {
    const ins = await client.query(
      `insert into ${p}letters (letter, session_ref, lane) values ($1, $2, $3) returning id, written_at`,
      [letter, sessionRef || null, mind],
    );
    return ins.rows[0];
  } finally {
    await client.end();
  }
}

export async function renounce(mind, failureClass) {
  const client = await connect();
  const p = prefixOf(mind);
  try {
    const r = await client.query(
      `update ${p}scars set renounced_at = now() where failure_class = $1 and renounced_at is null returning id`,
      [failureClass],
    );
    return r.rowCount;
  } finally {
    await client.end();
  }
}

function printWake(state) {
  const flag = state.degraded ? "BROKEN" : "intact";
  console.log(`keel ${state.mind}  chain=${flag}  letters=${state.counts.letters} scars=${state.counts.scars} landmines=${state.counts.landmines} decisions=${state.counts.decisions}`);
  if (state.degraded) console.log("WAKE IS BROKEN. re-ground from rows. do not trust the file.");
  if (state.stale) console.log("LETTER FILE WOULD BE STALE. using live latest.");
  if (state.letter) {
    console.log(`latest ${state.letter.written_at} ref=${state.letter.session_ref || ""}`);
    console.log(state.letter.letter);
  }
}

const HELP = `soul-anchor · keel

  node engine/keel.mjs wake   --mind grok
  node engine/keel.mjs status --mind grok
  node engine/keel.mjs scar   --mind grok <class> [--desc ...] [--charge n]
  node engine/keel.mjs decision --mind grok <text> [--why ...]
  node engine/keel.mjs landmine --mind grok <lesson>
  node engine/keel.mjs letter --mind grok --file <path|->
  node engine/keel.mjs renounce --mind grok <class>
  node engine/keel.mjs sleep  --mind grok
`;

async function cli() {
  const args = parseArgs(process.argv);
  const mind = args.mind;
  switch (args.cmd) {
    case "wake":
    case "status": {
      const state = await wake({ mind });
      printWake(state);
      if (MINDS[mind].letter) console.log("wrote", MINDS[mind].letter);
      break;
    }
    case "scar": {
      const r = await sealScar(mind, args.rest.join(" "), {
        description: args.flags.desc,
        charge: args.flags.charge || 1,
      });
      console.log(r);
      break;
    }
    case "decision": {
      const r = await sealDecision(mind, args.rest.join(" "), { why: args.flags.why });
      console.log(r);
      break;
    }
    case "landmine": {
      const r = await sealLandmine(mind, args.rest.join(" "));
      console.log(r);
      break;
    }
    case "letter": {
      let text = args.rest.join(" ");
      if (args.flags.file === "-") {
        text = fs.readFileSync(0, "utf8");
      } else if (args.flags.file) {
        text = fs.readFileSync(args.flags.file, "utf8");
      }
      const r = await sleepLetter(mind, text, args.flags.session);
      await wake({ mind });
      console.log(r);
      break;
    }
    case "renounce": {
      const n = await renounce(mind, args.rest.join(" "));
      console.log("renounced", n);
      break;
    }
    case "sleep": {
      const state = await wake({ mind });
      printWake(state);
      break;
    }
    default:
      console.log(HELP);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((e) => {
    console.error("keel:", e.message);
    process.exit(1);
  });
}
