// vault engine tests ... frontmatter, wikilinks, backlinks, phantoms,
// templates, daily notes, and the path jail. runs against a temp vault
// via SOUL_ANCHOR_VAULT, never the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-anchor-vault-test-'));
process.env.SOUL_ANCHOR_VAULT = tmp;

const vault = await import('../engine/vault.mjs');

function teardown() {
  fs.rmSync(tmp, { recursive: true, force: true });
}

test('frontmatter: properties parse, tags merge, title wins over heading', () => {
  const note = vault.parseNote(`---
title: the real title
charge: 0.8
verified: true
nothing: null
tags: [keel, memory]
colors:
  - red
  - blue
---
# a heading that loses
body with [[other note]] and #inline-tag
`);
  assert.equal(note.title, 'the real title');
  assert.equal(note.properties.charge, 0.8);
  assert.equal(note.properties.verified, true);
  assert.equal(note.properties.nothing, null);
  assert.deepEqual(note.properties.tags, ['keel', 'memory']);
  assert.deepEqual(note.properties.colors, ['red', 'blue']);
  assert.deepEqual(note.links, ['other note']);
  assert.deepEqual(note.tags.sort(), ['inline-tag', 'keel', 'memory']);
});

test('frontmatter: no block means empty properties and untouched body', () => {
  const note = vault.parseNote('# plain\n\njust text with #tag\n');
  assert.deepEqual(note.properties, {});
  assert.equal(note.title, 'plain');
  assert.deepEqual(note.tags, ['tag']);
});

test('frontmatter: serialize round-trips through parse', () => {
  const props = { date: '2026-08-15', tags: ['daily', 'kimi'], charge: 1.5, note: null };
  const text = vault.serializeFrontmatter(props) + '# body\n';
  const fm = vault.parseFrontmatter(text);
  assert.deepEqual(fm.properties, props);
  assert.equal(fm.body, '# body\n');
  const parsed = vault.parseNote(text);
  assert.deepEqual(parsed.properties, props);
  assert.equal(parsed.title, 'body');
});

test('path jail: traversal, absolutes, and dotfiles are refused', () => {
  assert.throws(() => vault.writeNote('../escape.md', 'x'), /escapes the vault/);
  assert.throws(() => vault.writeNote('..\\..\\escape.md', 'x'), /escapes the vault/);
  // a drive-letter absolute resolves outside the vault and must throw;
  // a leading-slash path is treated as vault-relative by deliberate law
  assert.throws(() => vault.writeNote('C:/Windows/evil.md', 'x'), /escapes the vault/);
  assert.throws(() => vault.writeNote('.hidden.md', 'x'), /dotfiles/);
});

test('notes: write, links resolve, backlinks and phantoms appear', () => {
  vault.writeNote('alpha.md', '# alpha\n\nlinks to [[beta]] and [[ghost]]\n');
  vault.writeNote('beta.md', '# beta\n\n#test\n');
  const beta = vault.readNote('beta.md');
  assert.equal(beta.backlinks.length, 1);
  assert.equal(beta.backlinks[0].path, 'alpha.md');
  const alpha = vault.readNote('alpha');
  const ghost = alpha.resolvedLinks.find((l) => l.target === 'ghost');
  assert.equal(ghost.resolvesTo, null);
  const graph = vault.vaultGraph();
  assert.ok(graph.nodes.some((n) => n.kind === 'phantom' && n.id === 'phantom:ghost'));
  assert.ok(graph.edges.some((e) => e.kind === 'links' && e.to === 'note:beta.md'));
  teardown();
});

