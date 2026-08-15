// soul-anchor MCP surface ... stdio, the lapidary pattern, confined.
//
// dependency choice: hand-rolled JSON-RPC over stdio, zero-dep.
// the MCP stdio transport is newline-delimited JSON-RPC ... one message per
// line, no Content-Length framing. that is small enough to implement
// honestly in one file, and the house rule is zero-dep everywhere the engine
// already is. @modelcontextprotocol/sdk stays out of the tree.
//
// confinement law (lapidary): this process NEVER touches the filesystem
// outside the repo data dir, and every write goes through the engine API
// only. the vault tools touch markdown files under data/vault/ exclusively
// ... path law there rejects '..', absolutes, and non-.md. nothing else
// on disk exists for this process.

import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listNotes,
  readNote,
  writeNote,
  deleteNote,
  vaultSearch,
  listTemplates,
  createFromTemplate,
  dailyNote,
  listCanvases,
  readCanvas,
  writeCanvas,
} from '../engine/vault.mjs';

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
  mirrorExport,
} from '../engine/keel.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'soul-anchor', version: '0.1.0' };

const TOOLS = [
  {
    name: 'keel_wake',
    description: 'verify the anchor chain, then return the bounded wake context: letter, scars, landmines, decisions, laws, counts, freshness',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'keel_seal',
    description: 'checkpoint a letter without sleeping ... seal, then keep working',
    inputSchema: {
      type: 'object',
      properties: {
        letter: { type: 'string', description: 'the letter to the next session' },
        session_ref: { type: 'string', description: 'session identifier for provenance' },
        lane: { type: 'string', description: 'which body/agent wrote this (lane provenance)' },
      },
      required: ['letter'],
      additionalProperties: false,
    },
  },
  {
    name: 'keel_sleep',
    description: 'end of session: append scars, landmines, and decisions, seal the letter, extend the anchor chain',
    inputSchema: {
      type: 'object',
      properties: {
        session_ref: { type: 'string', description: 'session identifier for provenance' },
        lane: { type: 'string', description: 'which body/agent wrote this' },
        letter: { type: 'string', description: 'the letter to the next session' },
        scars: { type: 'array', items: { type: 'object' }, description: 'scars to append' },
        landmines: { type: 'array', items: { type: 'object' }, description: 'landmines to append' },
        decisions: { type: 'array', items: { type: 'object' }, description: 'decisions to append' },
      },
      required: ['letter'],
      additionalProperties: false,
    },
  },
  {
    name: 'keel_search',
    description: 'search the keel: fts5 bm25 with like fallback, rrf fusion, recency whisper',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search query' },
        limit: { type: 'integer', description: 'max results, default 8', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'keel_audit',
    description: 'fsck the keel: chain walk, supersede cycles, fts completeness, seal-starvation, verification-method law',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'keel_add_scar',
    description: 'record a failure that hurt ... a scar the next session must see',
    inputSchema: {
      type: 'object',
      properties: {
        failure_class: { type: 'string', description: 'the class of failure' },
        charge: { type: 'number', description: 'emotional weight 0..1, default 1.0' },
        description: { type: 'string', description: 'what happened and why it hurt' },
      },
      required: ['failure_class'],
      additionalProperties: false,
    },
  },
  {
    name: 'keel_add_landmine',
    description: 'propose a lesson ... it stays PROPOSED until the founder confirms it',
    inputSchema: {
      type: 'object',
      properties: {
        lesson: { type: 'string', description: 'the lesson' },
        domain_tags: { type: 'array', items: { type: 'string' }, description: 'domain tags for grouping' },
      },
      required: ['lesson'],
      additionalProperties: false,
    },
  },
  {
    name: 'keel_add_decision',
    description: 'record a decision and its why ... superseded, never deleted',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', description: 'what was decided' },
        why: { type: 'string', description: 'why this and not the alternatives' },
      },
      required: ['decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'keel_consolidate',
    description: 'the sleep-cron: apply decay bookkeeping, propose promotions, log a consolidation run',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'keel_mirror_export',
    description: 'export the whole keel as canonical json (keel-imprint interchange)',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'vault_list',
    description: 'list every note in the vault: path, title, tags, outlink count, mtime',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'vault_read',
    description: 'read one note: raw markdown, resolved wikilinks, backlinks',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault-relative path, .md optional' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'vault_write',
    description: 'create or overwrite a note. plain markdown, [[wikilinks]] and #tags are indexed',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault-relative path, .md optional' },
        content: { type: 'string', description: 'the full markdown content' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'vault_delete',
    description: 'delete a note from the vault',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault-relative path, .md optional' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'vault_search',
    description: 'search the vault: title, tags, and body, ranked, with excerpts',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search query' },
        limit: { type: 'integer', description: 'max results, default 12', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'vault_daily',
    description: "get-or-create a daily note (daily/YYYY-MM-DD.md), seeded from templates/daily.md when present",
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today (local)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vault_templates',
    description: 'list the templates under templates/ in the vault',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'vault_from_template',
    description: 'create a new note from a template, expanding {{title}} {{date}} {{time}} {{datetime}}. refuses to overwrite',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault-relative path for the new note, .md optional' },
        template: { type: 'string', description: 'template name under templates/, .md optional' },
      },
      required: ['path', 'template'],
      additionalProperties: false,
    },
  },
  {
    name: 'vault_canvas_list',
    description: 'list the .canvas boards in the vault',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'vault_canvas_read',
    description: 'read a .canvas board: obsidian-compatible nodes and edges',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault-relative path, .canvas optional' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'vault_canvas_write',
    description: 'create or overwrite a .canvas board. nodes: file (a vault note) or text; edges reference node ids',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault-relative path, .canvas optional' },
        nodes: { type: 'array', description: 'board nodes: {id, type: file|text, file|text, x, y, width, height}' },
        edges: { type: 'array', description: 'board edges: {id, fromNode, toNode}' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

function asObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('tool arguments must be an object');
  }
  return value;
}

function optionalString(args, key) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
}

function requiredString(args, key) {
  const value = optionalString(args, key);
  if (value === undefined || value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function optionalNumber(args, key) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

function optionalArray(args, key) {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value;
}

// every dispatch lands on the engine API and nothing else
function callTool(name, raw) {
  const args = asObject(raw ?? {});
  switch (name) {
    case 'keel_wake':
      return wake();
    case 'keel_seal':
      return seal(requiredString(args, 'letter'), {
        sessionRef: optionalString(args, 'session_ref') ?? null,
        lane: optionalString(args, 'lane'),
      });
    case 'keel_sleep':
      return sleep({
        sessionRef: optionalString(args, 'session_ref') ?? null,
        lane: optionalString(args, 'lane'),
        letter: requiredString(args, 'letter'),
        scars: optionalArray(args, 'scars') ?? [],
        landmines: optionalArray(args, 'landmines') ?? [],
        decisions: optionalArray(args, 'decisions') ?? [],
      });
    case 'keel_search':
      return search(requiredString(args, 'query'), optionalNumber(args, 'limit') ?? 8);
    case 'keel_audit':
      return audit();
    case 'keel_add_scar':
      return addScar(requiredString(args, 'failure_class'), {
        charge: optionalNumber(args, 'charge'),
        description: optionalString(args, 'description'),
      });
    case 'keel_add_landmine':
      return addLandmine(requiredString(args, 'lesson'), {
        domainTags: optionalArray(args, 'domain_tags'),
      });
    case 'keel_add_decision':
      return addDecision(requiredString(args, 'decision'), {
        why: optionalString(args, 'why'),
      });
    case 'keel_consolidate':
      return consolidate();
    case 'keel_mirror_export':
      return mirrorExport();
    case 'vault_list':
      return { notes: listNotes() };
    case 'vault_read':
      return readNote(requiredString(args, 'path'));
    case 'vault_write':
      return writeNote(requiredString(args, 'path'), requiredString(args, 'content'));
    case 'vault_delete':
      return deleteNote(requiredString(args, 'path'));
    case 'vault_search':
      return { hits: vaultSearch(requiredString(args, 'query'), optionalNumber(args, 'limit') ?? 12) };
    case 'vault_daily':
      return dailyNote(optionalString(args, 'date'));
    case 'vault_templates':
      return { templates: listTemplates() };
    case 'vault_from_template':
      return createFromTemplate(requiredString(args, 'path'), requiredString(args, 'template'));
    case 'vault_canvas_list':
      return { canvases: listCanvases() };
    case 'vault_canvas_read':
      return readCanvas(requiredString(args, 'path'));
    case 'vault_canvas_write':
      return writeCanvas(requiredString(args, 'path'), {
        nodes: optionalArray(args, 'nodes') ?? [],
        edges: optionalArray(args, 'edges') ?? [],
      });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --- json-rpc over stdio, newline-delimited (the MCP stdio transport) ---

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleMessage(message) {
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    // malformed ... if it carried an id, say so; otherwise drop it quietly
    if (message && message.id !== undefined) respondError(message.id, -32600, 'invalid request');
    return;
  }

  const { id, method, params } = message;
  const isNotification = id === undefined;

  try {
    switch (method) {
      case 'initialize':
        if (!isNotification) {
          respond(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          });
        }
        return;
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return; // notifications get no response
      case 'ping':
        if (!isNotification) respond(id, {});
        return;
      case 'tools/list':
        if (!isNotification) respond(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        if (isNotification) return;
        try {
          const result = callTool(params?.name, params?.arguments);
          respond(id, { content: [{ type: 'text', text: `${JSON.stringify(result, null, 2)}\n` }] });
        } catch (error) {
          // loud, but clean: failures ride back as tool errors, never a crash
          const text = error instanceof Error ? error.message : String(error);
          respond(id, { content: [{ type: 'text', text }], isError: true });
        }
        return;
      }
      default:
        if (!isNotification) respondError(id, -32601, `method not found: ${method}`);
    }
  } catch (error) {
    if (!isNotification) {
      respondError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
}

export function runMcpServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handleMessage(JSON.parse(trimmed));
    } catch {
      respondError(null, -32700, 'parse error');
    }
  });
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntry) {
  runMcpServer();
}
