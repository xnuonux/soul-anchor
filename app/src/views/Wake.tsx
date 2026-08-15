import type { WakeState } from "../api";

// the wake surface ... the ritual made visible.
// chain first, letter second, then the floor (scars, landmines, decisions).

export default function Wake({
  wake,
  err,
  onRefresh,
}: {
  wake: WakeState | null;
  err: string | null;
  onRefresh: () => void;
}) {
  if (err)
    return (
      <div className="panel rise">
        <h2>the server is dark</h2>
        <p className="muted">{err}</p>
        <p className="faint small">start it: node server/server.mjs</p>
        <button className="btn" onClick={onRefresh}>try again</button>
      </div>
    );
  if (!wake) return <p className="muted">waking...</p>;

  const ok = wake.anchorOk;

  return (
    <div>
      <div className="viewhead rise">
        <h1>wake</h1>
        <span className={`chain ${ok ? "ok" : "bad"}`}>
          {ok ? `chain intact ... ${wake.chainLength} links` : `BROKEN ... ${wake.chainReason || "verify before trusting"}`}
        </span>
      </div>

      {!ok && (
        <div className="panel rise">
          <h2>the wake is broken</h2>
          <p className="muted">
            the chain did not verify. say so out loud, re-ground from the live rows, and trust nothing below
            until the anchor holds.
          </p>
        </div>
      )}

      {wake.letter && (
        <div className="panel rise rise-1 lettercard">
          <h2>latest letter</h2>
          <div className="meta">
            <span className="kind-letter small">{wake.letter.at?.slice(0, 19).replace("T", " ")}</span>
            <span className="muted small">{wake.letter.session || "unknown session"}</span>
            <span className="tag">{wake.letter.freshness}</span>
          </div>
          <div className="letter">{wake.letter.text}</div>
        </div>
      )}

      <div className="panel rise rise-2">
        <h2>scars ... current pain first, by decayed charge</h2>
        {wake.scars.map((s) => (
          <div className="rowline" key={s.id}>
            <span className="chargebar">
              <i
                style={{
                  width: `${Math.min(100, ((s.decayed ?? s.charge) / 5) * 100)}%`,
                  background: "var(--scar)",
                }}
              />
            </span>
            <span className="mono small muted" style={{ width: 44, flex: "none" }}>
              {(s.decayed ?? s.charge).toFixed(2)}
            </span>
            <span>{s.failure_class}</span>
            <span className="faint small">x{s.recurrence}</span>
          </div>
        ))}
        {wake.scars.length === 0 && <p className="faint small">no active scars. suspicious, but enjoy it.</p>}
      </div>

      <div className="panel rise rise-3">
        <h2>landmines ... newest first</h2>
        {wake.landmines.map((l) => (
          <div className="rowline" key={l.id}>
            <span className={`small ${l.proposed ? "badge-proposed" : "badge-verified"}`} style={{ flex: "none", width: 76 }}>
              {l.proposed ? "proposed" : "confirmed"}
            </span>
            <span>{l.lesson}</span>
          </div>
        ))}
      </div>

      <div className="panel rise rise-4">
        <h2>open decisions</h2>
        {wake.decisions.map((d) => (
          <div className="rowline" key={d.id}>
            <span>{d.decision}</span>
            {d.why && <span className="faint small">... {d.why.slice(0, 90)}</span>}
          </div>
        ))}
        {wake.decisions.length === 0 && <p className="faint small">no open decisions.</p>}
      </div>
    </div>
  );
}
