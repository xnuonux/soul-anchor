// soul-anchor vault ... the obsidian-killer core, zero-dep.
// plain markdown files under data/vault/ ... a real obsidian vault, openable
// in the desktop app, but indexed here for the constellation: wikilinks,
// backlinks, tags, phantom notes. files are truth; the index is rebuilt
// from them on every read. no cache to lie with.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_ROOT = process.env.SOUL_ANCHOR_VAULT
  ? path.resolve(process.env.SOUL_ANCHOR_VAULT)
  : path.resolve(__dirname, '..', 'data', 'vault');

const MAX_NOTE_BYTES = 512 * 1024;
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const TAG_RE = /(?:^|\s)#([a-z0-9][a-z0-9-_/]*)/gi;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

// --- frontmatter: a yaml subset, zero-dep. scalars, inline lists, dash
// lists. no nesting, no anchors, no multiline strings ... obsidian reads
// this fine, and anything fancier is a footgun in a zero-dep engine.
function parseYamlValue(raw) {
  const v = raw.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseYamlValue(item));
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { properties: {}, body: content };
  const properties = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && lastKey) {
      if (!Array.isArray(properties[lastKey])) properties[lastKey] = [];
      properties[lastKey].push(parseYamlValue(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      properties[kv[1]] = parseYamlValue(kv[2]);
    }
  }
  return { properties, body: content.slice(m[0].length) };
}

