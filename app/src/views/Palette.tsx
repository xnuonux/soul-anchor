import { useEffect, useRef, useState } from "react";
import { api, type FusionHit } from "../api";

// the search palette ... ctrl+k. one ranked list across keel rows and vault
// notes, reciprocal rank fusion on the server. enter opens the hit: a note
// lands in the vault, a keel row lands in its source view.

const SRC_COLOR: Record<string, string> = {
  letter: "var(--letter)",
  scar: "var(--scar)",
  landmine: "var(--landmine)",
  decision: "var(--decision)",
  note: "var(--ok)",
};

const SRC_VIEW: Record<string, string> = {
  letter: "letters",
  scar: "scars",
  landmine: "landmines",
  decision: "decisions",
};

export default function Palette({
  onClose,
  onOpenNote,
  onGoView,
}: {
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onGoView: (view: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FusionHit[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchAll(q).then((r) => {
        setHits(r.hits);
        setSel(0);
      }).catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  const open = (h: FusionHit) => {
    if (h.kind === "note" && h.path) onOpenNote(h.path);
    else onGoView(SRC_VIEW[h.source] ?? "wake");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && hits[sel]) { e.preventDefault(); open(hits[sel]); }
  };

  return (
    <div className="palette" onKeyDown={onKey}>
      <input
        ref={inputRef}
        type="text"
        placeholder="search everything... notes, letters, scars, landmines, decisions"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
      />
      <div style={{ marginTop: 8, maxHeight: "50vh", overflowY: "auto" }}>
        {hits.map((h, i) => (
          <div
            key={`${h.kind}:${h.id}`}
            className={`hit ${i === sel ? "sel" : ""}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => open(h)}
          >
            <span className="src" style={{ color: SRC_COLOR[h.source] || "var(--dim)" }}>
              {h.source}
            </span>
            <span className="muted">
              {h.kind === "note" ? `${h.title ?? h.path} ... ${(h.text || "").slice(0, 110)}` : (h.text || "").slice(0, 140)}
            </span>
          </div>
        ))}
        {q.trim() && hits.length === 0 && <p className="faint small" style={{ padding: 10 }}>no hits.</p>}
      </div>
    </div>
  );
}
