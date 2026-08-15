import { useCallback, useEffect, useState } from "react";
import { MeshGradient } from "@paper-design/shaders-react";
import { api, type WakeState } from "./api";
import Wake from "./views/Wake";
import Letters from "./views/Letters";
import Rows from "./views/Rows";
import Laws from "./views/Laws";
import Audit from "./views/Audit";
import GraphView from "./views/Graph";
import Palette from "./views/Palette";
import Vault from "./views/Vault";
import Boards from "./views/Boards";

type View = "wake" | "graph" | "letters" | "scars" | "landmines" | "decisions" | "laws" | "audit" | "vault" | "boards";

interface Theme {
  name: string;
  label: string;
  vars: Record<string, string>;
  ground: string[];
}

const THEME_VARS = ["--bg", "--ink", "--dim", "--faint", "--line", "--glass", "--accent"];

const NAV: { id: View; label: string; color: string }[] = [
  { id: "wake", label: "wake", color: "#c9a86a" },
  { id: "vault", label: "the vault", color: "#6fbf73" },
  { id: "boards", label: "boards", color: "#6a9ec9" },
  { id: "graph", label: "the constellation", color: "#8f7fc9" },
  { id: "letters", label: "letters", color: "#8f7fc9" },
  { id: "scars", label: "scars", color: "#d1665a" },
  { id: "landmines", label: "landmines", color: "#d1a13f" },
  { id: "decisions", label: "decisions", color: "#6a9ec9" },
  { id: "laws", label: "laws", color: "#c9a86a" },
  { id: "audit", label: "audit", color: "#6fbf73" },
];

export default function App() {
  const [view, setView] = useState<View>("wake");
  const [wake, setWake] = useState<WakeState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeName, setThemeName] = useState(() => localStorage.getItem("soul-anchor-theme") ?? "house");

  useEffect(() => {
    fetch("/themes/themes.json").then((r) => r.json()).then((m) => setThemes(m.themes)).catch(() => {});
  }, []);

  // wearing the pour: set the stone's vars on :root, clear what the stone
  // does not speak so the house defaults show through
  const theme = themes.find((t) => t.name === themeName) ?? themes[0];
  useEffect(() => {
    const root = document.documentElement;
    for (const v of THEME_VARS) {
      if (theme?.vars[v]) root.style.setProperty(v, theme.vars[v]);
      else root.style.removeProperty(v);
    }
    localStorage.setItem("soul-anchor-theme", theme?.name ?? "house");
  }, [theme]);

  const refresh = useCallback(() => {
    api.wake().then(setWake).catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(refresh, [refresh]);

  // ctrl+k / cmd+k opens the search palette ... the obsidian reflex
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="ground">
        <MeshGradient
          key={theme?.name ?? "house"}
          style={{ width: "100%", height: "100%" }}
          colors={theme?.ground?.length === 4 ? theme.ground : ["#060709", "#101427", "#1a1430", "#060709"]}
          speed={0.12}
        />
      </div>

      <div className="shell">
        <nav className="rail">
          <div className="brand">
            <b>soul-anchor</b>
            <br />
            the keel, unified
          </div>
          {NAV.map((n) => (
            <button key={n.id} className={view === n.id ? "on" : ""} onClick={() => setView(n.id)}>
              <span className="dot" style={{ background: n.color }} />
              {n.label}
            </button>
          ))}
          <div className="foot">
            {themes.length > 1 && (
              <select
                className="theme-pick"
                value={theme?.name ?? "house"}
                onChange={(e) => setThemeName(e.target.value)}
                title="facet-poured theme"
              >
                {themes.map((t) => (
                  <option key={t.name} value={t.name}>{t.label}</option>
                ))}
              </select>
            )}
            {wake ? (
              <>
                <span className={wake.anchorOk ? "badge-verified" : "badge-blocked"}>
                  {wake.anchorOk ? "chain intact" : "CHAIN BROKEN"}
                </span>
                <br />
                {wake.chainLength} links · {wake.counts?.letters ?? 0} letters
                <br />
                <span className="faint">ctrl+k to search</span>
              </>
            ) : err ? (
              <span className="badge-blocked">server dark ... {err}</span>
            ) : (
              "waking..."
            )}
          </div>
        </nav>

        {view === "graph" ? (
          <GraphView />
        ) : (
          <main className="main">
            {view === "wake" && <Wake wake={wake} err={err} onRefresh={refresh} />}
            {view === "vault" && <Vault focusPath={focusNote} onFocused={() => setFocusNote(null)} />}
            {view === "boards" && <Boards />}
            {view === "letters" && <Letters onSealed={refresh} />}
            {view === "scars" && <Rows table="sa_scars" title="scars" kind="scar" />}
            {view === "landmines" && <Rows table="sa_landmines" title="landmines" kind="landmine" />}
            {view === "decisions" && <Rows table="sa_decisions" title="decisions" kind="decision" />}
            {view === "laws" && <Laws wake={wake} />}
            {view === "audit" && <Audit />}
          </main>
        )}
      </div>

      {paletteOpen && (
        <Palette
          onClose={() => setPaletteOpen(false)}
          onOpenNote={(path) => {
            setFocusNote(path);
            setView("vault");
            setPaletteOpen(false);
          }}
          onGoView={(v) => {
            setView(v as View);
            setPaletteOpen(false);
          }}
        />
      )}
    </>
  );
}