export function serializeFrontmatter(properties) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(properties)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else if (value === null || value === undefined) {
      lines.push(`${key}: null`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

// --- path law: the vault is a jail. no absolute paths, no '..', .md only.
export function resolveNotePath(rel) {
  if (typeof rel !== 'string' || rel.trim().length === 0) {
    throw Object.assign(new Error('path must be a non-empty string'), { status: 400 });
  }
  let clean = rel.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean.toLowerCase().endsWith('.md')) clean += '.md';
  const abs = path.resolve(VAULT_ROOT, clean);
  const rootWithSep = VAULT_ROOT.endsWith(path.sep) ? VAULT_ROOT : VAULT_ROOT + path.sep;
  if (abs !== VAULT_ROOT && !abs.startsWith(rootWithSep)) {
    throw Object.assign(new Error('path escapes the vault'), { status: 400 });
  }
  if (path.basename(abs).startsWith('.')) {
    throw Object.assign(new Error('dotfiles are not notes'), { status: 400 });
  }
  return abs;
}

export function relFromAbs(abs) {
  return path.relative(VAULT_ROOT, abs).split(path.sep).join('/');
}

function noteName(rel) {
  return rel.replace(/\.md$/i, '');
}

// [[target]] resolves to a note name, case-insensitive, path or basename
function normalizeTarget(raw) {
  return raw.trim().replace(/\.md$/i, '').toLowerCase();
}

export function parseNote(content) {
  const { properties, body } = parseFrontmatter(content);
  const links = [];
  const aliases = {};
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1].trim();
    if (!links.includes(target)) links.push(target);
    if (m[2]) aliases[target] = m[2].trim();
  }
  const tags = [];
  // a `tags:` property in frontmatter counts, same as obsidian
  const propTags = properties.tags;
  if (Array.isArray(propTags)) {
    for (const t of propTags) {
      const tag = String(t).toLowerCase().replace(/^#/, '');
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  } else if (typeof propTags === 'string' && propTags.trim()) {
    const tag = propTags.trim().toLowerCase().replace(/^#/, '');
    if (tag) tags.push(tag);
  }
  for (const m of body.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  const heading = body.match(/^#\s+(.+)$/m);
  const title = typeof properties.title === 'string' && properties.title.trim()
    ? properties.title.trim()
    : heading
      ? heading[1].trim()
      : null;
  return { links, aliases, tags, title, properties };
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) yield abs;
  }
}

// the full index, rebuilt from the files every call. honesty over speed:
// a vault of human scale is hundreds of notes, and the truth is cheap here.
export function buildIndex() {
  const notes = new Map(); // rel -> record
  if (!fs.existsSync(VAULT_ROOT)) return notes;
  for (const abs of walk(VAULT_ROOT)) {
    const rel = relFromAbs(abs);
    const stat = fs.statSync(abs);
    const content = fs.readFileSync(abs, 'utf8');
    const parsed = parseNote(content);
    notes.set(rel, {
      path: rel,
      name: noteName(rel),
      title: parsed.title ?? noteName(rel),
      links: parsed.links,
      tags: parsed.tags,
      properties: parsed.properties,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      content,
    });
  }
  return notes;
}

// a link target resolves by full path without extension, or by basename
function resolveTarget(target, notes) {
  const t = normalizeTarget(target);
  for (const [rel, note] of notes) {
    if (noteName(rel).toLowerCase() === t || path.posix.basename(noteName(rel)).toLowerCase() === t) {
      return rel;
    }
  }
  return null;
}

export function listNotes() {
  const notes = buildIndex();
  return [...notes.values()]
    .map(({ content, ...meta }) => ({ ...meta, outlinks: meta.links.length }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function readNote(rel) {
  const abs = resolveNotePath(rel);
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error(`no such note: ${rel}`), { status: 404 });
  }
  const notes = buildIndex();
  const self = notes.get(relFromAbs(abs));
  const backlinks = [];
  for (const [otherRel, note] of notes) {
    if (otherRel === relFromAbs(abs)) continue;
    for (const link of note.links) {
      if (resolveTarget(link, notes) === relFromAbs(abs)) {
        backlinks.push({ path: otherRel, title: note.title });
        break;
      }
    }
  }
  const resolvedLinks = self.links.map((target) => ({
    target,
    alias: parseNote(self.content).aliases[target] ?? null,
    resolvesTo: resolveTarget(target, notes),
  }));
  const { content, ...meta } = self;
  return { ...meta, content, resolvedLinks, backlinks };
}

export function writeNote(rel, content) {
  if (typeof content !== 'string' || content.length === 0) {
    throw Object.assign(new Error('content must be a non-empty string'), { status: 400 });
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) {
    throw Object.assign(new Error('note too large (512kb cap)'), { status: 400 });
  }
  const abs = resolveNotePath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return readNote(relFromAbs(abs));
}

export function deleteNote(rel) {
  const abs = resolveNotePath(rel);
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error(`no such note: ${rel}`), { status: 404 });
  }
  fs.rmSync(abs);
  // prune now-empty directories up to the root, never the root itself
  let dir = path.dirname(abs);
  while (dir !== VAULT_ROOT && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
  return { deleted: relFromAbs(abs) };
}

export function vaultGraph() {
  const notes = buildIndex();
  const nodes = [];
  const edges = [];
  const phantoms = new Set();
  for (const [rel, note] of notes) {
    nodes.push({ id: `note:${rel}`, kind: 'note', label: note.title, at: note.mtime, tags: note.tags });
    for (const link of note.links) {
      const to = resolveTarget(link, notes);
      if (to) {
        edges.push({ from: `note:${rel}`, to: `note:${to}`, kind: 'links' });
      } else {
        const ghost = `phantom:${normalizeTarget(link)}`;
        phantoms.add(ghost);
        edges.push({ from: `note:${rel}`, to: ghost, kind: 'links-phantom' });
      }
    }
  }
  for (const ghost of phantoms) {
    nodes.push({ id: ghost, kind: 'phantom', label: ghost.slice(8) + ' (unwritten)' });
  }
  return { nodes, edges };
}

export function vaultSearch(query, limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const hits = [];
  for (const note of buildIndex().values()) {
    const hayTitle = note.title.toLowerCase();
    const hayBody = note.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (hayTitle.includes(term)) score += 5;
      if (note.tags.some((t) => t.includes(term))) score += 3;
      const bodyHits = hayBody.split(term).length - 1;
      score += Math.min(bodyHits, 5);
    }
    if (score > 0) {
      const at = hayBody.indexOf(terms[0]);
      const excerpt = note.content.slice(Math.max(0, at - 60), at + 140).replace(/\s+/g, ' ').trim();
      hits.push({ score, path: note.path, title: note.title, tags: note.tags, excerpt, mtime: note.mtime });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// --- templates and daily notes ------------------------------------------
// templates live in the vault under templates/, plain notes with
// {{title}} {{date}} {{time}} {{datetime}} placeholders. daily notes live
// under daily/YYYY-MM-DD.md. same jail, same .md law as everything else.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function expandTemplate(template, vars) {
  return template.replace(/\{\{(title|date|time|datetime)\}\}/g, (_, key) => vars[key] ?? '');
}

export function listTemplates() {
  return listNotes()
    .filter((n) => n.path.startsWith('templates/'))
    .map(({ path: p, title, mtime }) => ({ path: p, name: p.slice('templates/'.length, -3), title, mtime }));
}

export function createFromTemplate(rel, templateName, vars = {}) {
  const templatePath = `templates/${templateName}`;
  const templateAbs = resolveNotePath(templatePath);
  if (!fs.existsSync(templateAbs)) {
    throw Object.assign(new Error(`no such template: ${templateName}`), { status: 404 });
  }
  const abs = resolveNotePath(rel);
  if (fs.existsSync(abs)) {
    throw Object.assign(new Error(`note already exists: ${rel}`), { status: 409 });
  }
  const now = new Date();
  const template = fs.readFileSync(templateAbs, 'utf8');
  const content = expandTemplate(template, {
    title: noteName(relFromAbs(abs)).split('/').pop(),
    date: todayLocal(),
    time: now.toTimeString().slice(0, 5),
    datetime: now.toISOString(),
    ...vars,
  });
  return writeNote(relFromAbs(abs), content);
}

// get-or-create today's (or a given day's) daily note. if templates/daily.md
// exists it seeds the new note, otherwise a minimal frontmatter skeleton.
export function dailyNote(dateStr) {
  const date = dateStr ?? todayLocal();
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) {
    throw Object.assign(new Error('date must be YYYY-MM-DD'), { status: 400 });
  }
  const rel = `daily/${date}.md`;
  const abs = resolveNotePath(rel);
  if (fs.existsSync(abs)) return readNote(rel);
  const hasTemplate = fs.existsSync(resolveNotePath('templates/daily'));
  if (hasTemplate) {
    return createFromTemplate(rel, 'daily', { date, title: date });
  }
  return writeNote(rel, serializeFrontmatter({ date, tags: ['daily'] }) + `# ${date}\n\n`);
}

// --- canvas: obsidian-compatible .canvas boards ---------------------------
// a board is json: { nodes: [{id, type:'file', file, x, y, width, height}],
// edges: [{id, fromNode, toNode, ...}] }. same jail as notes, .canvas forced,
// every referenced file must itself pass the note jail. boards open in
// obsidian's canvas core plugin untouched.

const MAX_CANVAS_BYTES = 256 * 1024;

export function resolveCanvasPath(rel) {
  if (typeof rel !== 'string' || rel.trim().length === 0) {
    throw Object.assign(new Error('path must be a non-empty string'), { status: 400 });
  }
  let clean = rel.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean.toLowerCase().endsWith('.canvas')) clean += '.canvas';
  const abs = path.resolve(VAULT_ROOT, clean);
  const rootWithSep = VAULT_ROOT.endsWith(path.sep) ? VAULT_ROOT : VAULT_ROOT + path.sep;
  if (abs !== VAULT_ROOT && !abs.startsWith(rootWithSep)) {
    throw Object.assign(new Error('path escapes the vault'), { status: 400 });
  }
  if (path.basename(abs).startsWith('.')) {
    throw Object.assign(new Error('dotfiles are not boards'), { status: 400 });
  }
  return abs;
}

function validateCanvas(canvas) {
  if (typeof canvas !== 'object' || canvas === null) {
    throw Object.assign(new Error('canvas must be an object'), { status: 400 });
  }
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const edges = Array.isArray(canvas.edges) ? canvas.edges : [];
  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) {
      throw Object.assign(new Error('every node needs a string id'), { status: 400 });
    }
    for (const k of ['x', 'y', 'width', 'height']) {
      if (typeof n[k] !== 'number' || !Number.isFinite(n[k])) {
        throw Object.assign(new Error(`node ${n.id}: ${k} must be a finite number`), { status: 400 });
      }
    }
    if (n.type === 'file') {
      if (typeof n.file !== 'string') {
        throw Object.assign(new Error(`node ${n.id}: file nodes need a file path`), { status: 400 });
      }
      resolveNotePath(n.file); // the note jail applies to board references too
    } else if (n.type === 'text') {
      if (typeof n.text !== 'string') {
        throw Object.assign(new Error(`node ${n.id}: text nodes need text`), { status: 400 });
      }
    } else {
      throw Object.assign(new Error(`node ${n.id}: only file and text nodes are spoken here`), { status: 400 });
    }
    ids.add(n.id);
  }
  for (const e of edges) {
    if (!e || typeof e.id !== 'string' || !ids.has(e.fromNode) || !ids.has(e.toNode)) {
      throw Object.assign(new Error('every edge needs an id and nodes that exist on the board'), { status: 400 });
    }
  }
  return { nodes, edges };
}

