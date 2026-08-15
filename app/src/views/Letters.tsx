import { useEffect, useState } from "react";
import { api } from "../api";

interface LetterRow {
  id: string;
  letter: string;
  session_ref: string | null;
  lane: string;
  written_at: string;
}

// the letter stream ... every seal, newest first, plus the seal box.
// the checkpoint-seal rule is the house law: seal, then keep working.

export default function Letters({ onSealed }: { onSealed: () => void }) {
  const [rows, setRows] = useState<LetterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [sessionRef, setSessionRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.rows<LetterRow>("sa_letters", 50).then((r) => {
      setRows([...r.rows].sort((a, b) => (a.written_at < b.written_at ? 1 : -1)));
      setTotal(r.total);
    });
  };
  useEffect(load, []);

  const seal = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.seal(draft.trim(), sessionRef.trim() || undefined);
      setDraft("");
      setMsg("sealed. the chain grew. keep working.");
      load();
      onSealed();
    } catch (e) {
      setMsg("seal failed: " + String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="viewhead rise">
        <h1>letters</h1>
        <span className="sub">{total} sealed</span>
      </div>

      <div className="panel rise">
        <h2>seal a checkpoint</h2>
        <input
          type="text"
          placeholder="session ref ... e.g. kimi-2026-08-13-soul-anchor-v1"
          value={sessionRef}
          onChange={(e) => setSessionRef(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <textarea
          rows={5}
          placeholder={"open: ...\n\nwary: ...\n\ncarry: ..."}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button className="btn gold" onClick={seal} disabled={busy || !draft.trim()}>
            {busy ? "sealing..." : "seal"}
          </button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
      </div>

      {rows.map((l, i) => (
        <div className={`panel lettercard rise`} style={{ animationDelay: `${Math.min(i * 0.03, 0.4)}s` }} key={l.id}>
          <div className="meta">
            <span className="kind-letter small">{l.written_at.slice(0, 19).replace("T", " ")}</span>
            <span className="muted small">{l.session_ref || "unreferenced"}</span>
            <span className="tag">{l.lane}</span>
          </div>
          <div className="letter">{l.letter}</div>
        </div>
      ))}
    </div>
  );
}
