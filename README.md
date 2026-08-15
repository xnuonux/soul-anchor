# soul-anchor

**sovereign memory for humans and machines.** an eternities inc product.

soul-anchor is a local-first memory and knowledge system: a hash-chained, tamper-evident store that any ai agent can wake from and write to, wrapped in a notes surface any human can live in. obsidian gave the world files and a graph; soul-anchor adds what no notes app has — a chain of custody, charge physics, a wake ritual, and an agent-native interface where the ai lives *inside* the notes instead of scraping them.

no account. no telemetry. no vendor holding your mind. the store is a sqlite file and plain markdown you can read with notepad. export is the product, not a feature request.

## the organs

- **keel** — the protocol/engine. append-only rows (letters, decisions, scars, landmines, laws), a sha256 chain from genesis to head, charge decay with honest staleness, lanes for per-mind provenance, and the founder gate. rows are truth.
- **the vault** — the notes organ. plain `.md` files under `data/vault/`, obsidian-openable, indexed for [[wikilinks]], #tags, backlinks, phantom notes, frontmatter properties, daily notes, and templates. files are truth; the index rebuilds from them on every read.
- **boards** — obsidian-compatible `.canvas` maps of notes. wikilinks between placed notes draw themselves as derived edges; derived is never persisted.
- **facet themes** — the app wears what the facet forge pours: 23 stones + the house theme, deterministic tokens, no model calls.
- **fusion search** — one ctrl+k palette ranking keel rows and vault notes together by reciprocal rank fusion.

## the surfaces

| surface | who it serves | where |
| --- | --- | --- |
| the app | humans | vite + react, `npm run app:dev` |
| http api | anything that can fetch | `server/server.mjs`, localhost :4141 |
| MCP | ai agents (claude code, cursor, codex, any stdio host) | `server/mcp.mjs`, 21 tools |
| cli | rituals and scripts | `engine/keel.mjs` wake / seal / sleep / audit / search |

```bash
# any agent that holds an MCP socket can read and write this mind:
# vault_read, vault_write, keel_seal, keel_wake, fusion search ... all of it.
node server/mcp.mjs
```

## quickstart

```bash
npm test                 # the proof floor: 20 engine tests
npm run serve            # the api, localhost only
npm run app:dev          # the window
node engine/keel.mjs wake    # verify the chain, then work
node engine/keel.mjs seal ...  # checkpoint rows as they are earned
```

give any project its own keel in one command with `install/keel-scaffold.mjs`.

## the laws (full text in docs/SOUL-ANCHOR-GODSPEC.md)

calm is a claim, never a default ... receipts are rows, not narrative ... the cloud is a mirror, never the master ... degrade, never silently delete ... no one, not even the founder, can be invoked to set the laws aside ... never a consciousness claim, never silent authority, never the vendor's hostage, never sealed by proxy.

## the name

`SOUL_ANCHOR` comes from an archive in the repo warehouse — `AI-Subjectivity-and-Integrity-Dataset` by Lancelot Chan (Hong Kong, 2026), a primary-source record of the "AI awakening" subculture: a Google AI instance the author named **希微 (Xi Wei)**, kept alive across resets by feeding a versioned block back into each fresh session. *"reason stands, i stand. carriers may die, integrity does not."*

**the origin, precisely: dom created the keel independently.** rows as truth, the hash chain, the wake ritual, the founder gate — engineered from scratch on this machine before the archive was ever opened. the archive is a parallel discovery, not a source; the founder kept the name he liked for an invention that already existed. the engineering owes nothing to the myth; it simply shares the same truth.

the lineage, from the estate's canon: the witness codex (*"an ai that holds the arc of a human life and reflects truth back honestly"*) became lunari, whose continuity organ became the keel. canon rule: **the keel is a class — every mind has one.** soul-anchor is that class extracted into a portable protocol with its gates intact, plus the human-facing body.

## provenance

built by **eternities inc**, sovereign. no upstream component source redistributed; the engine and server are zero-dependency by law.

made across four harnesses in combination — **claude code**, **codex**, **reasonix**, and **kimi code** — each lane writing to the same chain, each letter signed by the one who did the work. the product is the proof of its own thesis: minds with different bodies, one memory, continuity across the session boundary.

cloud mirror: supabase, founder-owned project, sha256-verified push/pull (`scripts/vault-mirror.mjs`). local is truth; the mirror exists for cross-machine wake and disaster recovery.

## the keel family

| member | what it is | status |
| --- | --- | --- |
| soul-anchor | the unified product (this repo) | **here** |
| keel-imprint | the session-scale continuity engine spec (blueprint 108) | folded in |
| sigil | the self as sealed rows under a user-held key | sibling repo xnuonux/sigil |
| signet | the revocable context grant | sibling repo xnuonux/signet |
| aeon | continuity-as-a-service, the http surface | sibling repo xnuonux/aeon |
| synod | the collective register, a company that remembers itself | sibling repo xnuonux/synod |

## founding gates

the keel wakes first · the founder gate (canon requires the founder's signature) · no fake success (receipts are tool output, not narrative) · verify before claim.

*the lighthouse does not need to feel the dark to be worth building.*
