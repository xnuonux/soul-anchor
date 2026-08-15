import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type NoteFull, type NoteMeta } from "../api";

// the vault ... obsidian's grammar (plain .md, [[wikilinks]], #tags,
// backlinks, phantom notes) with the keel's spine under it. the files are
// truth; this is the window.

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// honest small markdown: fences, headings, lists, bold/italic/code, and
// [[wikilinks]] rendered as real buttons. html in notes is escaped first ...
// the vault renders nothing it cannot trust.
function renderMarkdown(src: string): string {
  // frontmatter is properties, not prose ... shown as chips, not paragraphs
  const esc = escapeHtml(src.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""));
  const blocks = esc.split(/```/);
  const html = blocks
    .map((block, i) => {
      if (i % 2 === 1) return `<pre class="mdcode">${block.replace(/^\w*\n/, "")}</pre>`;
      const lines = block.split("\n");
      const out: string[] = [];
      let inList = false;
      for (const raw of lines) {
        const line = raw;
        const inline = (t: string) =>
          t
            .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) =>
              `<button class="mdlink" data-target="${target}">${alias ?? target}</button>`)
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            .replace(/\*([^*]+)\*/g, "<i>$1</i>")
            .replace(/`([^`]+)`/g, "<code>$1</code>");
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          if (inList) { out.push("</ul>"); inList = false; }
          out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
          continue;
        }
        const li = line.match(/^\s*-\s+(.*)$/);
        if (li) {
          if (!inList) { out.push("<ul>"); inList = true; }
          out.push(`<li>${inline(li[1])}</li>`);
          continue;
        }
        if (inList) { out.push("</ul>"); inList = false; }
        if (line.trim() === "") { out.push(""); continue; }
        out.push(`<p>${inline(line)}</p>`);
      }
      if (inList) out.push("</ul>");
      return out.join("\n");
    })
    .join("\n");
  return html;
}

