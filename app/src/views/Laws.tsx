import type { WakeState } from "../api";

// the constitution ... locked laws, never paraphrased.

export default function Laws({ wake }: { wake: WakeState | null }) {
  return (
    <div>
      <div className="viewhead rise">
        <h1>laws</h1>
        <span className="sub">the constitution. locked means the founder gate holds it.</span>
      </div>
      <div className="panel rise rise-1">
        {(wake?.laws ?? []).map((l) => (
          <div className="rowline" key={l.position}>
            <span className="mono small kind-law" style={{ width: 28, flex: "none" }}>
              {l.position}
            </span>
            <span>{l.law}</span>
            {l.locked ? <span className="tag">locked</span> : null}
          </div>
        ))}
        {!wake && <p className="faint small">waking first...</p>}
      </div>
    </div>
  );
}
