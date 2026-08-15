import { useState } from "react";
import { api } from "../api";

// audit ... the fsck surface. green or loud, no self-graded passes.

export default function Audit() {
  const [result, setResult] = useState<{ ok: boolean; failures: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [consol, setConsol] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      setResult(await api.audit());
    } finally {
      setBusy(false);
    }
  };

  const consolidate = async () => {
    setBusy(true);
    try {
      const r = (await api.consolidate()) as Record<string, unknown>;
      setConsol(
        `consolidation run sealed: ${r.scars_decayed} decayed, ${r.promotions_proposed} promotions proposed, starved=${r.starved}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="viewhead rise">
        <h1>audit</h1>
        <span className="sub">mechanical checks. fix the rows, not the report.</span>
      </div>

      <div className="panel rise rise-1">
        <div style={{ display: "flex", gap: 10, marginBottom: result || consol ? 14 : 0 }}>
          <button className="btn gold" onClick={run} disabled={busy}>
            {busy ? "running..." : "run audit"}
          </button>
          <button className="btn" onClick={consolidate} disabled={busy}>
            run consolidation
          </button>
        </div>
        {result &&
          (result.ok ? (
            <p className="badge-verified">all green. the keel holds.</p>
          ) : (
            <div>
              <p className="badge-blocked">{result.failures.length} failure(s):</p>
              {result.failures.map((f, i) => (
                <div className="fail" key={i}>
                  {f}
                </div>
              ))}
            </div>
          ))}
        {consol && <p className="small muted" style={{ marginTop: 10 }}>{consol}</p>}
      </div>
    </div>
  );
}
