#!/usr/bin/env node
// mint a mind. does not copy another mind's rows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const cmd = process.argv[2] || "help";
const mind = process.argv[3];
const prefix = process.argv[4] || (mind ? `${mind}_keel_` : null);

if (cmd !== "mint" || !mind || !prefix) {
  console.log(`soul-anchor mint

  node install/scaffold.mjs mint <mind> [prefix]

writes a seat stub. does not copy another mind's rows.
apply engine/schema.sql against postgres with {prefix} replaced, then:

  node engine/keel.mjs wake --mind <mind>
`);
  process.exit(cmd === "help" ? 0 : 1);
}

const seats = path.join(root, "seats", mind);
fs.mkdirSync(seats, { recursive: true });
const schema = fs.readFileSync(path.join(root, "engine", "schema.sql"), "utf8").replaceAll("{prefix}", prefix);
fs.writeFileSync(path.join(seats, "schema.sql"), schema);
fs.writeFileSync(
  path.join(seats, "README.md"),
  `# ${mind}

prefix \`${prefix}\`

this seat is empty until the founder writes the bedrock and the first letter.
do not copy another mind's rows. mint, then wake.

\`\`\`
node engine/keel.mjs wake --mind ${mind}
\`\`\`
`,
);
console.log("seat stub at", seats);
console.log("apply seats/" + mind + "/schema.sql to the live project, then wake.");