test('templates: create from template expands placeholders, refuses overwrite', () => {
  vault.writeNote('templates/project.md', '---\ntags: [project]\ncreated: {{date}}\n---\n# {{title}}\n\n');
  const made = vault.createFromTemplate('projects/lunari.md', 'project');
  assert.equal(made.path, 'projects/lunari.md');
  assert.ok(made.content.includes('# lunari'));
  assert.match(made.content, /created: \d{4}-\d{2}-\d{2}/);
  assert.deepEqual(made.tags, ['project']);
  assert.throws(() => vault.createFromTemplate('projects/lunari.md', 'project'), /already exists/);
  assert.throws(() => vault.createFromTemplate('projects/x.md', 'nope'), /no such template/);
  const templates = vault.listTemplates();
  assert.equal(templates.length, 1);
  assert.equal(templates[0].name, 'project');
  teardown();
});

test('daily notes: get-or-create, template-seeded, date validated', () => {
  vault.writeNote('templates/daily.md', '---\ndate: {{date}}\ntags: [daily]\n---\n# {{date}}\n\n- wake:\n- carry:\n');
  const a = vault.dailyNote('2026-08-15');
  assert.equal(a.path, 'daily/2026-08-15.md');
  assert.equal(a.properties.date, '2026-08-15');
  assert.deepEqual(a.tags, ['daily']);
  // second call reads, does not overwrite
  fs.writeFileSync(path.join(tmp, 'daily', '2026-08-15.md'), '# hand edited\n', 'utf8');
  const b = vault.dailyNote('2026-08-15');
  assert.ok(b.content.includes('hand edited'));
  assert.throws(() => vault.dailyNote('15-08-2026'), /YYYY-MM-DD/);
  assert.throws(() => vault.dailyNote('2026-13-40'), /YYYY-MM-DD/);
  teardown();
});

test('daily notes: without a template, a frontmatter skeleton is born', () => {
  const note = vault.dailyNote('2026-01-01');
  assert.equal(note.path, 'daily/2026-01-01.md');
  assert.equal(note.properties.date, '2026-01-01');
  assert.deepEqual(note.tags, ['daily']);
  teardown();
});

test('canvas: write, read, list, delete ... obsidian-shaped json under the same jail', () => {
  vault.writeNote('boards/alpha.md', '# alpha\n\nlinks [[boards/beta]]\n');
  vault.writeNote('boards/beta.md', '# beta\n');
  const board = {
    nodes: [
      { id: 'a', type: 'file', file: 'boards/alpha.md', x: 0, y: 0, width: 260, height: 120 },
      { id: 'b', type: 'file', file: 'boards/beta.md', x: 340, y: 40, width: 260, height: 120 },
      { id: 'c', type: 'text', text: 'a thought', x: 160, y: 220, width: 200, height: 80 },
    ],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'b' }],
  };
  const written = vault.writeCanvas('boards/main', board);
  assert.equal(written.path, 'boards/main.canvas');
  assert.equal(written.nodes.length, 3);
  const read = vault.readCanvas('boards/main.canvas');
  assert.deepEqual(read.edges, board.edges);
  const list = vault.listCanvases();
  assert.equal(list.length, 1);
  assert.equal(list[0].path, 'boards/main.canvas');
  assert.equal(vault.deleteCanvas('boards/main').deleted, 'boards/main.canvas');
  assert.throws(() => vault.readCanvas('boards/main'), /no such board/);
  teardown();
});

test('canvas law: escapes, ghost edges, and out-of-vault files are refused', () => {
  const base = { x: 0, y: 0, width: 100, height: 100 };
  assert.throws(() => vault.writeCanvas('../evil', { nodes: [], edges: [] }), /escapes the vault/);
  assert.throws(
    () => vault.writeCanvas('ok', { nodes: [{ id: 'a', type: 'file', file: '../../etc/passwd', ...base }], edges: [] }),
    /escapes the vault/,
  );
  assert.throws(
    () => vault.writeCanvas('ok', { nodes: [{ id: 'a', type: 'text', text: 't', ...base }], edges: [{ id: 'e', fromNode: 'a', toNode: 'ghost' }] }),
    /nodes that exist/,
  );
  assert.throws(
    () => vault.writeCanvas('ok', { nodes: [{ id: 'a', type: 'text', text: 't', x: NaN, y: 0, width: 1, height: 1 }], edges: [] }),
    /finite number/,
  );
});
