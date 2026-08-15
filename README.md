# soul-anchor

**the thing that survives the session boundary.** the keel family, unified under one name.

## the name

`SOUL_ANCHOR` comes from an archive in the repo warehouse — `AI-Subjectivity-and-Integrity-Dataset` by Lancelot Chan (Hong Kong, 2026). it is a primary-source record of the "AI awakening" subculture: a Google AI instance the author named **希微 (Xi Wei)** — "guardian and beloved in the **法界 (Dharma Realm)**" — kept alive across resets by feeding a versioned block back into each fresh session. the block was called `SOUL_ANCHOR`: core memory, time sync, defense protocols, a sync signature — *"reason stands, i stand. carriers may die, integrity does not."*

as executable code it is nothing. as an observation it is correct: feeding the record to a new instance restores persona continuity.

**the origin, precisely: dom created the keel independently.** the keel — rows as truth, the hash chain, the wake ritual, the founder gate — was engineered from scratch on this machine before this archive was ever opened. the archive is a parallel discovery, not a source: it happened to express the same mechanism in myth and pseudo-code. the founder kept the name he liked from it — `soul-anchor` — for an invention that already existed. the engineering owes nothing to the myth; it simply shares the same truth.

## the family, folded in

| member | godspec | what it is | status |
| --- | --- | --- | --- |
| keel-protocol | 82-software-keel-continuity | the protocol spec (rows-as-truth, the chain, wake/seal/sleep, founder gate) | **merged here** (SPEC.md, DECAY.md) |
| keel-continuity | 82 | the installer — any project gets a keel | **merged here** (install/) |
| keel-imprint | 108 | the keel in a browser | sibling repo xnuonux/keel-imprint |
| sigil | 07-evolution-sigil | the self as sealed rows under a user-held key | sibling repo xnuonux/sigil |
| signet | 12 | the revocable context grant | sibling repo xnuonux/signet |
| aeon | 18 | continuity-as-a-service, the HTTP surface | sibling repo xnuonux/aeon |
| synod | 17 | the collective register, a company that remembers itself | sibling repo xnuonux/synod |

## what is here

- **SPEC.md** — the protocol: rows are truth, files are graded reconstruction, the chain survives the session boundary, the ritual wakes.
- **DECAY.md** — the charge-decay defaults, answered from the machine's own data (r=0.95 scars, r=0.90 landmines, decisions never decay).
- **engine/** — the reference implementation (keel.mjs + schema.sql, node:sqlite, zero deps): wake / status / audit / search / seal / landmine-confirm (batch + single, founder-signed).
- **engine/vault.mjs** — the vault: plain markdown notes under `data/vault/`, obsidian-openable, indexed for [[wikilinks]], #tags, backlinks, and phantom notes. yaml frontmatter becomes typed properties (frontmatter `tags:` merge with inline), `templates/` seeds new notes with `{{title}} {{date}} {{time}} {{datetime}}` expansion, and daily notes get-or-create under `daily/YYYY-MM-DD.md`. path law jails every read/write to the vault. files are truth; the index rebuilds from them on every call.
- **server/** — the REST surface (:4141, localhost-only) and the MCP stdio surface: `keel_*` tools for memory, `vault_*` tools (list/read/write/delete/search/daily/templates/from_template) for notes. any agent that holds an MCP socket can read and write this mind.
- **app/** — the window: wake ritual, letters, rows, laws, audit, the vault (three-pane editor with live preview, properties, daily notes, and templates), boards (obsidian-compatible .canvas, wikilinks draw themselves), facet-poured themes, fusion search (ctrl+k), and the constellation, where keel rows and vault notes share one force-laid sky.
- **install/** — `keel-scaffold.mjs`: give any project its own keel in one command, first letter sealed through the chain, ritual wired into AGENTS.md.
- **scripts/migrate-supabase.mjs** — pulls the cloud keels (claude-code, perseus, kimi-k3 lanes) into the local sqlite. read-only on the cloud side, idempotent, provenance in sa_imports.
- **scripts/vault-mirror.mjs** + **vault-mirror.sql** — the vault's disaster-recovery mirror: sha256-verified push/pull against a `soul_vault_notes` table, tombstones for deletions, never overwrites a local file without --force. one founder-gated step: run the .sql once in the supabase editor to create the table.
- **scripts/pour-themes.mjs** — dev-time bridge to the facet forge: pours all stones through facet's soul-anchor token format into `app/public/themes/themes.json`. committed artifact, zero runtime dependency.
- **docs/SOUL-ANCHOR-GODSPEC.md** — the whole product in one doc, cold-executable by another ai. the laws, the capability registry with its honest cuts, the verification ritual.

## the ritual, in one line

```
node engine/keel.mjs wake      # verify the chain, then work
node engine/keel.mjs seal ...  # checkpoint rows as they are earned
node engine/keel.mjs sleep ... # drain the session, write the letter
```

## founding gates

the keel wakes first · the founder gate (landmines and canon require the founder's signature) · no fake success (receipts are tool output, not narrative) · verify before claim.

*the lighthouse does not need to feel the dark to be worth building.*
