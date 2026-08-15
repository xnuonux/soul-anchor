import { useEffect, useState } from "react";
import { api } from "../api";

// generic row browser for scars / landmines / decisions.
// reads through /api/rows; renders the fields that exist, honestly.

const KIND_COLOR: Record<string, string> = {
  scar: "var(--scar)",
  landmine: "var(--landmine)",
  decision: "var(--decision)",
};

export default function Rows({ table, title, kind }: { table: string; title: string; kind: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.rows(table, 500).then((r) => {
      setRows(r.rows);
      setTotal(r.total);
    });
  }, [table]);

  const text = (r: Record<string, unknown>) =>
    String(r.failure_class || r.lesson || r.decision || "");

  const filtered = q
    ? rows.filter((r) => text(r).toLowerCase().includes(q.toLowerCase()))
    : rows;

  const sorted = [...filtered].sort((a, b) => Number(b.charge ?? 0) - Number(a.charge ?? 0));

  return (
    <div>
      <div className="viewhead rise">
        <h1>{title}</h1>
        <span className="sub">
          {filtered.length} of {total}
        </span>
        <input
          type="text"
          placeholder={`filter ${title}...`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260, marginLeft: "auto" }}
        />
      </div>

      <div className="panel rise rise-1">
        {sorted.map((r) => (
          <div className="rowline" key={String(r.id)}>
            <span
              className="chargebar"
              title={`charge ${Number(r.charge ?? 0).toFixed(2)}${r.decayed ? `, decayed ${Number(r.decayed).toFixed(2)}` : ""}`}
            >
              <i
                style={{
                  width: `${Math.min(100, (Number(r.charge ?? 0) / 5) * 100)}%`,
                  background: KIND_COLOR[kind],
                }}
              />
            </span>
            <span>{text(r)}</span>
            {r.verification === "verified" && <span className="badge-verified small">verified</span>}
            {r.verification === "blocked" && <span className="badge-blocked small">blocked</span>}
            {table === "sa_landmines" && !r.confirmed_by && (
              <span className="badge-proposed small">proposed</span>
            )}
            {table === "sa_decisions" && !!r.superseded_by && (
              <span className="faint small">superseded</span>
            )}
            {Number(r.recurrence ?? 0) > 1 && <span className="faint small">x{String(r.recurrence)}</span>}
            <span className="faint small" style={{ marginLeft: "auto", flex: "none" }}>
              {String(r.lane ?? "")} · {String(r.created_at ?? r.last_seen ?? "").slice(0, 10)}
            </span>
          </div>
        ))}
        {sorted.length === 0 && <p className="faint small">nothing here.</p>}
      </div>
    </div>
  );
}
