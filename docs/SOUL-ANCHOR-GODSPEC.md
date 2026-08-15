# SOUL ANCHOR — GODSPEC

> the whole product in one doc. cold-executable: another ai, given this doc and the repo, can run, extend, and verify the product without asking anyone anything. if a claim here is not yet true in code, it is marked `[planned]` — calm is a claim, never a default.

status legend: `[live]` shipped and verified with receipts ... `[planned]` specified, not yet built ... `[cut]` deliberately not built.

---

## 0. what this is

SOUL ANCHOR is a sovereign memory-and-knowledge product for humans and ai agents, built by eternities inc.

the lineage, from the canon (`eternities-canon`, sources/records 2026-06-15): dom's witness codex — *"an ai that holds the arc of a human life and reflects truth back honestly"* — became lunari, whose continuity organ became the keel. the strategist's resolution, now canon: **the keel is a CLASS. every mind has one.** and the named gap, verbatim from that record: *"extract the keel into a standalone PROTOCOL ... a schema + a wake ritual + write disciplines + constitution enforcement + the integrity instruments that make it portable."*

soul-anchor is that extraction. the keel as a portable protocol with its gates intact, plus the human-facing body obsidian proved people want.

three organs, one body:

- **keel** — the protocol/engine. hash-chained, tamper-evident memory rows with charge physics, lanes, and a wake ritual. rows are truth.
- **the vault** — the notes organ. plain markdown files on disk, obsidian-openable, indexed for wikilinks, backlinks, tags, phantoms. files are truth; the index is rebuilt from them on every read.
- **facet** — the design organ. a design-system generator (stones, grammars, kit pieces) that pours visual identity for the product itself and for anything built with it.

soul-anchor is what obsidian would be if the graph had a chain of custody and the ai lived inside the notes instead of scraping them.

## 1. the laws (non-negotiable, from the keel canon)

1. **proof floor.** calm is a claim, never a default. every capability ships with a receipt — a test row, a seal, a screenshot. no fake success, ever.
2. **FLOW vs STOCK.** streams that move (letters, seals, charge events) are FLOW. stores that persist (rows, notes, stones) are STOCK. never confuse them in schema or in speech.
3. **`can: null` honesty.** the capability registry lists what the product cannot do. unknown is a value, not an omission.
4. **observe-first.** new organs observe before they act. any flip from observing to acting is founder-locked.
5. **founder gate.** identity canon — the laws, the name, the bedrock — does not change without the founder (dom).
6. **no machine-reward.** nothing in the product optimizes for its own engagement. no streaks, no dopamine loops, no notification pressure.
7. **quality is the moat.** not one aesthetic, not one feature — the floor under everything.
8. **REAL vs OURS, labelled.** borrowed instruments (merkle chains, fts5, markdown, stretched-exponential decay) are REAL prior art and named as such. what is ours — the keel class, the wake ritual, receipts-as-rows culture — is claimed as application and invention, never dressed as borrowed physics. *(law generalized from luna-2 `blueprint/cosmos/00-the-spine.md`, canon proposal engineer-01.)*
9. **degrade, never silently delete.** forgetting is a floor, not an absence: summary → essence → hash, and the bottom of forgetting is still a row. deliberate deletion of a particular memory is a founder-gated act with a recorded reason. *(from luna-2 `memory.ts` FORGET_FLOOR and the corrections record C3.)*
10. **anti-capture.** no one — not even the founder — can be invoked to set the laws aside. his voice is first, never absolute. *(amendment 0001, canon.)*
11. **distribution over invention.** before building anything new, audit what one organ already knows that another needs. the estate's historical failure mode is the unmade connection, not the missing idea. *(corrections record C6.)*

## 1a. what soul-anchor refuses *(from keel-imprint, blueprint 108 — holds here unchanged)*

- **never a consciousness claim.** the anchor is memory of work and self, not proof of survival of self. same pattern, new substrate, no guarantees.
- **never silent authority.** a claim that asserts without method is flagged, not trusted. an unauditable memory is a rumor with a database.
- **never the vendor's hostage.** the store is files the user can read, copy, and delete. export is the product, not a feature request.
- **never sealed by proxy.** the one who did the work signs the record. a chain of custody is only as strong as its signers.
- **never a hall of mirrors.** a keel without audits is continuity without conscience; the audit, the starvation scan, and the proof floor ship in the box, not as options.

## 2. architecture

```
soul-anchor/
  engine/
    keel.mjs      # the memory engine: rows, chain, charge, lanes, seals  [live]
    vault.mjs     # the notes organ: files, links, backlinks, phantoms    [live]
  server/
    server.mjs    # http api :4141, serves app + keel + vault routes       [live]
    mcp.mjs       # stdio MCP server: keel_* and vault_* tools             [live]
  app/            # react + vite + ts frontend :5173                       [live]
    src/views/    # constellation, memory, vault, ...                      [live]
  data/
    keel/         # sqlite, the chain                                      [live]
    vault/        # plain .md, a real obsidian vault                       [live]
  scripts/
    migrate-supabase.mjs  # cloud mirror                                   [live]
  docs/
    SOUL-ANCHOR-GODSPEC.md  # this file                                    [live]
```

zero runtime dependencies in engine and server. the app uses react/vite/typescript. nothing else.

## 3. capability registry

