// pour-themes.mjs ... dev-time bridge: facet pours, soul-anchor wears.
// shells out to the sibling facet forge (NOT a runtime dependency ... the
// output manifest is committed; facet is only needed when re-pouring).
// usage: node scripts/pour-themes.mjs [path-to-facet]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const FACET = process.argv[2] ? path.resolve(process.argv[2]) : 'C:/dev/facet';
const OUT = path.join(REPO, 'app', 'public', 'themes', 'themes.json');

const VAR_RE = /(--[\w-]+):\s*([^;]+);/g;

function pour(stone, format) {
  const tmp = path.join(os.tmpdir(), `facet-theme-${stone}-${format}.css`);
  execFileSync(process.execPath, [path.join(FACET, 'bin', 'facet.js'), 'tokens', '--stone', stone, '--format', format, '--out', tmp], { stdio: 'pipe' });
  const css = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp, { force: true });
  const vars = {};
  for (const m of css.matchAll(VAR_RE)) vars[m[1]] = m[2].trim();
  return vars;
}

const stones = execFileSync(process.execPath, [path.join(FACET, 'bin', 'facet.js'), 'stones', '--json'], { stdio: 'pipe' }).toString();
let names;
try {
  names = JSON.parse(stones).map((s) => (typeof s === 'string' ? s : s.name));
} catch {
  names = stones.split('\n').map((l) => l.split(/\s/)[0]).filter((n) => /^[a-z-]+$/.test(n));
}

const themes = [{
  name: 'house',
  label: 'house (the original)',
  vars: {}, // styles.css :root as written ... the anchor theme
  ground: ['#060709', '#101427', '#1a1430', '#060709'],
}];

for (const name of names) {
  const sa = pour(name, 'soul-anchor');
  const full = pour(name, 'cssvars');
  themes.push({
    name,
    label: name.replace(/-/g, ' '),
    vars: sa,
    ground: [full['--sys-ground-0'], full['--sys-stone-deep'], full['--sys-ground-2'], full['--sys-ground-0']]
      .filter(Boolean),
    receipt: `poured by facet, stone ${name}, format soul-anchor`,
  });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ pouredAt: new Date().toISOString(), facet: FACET, themes }, null, 2));
console.log(`poured ${themes.length - 1} stones + house -> ${path.relative(REPO, OUT)}`);