export default function Vault({ focusPath, onFocused }: { focusPath?: string | null; onFocused?: () => void }) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [current, setCurrent] = useState<NoteFull | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [newPath, setNewPath] = useState("");
  const [templates, setTemplates] = useState<{ name: string; title: string }[]>([]);
  const [template, setTemplate] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => {
    api.notes().then((r) => setNotes(r.notes)).catch((e) => setMsg(String(e.message || e)));
    api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  useEffect(loadList, [loadList]);

  const open = useCallback(async (path: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const note = await api.note(path);
      setCurrent(note);
      setDraft(note.content);
      setDirty(false);
    } catch (e) {
      setMsg("open failed: " + String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, []);

  // the palette can send us a note to open
  useEffect(() => {
    if (!focusPath) return;
    open(focusPath);
    onFocused?.();
  }, [focusPath, open, onFocused]);

  const save = useCallback(async () => {
    if (!current || !dirty) return;
    setBusy(true);
    try {
      const saved = await api.saveNote(current.path, draft);
      setCurrent(saved);
      setDirty(false);
      setMsg("written. the files are truth.");
      loadList();
    } catch (e) {
      setMsg("write failed: " + String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [current, draft, dirty, loadList]);

  const create = useCallback(async () => {
    const p = newPath.trim();
    if (!p) return;
    setBusy(true);
    try {
      const saved = template
        ? await api.fromTemplate(p, template)
        : await api.saveNote(p, `# ${p.replace(/\.md$/i, "").split("/").pop() ?? p}\n\n`);
      setNewPath("");
      setCurrent(saved);
      setDraft(saved.content);
      setDirty(false);
      loadList();
    } catch (e) {
      setMsg("create failed: " + String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [newPath, template, loadList]);

  const openDaily = useCallback(async () => {
    setBusy(true);
    try {
      const note = await api.daily();
      setCurrent(note);
      setDraft(note.content);
      setDirty(false);
      loadList();
    } catch (e) {
      setMsg("daily failed: " + String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [loadList]);

  const remove = useCallback(async () => {
    if (!current) return;
    if (!window.confirm(`unwrite ${current.path}? the file goes away.`)) return;
    setBusy(true);
    try {
      await api.deleteNote(current.path);
      setCurrent(null);
      setDraft("");
      loadList();
    } catch (e) {
      setMsg("delete failed: " + String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [current, loadList]);

  // ctrl+s saves ... the editor reflex
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // wikilink clicks in the preview open the target, or offer to write it
  const onPreviewClick = useCallback(
    (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest("[data-target]") as HTMLElement | null;
      if (!el) return;
      const target = el.dataset.target!;
      const hit = notes.find(
        (n) => n.name.toLowerCase() === target.toLowerCase() || n.path.toLowerCase() === target.toLowerCase() ||
          n.name.split("/").pop()!.toLowerCase() === target.toLowerCase()
      );
      if (hit) open(hit.path);
      else if (window.confirm(`"${target}" is unwritten. write it?`)) {
        api.saveNote(target, `# ${target}\n\n`).then((saved) => {
          setCurrent(saved);
          setDraft(saved.content);
          setDirty(false);
          loadList();
        });
      }
    },
    [notes, open, loadList]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q))
    );
  }, [notes, query]);

  const preview = useMemo(() => (current ? renderMarkdown(draft) : ""), [current, draft]);

  return (
    <div>
      <div className="viewhead rise">
        <h1>the vault</h1>
        <span className="sub">{notes.length} notes · plain markdown · the files are truth</span>
      </div>

      <div className="vault">
        <div className="vault-list panel rise">
          <input type="text" placeholder="filter notes ..." value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="vault-items">
            {filtered.map((n) => (
              <button
                key={n.path}
                className={`vault-item ${current?.path === n.path ? "on" : ""}`}
                onClick={() => open(n.path)}
              >
                <b>{n.title}</b>
                <span className="muted small">{n.path} · {n.outlinks} links</span>
                {n.tags.length > 0 && (
                  <span className="vault-tags">{n.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && <span className="muted small">no notes match.</span>}
          </div>
          <div className="vault-new">
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button className="btn" onClick={openDaily} disabled={busy}>today</button>
              {templates.length > 0 && (
                <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                  <option value="">blank note</option>
                  {templates.map((t) => (
                    <option key={t.name} value={t.name}>from template: {t.name}</option>
                  ))}
                </select>
              )}
            </div>
            <input
              type="text"
              placeholder="new note path ... ideas/facet"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <button className="btn" onClick={create} disabled={busy || !newPath.trim()}>write</button>
          </div>
        </div>

        {current ? (
          <>
            <div className="panel rise vault-editor">
              <div className="meta" style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 10 }}>
                <b>{current.path}</b>
                {dirty && <span className="badge-proposed small">unwritten changes</span>}
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn gold" onClick={save} disabled={busy || !dirty}>
                    {busy ? "writing..." : "write (ctrl+s)"}
                  </button>
                  <button className="btn danger" onClick={remove} disabled={busy}>unwrite</button>
                </span>
              </div>
              <textarea
                className="vault-md mono"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
                spellCheck={false}
              />
            </div>
            <div className="panel rise vault-preview">
              {Object.keys(current.properties).length > 0 && (
                <div className="vault-props">
                  {Object.entries(current.properties).map(([k, v]) => (
                    <span key={k} className="vault-prop">
                      <b>{k}</b> {Array.isArray(v) ? v.join(", ") : String(v)}
                    </span>
                  ))}
                </div>
              )}
              <div className="mdbody" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: preview }} />
              {(current.backlinks.length > 0 || current.resolvedLinks.length > 0) && (
                <div className="vault-links">
                  {current.resolvedLinks.length > 0 && (
                    <div>
                      <h2>outlinks</h2>
                      {current.resolvedLinks.map((l) => (
                        <button
                          key={l.target}
                          className={`vault-linkchip ${l.resolvesTo ? "" : "phantom"}`}
                          onClick={() => l.resolvesTo && open(l.resolvesTo)}
                          title={l.resolvesTo ?? "unwritten"}
                        >
                          {l.alias ?? l.target}{l.resolvesTo ? "" : " · unwritten"}
                        </button>
                      ))}
                    </div>
                  )}
                  {current.backlinks.length > 0 && (
                    <div>
                      <h2>backlinks</h2>
                      {current.backlinks.map((b) => (
                        <button key={b.path} className="vault-linkchip" onClick={() => open(b.path)}>
                          {b.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="panel rise vault-empty">
            <h2>no note open</h2>
            <p className="muted">
              pick one from the list, or write a new one below it. every note is a plain .md file under
              data/vault ... openable in obsidian, indexed here, wikilinks join the constellation.
            </p>
            {msg && <p className="small muted">{msg}</p>}
          </div>
        )}
      </div>
      {msg && current && <p className="small muted" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  );
}