function* walkCanvas(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkCanvas(abs);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.canvas')) yield abs;
  }
}

export function listCanvases() {
  const out = [];
  for (const abs of walkCanvas(VAULT_ROOT)) {
    const stat = fs.statSync(abs);
    out.push({ path: relFromAbs(abs), bytes: stat.size, mtime: stat.mtime.toISOString() });
  }
  return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export function readCanvas(rel) {
  const abs = resolveCanvasPath(rel);
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error(`no such board: ${rel}`), { status: 404 });
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    throw Object.assign(new Error(`board is not valid json: ${rel}`), { status: 422 });
  }
  const canvas = validateCanvas(parsed);
  return { path: relFromAbs(abs), ...canvas };
}

export function writeCanvas(rel, canvas) {
  const clean = validateCanvas(canvas);
  const json = JSON.stringify(clean, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_CANVAS_BYTES) {
    throw Object.assign(new Error('board too large (256kb cap)'), { status: 400 });
  }
  const abs = resolveCanvasPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, json + '\n', 'utf8');
  return readCanvas(relFromAbs(abs));
}

export function deleteCanvas(rel) {
  const abs = resolveCanvasPath(rel);
  if (!fs.existsSync(abs)) {
    throw Object.assign(new Error(`no such board: ${rel}`), { status: 404 });
  }
  fs.rmSync(abs);
  let dir = path.dirname(abs);
  while (dir !== VAULT_ROOT && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
  return { deleted: relFromAbs(abs) };
}
