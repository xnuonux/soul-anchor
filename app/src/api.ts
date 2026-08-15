// api client ... the app talks to the keel only through these.
// vite proxies /api to the server on 127.0.0.1:4141.

export interface WakeState {
  anchorOk: boolean;
  status: string;
  chainReason?: string;
  chainLength: number;
  anchor: { index: number; content: string } | null;
  letter: { text: string; session: string | null; at: string; freshness: string } | null;
  scars: Scar[];
  landmines: Landmine[];
  decisions: Decision[];
  laws: Law[];
  counts: Record<string, number>;
  latestConsolidation: unknown;
}

export interface Scar {
  id: string;
  failure_class: string;
  charge: number;
  decayed?: number;
  recurrence: number;
  status: string;
  verification: string;
  lane: string;
  last_seen: string;
}

export interface Landmine {
  id: string;
  lesson: string;
  domain_tags: string;
  confirmed_by: string | null;
  proposed?: boolean;
  charge: number;
  lane: string;
  created_at: string;
  stale?: string;
}

export interface Decision {
  id: string;
  decision: string;
  why: string | null;
  charge: number;
  superseded_by: string | null;
  lane: string;
  created_at: string;
  stale?: string;
}

export interface Law {
  position: number;
  law: string;
  locked: number;
}

export interface GraphData {
  nodes: { id: string; kind: string; label: string; charge?: number; lane?: string; at?: string }[];
  edges: { from: string; to: string; kind: string }[];
}

export interface SearchHit {
  score: number;
  source: string;
  id: string | number;
  text: string;
  at?: string;
  session?: string;
  proposed?: boolean;
  superseded?: boolean;
}

export interface NoteMeta {
  path: string;
  name: string;
  title: string;
  links: string[];
  tags: string[];
  properties: Record<string, unknown>;
  bytes: number;
  mtime: string;
  outlinks: number;
}

export interface NoteFull extends NoteMeta {
  content: string;
  resolvedLinks: { target: string; alias: string | null; resolvesTo: string | null }[];
  backlinks: { path: string; title: string }[];
}

export interface VaultHit {
  score: number;
  path: string;
  title: string;
  tags: string[];
  excerpt: string;
  mtime: string;
}

export interface CanvasNode {
  id: string;
  type: "file" | "text";
  file?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
}

export interface Board {
  path: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface FusionHit {
  kind: "keel" | "note";
  source: string;
  id: string | number;
  text: string;
  path?: string;
  title?: string;
  tags?: string[];
  at?: string;
  session?: string;
  rrf: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `http ${res.status}`);
  return body as T;
}

export const api = {
  wake: () => req<WakeState>("/api/wake"),
  audit: () => req<{ ok: boolean; failures: string[] }>("/api/audit"),
  graph: () => req<GraphData>("/api/graph"),
  search: (q: string, limit = 12) =>
    req<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  searchAll: (q: string, limit = 12) =>
    req<{ hits: FusionHit[] }>(`/api/search/all?q=${encodeURIComponent(q)}&limit=${limit}`),
  rows: <T = Record<string, unknown>>(table: string, limit = 200, offset = 0) =>
    req<{ table: string; total: number; rows: T[] }>(
      `/api/rows?table=${table}&limit=${limit}&offset=${offset}`
    ),
  seal: (letter: string, sessionRef?: string, lane = "kimi-pc") =>
    req("/api/seal", { method: "POST", body: JSON.stringify({ letter, sessionRef, lane }) }),
  consolidate: () => req("/api/consolidate", { method: "POST", body: "{}" }),
  confirmLandmine: (id: string | "all", founder = "dom") =>
    req("/api/landmine/confirm", { method: "POST", body: JSON.stringify({ id, founder }) }),
  notes: () => req<{ notes: NoteMeta[] }>("/api/notes"),
  note: (path: string) => req<NoteFull>(`/api/note?path=${encodeURIComponent(path)}`),
  saveNote: (path: string, content: string) =>
    req<NoteFull>("/api/note", { method: "POST", body: JSON.stringify({ path, content }) }),
  deleteNote: (path: string) =>
    req<{ deleted: string }>(`/api/note?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  vaultSearch: (q: string, limit = 12) =>
    req<{ hits: VaultHit[] }>(`/api/vault/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  daily: (date?: string) =>
    req<NoteFull>(`/api/vault/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  templates: () => req<{ templates: { path: string; name: string; title: string; mtime: string }[] }>("/api/vault/templates"),
  fromTemplate: (path: string, template: string) =>
    req<NoteFull>("/api/vault/from-template", { method: "POST", body: JSON.stringify({ path, template }) }),
  canvases: () => req<{ canvases: { path: string; bytes: number; mtime: string }[] }>("/api/canvases"),
  canvas: (path: string) => req<Board>(`/api/canvas?path=${encodeURIComponent(path)}`),
  saveCanvas: (path: string, nodes: CanvasNode[], edges: CanvasEdge[]) =>
    req<Board>("/api/canvas", { method: "POST", body: JSON.stringify({ path, nodes, edges }) }),
};
