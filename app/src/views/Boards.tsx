import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Board, type CanvasNode, type NoteMeta } from "../api";

// boards ... obsidian-compatible .canvas, soul-anchor's spatial surface.
// notes as cards, wikilinks between placed notes drawn as dashed derived
// edges (never persisted ... derived means derived), persisted edges solid.
// drag cards, wheel to zoom, drag the void to pan. files are truth here too.

let idCounter = 0;
const nid = () => `n${Date.now().toString(36)}-${idCounter++}`;

export default function Boards() {
  const [boards, setBoards] = useState<{ path: string; mtime: string }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<Board["edges"]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [newBoard, setNewBoard] = useState("");
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dragRef = useRef<{ kind: "node" | "pan"; id?: string; dx: number; dy: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const loadBoards = useCallback(() => {
    api.canvases().then((r) => setBoards(r.canvases)).catch(() => {});
    api.notes().then((r) => setNotes(r.notes)).catch(() => {});
  }, []);

  useEffect(loadBoards, [loadBoards]);

  const open = useCallback(async (path: string) => {
    try {
      const b = await api.canvas(path);
      setCurrent(b.path);
      setNodes(b.nodes);
      setEdges(b.edges);
      setDirty(false);
      setMsg(null);
    } catch (e) {
      setMsg("open failed: " + String((e as Error).message));
    }
  }, []);

  const save = useCallback(async () => {
    if (!current) return;
    try {
      const b = await api.saveCanvas(current, nodes, edges);
      setNodes(b.nodes);
      setEdges(b.edges);
      setDirty(false);
      setMsg("board written. obsidian reads this file too.");
      loadBoards();
    } catch (e) {
      setMsg("write failed: " + String((e as Error).message));
    }
  }, [current, nodes, edges, loadBoards]);

  const createBoard = useCallback(async () => {
    const p = newBoard.trim();
    if (!p) return;
    try {
      const b = await api.saveCanvas(p, [], []);
      setNewBoard("");
      setCurrent(b.path);
      setNodes([]);
      setEdges([]);
      setDirty(false);
      loadBoards();
    } catch (e) {
      setMsg("create failed: " + String((e as Error).message));
    }
  }, [newBoard, loadBoards]);

  const addNote = useCallback(
    (notePath: string) => {
      if (!current || nodes.some((n) => n.file === notePath)) return;
      setNodes((ns) => [
        ...ns,
        { id: nid(), type: "file", file: notePath, x: -pan.x / zoom + 120, y: -pan.y / zoom + 80, width: 260, height: 110 },
      ]);
      setDirty(true);
    },
    [current, nodes, pan, zoom]
  );

  const addText = useCallback(() => {
    if (!current) return;
    setNodes((ns) => [
      ...ns,
      { id: nid(), type: "text", text: "a thought...", x: -pan.x / zoom + 160, y: -pan.y / zoom + 140, width: 200, height: 80 },
    ]);
    setDirty(true);
  }, [current, pan, zoom]);

  const removeNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.fromNode !== id && e.toNode !== id));
    setDirty(true);
  }, []);

  // derived edges: wikilinks between notes that are both on the board
  const derived = useMemo(() => {
    const byFile = new Map(nodes.filter((n) => n.type === "file" && n.file).map((n) => [n.file!, n]));
    const out: { from: string; to: string }[] = [];
    for (const n of byFile.values()) {
      const meta = notes.find((m) => m.path === n.file);
      if (!meta) continue;
      for (const link of meta.links) {
        const target = notes.find(
          (m) => m.name.toLowerCase() === link.toLowerCase() || m.name.split("/").pop()!.toLowerCase() === link.toLowerCase()
        );
        const other = target && byFile.get(target.path);
        if (other && other.id !== n.id) out.push({ from: n.id, to: other.id });
      }
    }
    return out;
  }, [nodes, notes]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // --- pointer law: cards drag, the void pans, the wheel zooms ---
  const toWorld = (cx: number, cy: number) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return { x: (cx - rect.left - pan.x) / zoom, y: (cy - rect.top - pan.y) / zoom };
  };

  const onPointerDown = (e: React.PointerEvent, id?: string) => {
    if (!current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (id) {
      const n = nodeById.get(id)!;
      const w = toWorld(e.clientX, e.clientY);
      dragRef.current = { kind: "node", id, dx: w.x - n.x, dy: w.y - n.y };
    } else {
      dragRef.current = { kind: "pan", dx: e.clientX - pan.x, dy: e.clientY - pan.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setPan({ x: e.clientX - d.dx, y: e.clientY - d.dy });
    } else {
      const w = toWorld(e.clientX, e.clientY);
      setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: w.x - d.dx, y: w.y - d.dy } : n)));
      setDirty(true);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!current) return;
    const next = Math.min(2, Math.max(0.25, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    setZoom(next);
  };

  const placed = new Set(nodes.map((n) => n.file));
  const unplaced = notes.filter((n) => !placed.has(n.path) && !n.path.startsWith("templates/"));

  return (
    <div>
      <div className="viewhead rise">
        <h1>boards</h1>
        <span className="sub">.canvas · obsidian-compatible · wikilinks draw themselves</span>
      </div>

      <div className="boardbar panel rise">
        <select value={current ?? ""} onChange={(e) => e.target.value && open(e.target.value)}>
          <option value="">pick a board...</option>
          {boards.map((b) => (
            <option key={b.path} value={b.path}>{b.path}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="new board ... maps/eternities"
          value={newBoard}
          onChange={(e) => setNewBoard(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createBoard()}
        />
        <button className="btn" onClick={createBoard} disabled={!newBoard.trim()}>lay</button>
        {current && (
          <>
            <select defaultValue="" onChange={(e) => { if (e.target.value) addNote(e.target.value); e.target.value = ""; }}>
              <option value="">place a note...</option>
              {unplaced.map((n) => (
                <option key={n.path} value={n.path}>{n.title}</option>
              ))}
            </select>
            <button className="btn" onClick={addText}>+ text</button>
            <button className="btn gold" onClick={save} disabled={!dirty}>{dirty ? "write board" : "written"}</button>
            <span className="faint small">{Math.round(zoom * 100)}%</span>
          </>
        )}
        {msg && <span className="muted small">{msg}</span>}
      </div>

      <div
        ref={surfaceRef}
        className={`boardsurface panel rise ${current ? "" : "empty"}`}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        {!current ? (
          <p className="muted" style={{ padding: 30 }}>
            no board open. boards are spatial maps of notes, saved as .canvas json that obsidian opens natively.
            wikilinks between placed notes draw themselves as dashed lines; nothing derived is ever persisted.
          </p>
        ) : (
          <div
            className="boardworld"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <svg className="boardedges">
              {derived.map((d, i) => {
                const a = nodeById.get(d.from);
                const b = nodeById.get(d.to);
                if (!a || !b) return null;
                return (
                  <line
                    key={`d${i}`}
                    className="derived"
                    x1={a.x + a.width / 2} y1={a.y + a.height / 2}
                    x2={b.x + b.width / 2} y2={b.y + b.height / 2}
                  />
                );
              })}
              {edges.map((ed) => {
                const a = nodeById.get(ed.fromNode);
                const b = nodeById.get(ed.toNode);
                if (!a || !b) return null;
                return (
                  <line
                    key={ed.id}
                    className="persisted"
                    x1={a.x + a.width / 2} y1={a.y + a.height / 2}
                    x2={b.x + b.width / 2} y2={b.y + b.height / 2}
                  />
                );
              })}
            </svg>
            {nodes.map((n) => {
              const meta = n.file ? notes.find((m) => m.path === n.file) : null;
              return (
                <div
                  key={n.id}
                  className={`boardcard ${n.type}`}
                  style={{ left: n.x, top: n.y, width: n.width, minHeight: n.height }}
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, n.id); }}
                >
                  <button className="cardx" onClick={() => removeNode(n.id)} title="lift off the board">x</button>
                  {n.type === "file" ? (
                    <>
                      <b>{meta?.title ?? n.file}</b>
                      <span className="muted small">{n.file}</span>
                      {meta && meta.tags.length > 0 && (
                        <span className="vault-tags">{meta.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</span>
                      )}
                    </>
                  ) : (
                    <span
                      className="boardtext"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const text = e.currentTarget.textContent ?? "";
                        setNodes((ns) => ns.map((m) => (m.id === n.id ? { ...m, text } : m)));
                        setDirty(true);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {n.text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