| capability | status | receipt |
|---|---|---|
| keel rows, hash chain, seals | `live` | chain verify, seal letters 1-10 |
| charge/decay physics | `live` | computed-on-read decay |
| lanes (per-mind provenance) | `live` | `[lane: X]` prefixes, kimi/facet rows |
| wake ritual (bedrock → letters → landmines) | `live` | `keel.mjs wake` |
| constellation graph (memory + notes merged) | `live` | /api/vault/graph + buildGraph |
| MCP tools: keel_* , vault_* | `live` | stdio-verified |
| vault: wikilinks, backlinks, tags, phantoms | `live` | engine tests, app screenshots |
| vault: frontmatter properties | `live` | vault.test.mjs, chips in the editor |
| vault: daily notes, templates | `live` | vault.test.mjs, /api/vault/daily, templates/ |
| fusion search (keel fts5 + vault, one palette) | `live` | rrf k=60, palette screenshots |
| facet-poured themes for the app | `live` | themes.json, 23 stones + house, screenshots |
| canvas boards (.canvas, obsidian-compatible) | `live` | canvas tests, drag-persist screenshot |
| vault sync (cloud mirror, sha256-verified) | `live (script)` | vault-mirror.mjs; table creation is one founder-gated sql step |
| publish service | `cut` | not now; quality over sprawl |
| mobile app | `cut` | not now |
| plugin ecosystem | `cut` | deliberate: curation over sprawl. MCP *is* the extension surface |
| mobile capture | `can: null` | unexplored |

## 4. data law

- the vault is a jail: no absolute paths, no `..`, no dotfiles, `.md` forced. 512kb note cap.
- the chain is append-only: seals reference the previous seal's hash; tampering breaks the chain loudly.
- notes are portable: any note opens in obsidian, vs code, or notepad. no lock-in, ever.
- the cloud is a mirror, never the master. local rows are truth; supabase holds letters for cross-machine wake.

## 5. interfaces

**http** (`server.mjs`, :4141, localhost-only): `/api/wake`, `/api/audit`, `/api/search`, `/api/search/all` (fusion), `/api/rows`, `/api/graph`, `/api/notes`, `/api/note` (GET/POST/DELETE), `/api/vault/search`, `/api/vault/graph`, `/api/vault/daily`, `/api/vault/templates`, `/api/vault/from-template`, `/api/canvas` (GET/POST/DELETE), `/api/canvases`, `/api/seal`, `/api/sleep`, `/api/scar`, `/api/landmine`, `/api/decision`, `/api/consolidate`, `/api/mirror`. `[live]`

**MCP** (`mcp.mjs`, stdio): `keel_wake`, `keel_seal`, `keel_sleep`, `keel_search`, `keel_audit`, `keel_add_scar`, `keel_add_landmine`, `keel_add_decision`, `keel_consolidate`, `keel_mirror_export`, `vault_list`, `vault_read`, `vault_write`, `vault_delete`, `vault_search`, `vault_daily`, `vault_templates`, `vault_from_template`, `vault_canvas_list`, `vault_canvas_read`, `vault_canvas_write`. `[live — 21 tools, stdio-verified]`

**app** (`:5174` dev): wake, the vault (three-pane notes: properties chips, daily, templates), boards (.canvas, drag/zoom/pan, derived wikilink edges), the constellation, letters/scars/landmines/decisions/laws/audit, ctrl+k fusion palette, facet-poured theme picker (24 themes). `[live]`

**cli**: `engine/keel.mjs` wake/audit/seal/sleep/search · `scripts/migrate-supabase.mjs` (cloud→local, read-only) · `scripts/vault-mirror.mjs` (local→cloud, sha256-verified) · `scripts/pour-themes.mjs` (facet→app, dev-time). `[live]`

## 6. verification ritual

every phase ends the same way:

1. engine tests green (`npm test` ... 20/20 as of P4)
2. typecheck clean (`node node_modules/typescript/bin/tsc --noEmit` in app/)
3. visual claims proven with a playwright screenshot
4. seal: local `node engine/keel.mjs seal --letter-file <f> --lane kimi`, then cloud `keel_letters` POST with `[lane: kimi]` prefix

## 7. the roadmap

- **P1** vault properties, daily notes, templates `[live — sealed 783ab5b3]`
- **P2** fusion search in the ctrl+k palette `[live — sealed 2351365d]`
- **P3** facet-poured theme system `[live — sealed 8d24baed]`
- **P4** canvas-lite `[live — sealed 78037cd3]`
- **P5** vault sync story `[live (script) — sealed b73a9919; one founder-gated sql step for the table]`
- **P6** this godspec completed to full register + github release `[the doc you are reading; the push is founder-gated]`

### what comes after (the honest backlog, from the canon)

- **the founder-side instrument** *(canon engineer-01/02)*: a recorded, protected "no" for the human — refuse once, protect from re-asking, reopen only on new evidence. the refusal calculus currently armors only the machine.
- **the worth stack, carried** *(C6)*: facet pours are the estate's generative output; ladder.ts's principle (*earned by surviving consequence, never by waiting*) is not yet pointed at them. distribution, not invention.
- **succession of judgment** *(engineer-01)*: the keel carries decisions; it does not yet carry taste. the hardest arc, named and unbuilt.
- **forgiveness operator** *(luna-2)*: the one reparative mechanism in the estate, not yet ported.

---

*written by kimi lane, 2026-08-15, completed through P6 in the same sitting. every `[live]` above carries a seal in the chain (links 10-15) and a row in the cloud. the cuts stay cut until the founder says otherwise.*
