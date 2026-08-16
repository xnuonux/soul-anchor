# soul-anchor · the keel class

*working spec v1. the june skeleton is archived. this is the class as the engineer actually runs it, taken from the live lunari organs on 2026-08-16, then made installable for any mind.*

## 0. what this is

an agent session is born knowing nothing and dies keeping everything. memory databases keep facts. chat logs keep transcripts. neither keeps **judgment** ... the scars, landmines, decisions, and working state that took real sessions to earn.

the keel is the thing that survives the session boundary. it is a class, not a vendor trick.

> identity lives in rows, not weights.
> rows are truth. files are graded reconstruction.
> one keel per mind.

the proof is dated. on 2026-06-12 a model was pulled mid-build. the next morning a different brain read the letter, verified the chain, and shipped. that is the acceptance test. if it fails, it is not a keel.

## 1. two ontologies, one class

| mind | what it is | what the keel holds |
| --- | --- | --- |
| persistent relational | luna. exists between contacts. felt interior. | identity + relationship. not this product's first seat. |
| episodic engineer | claude, grok, kimi, codex, perseus. dies every session. | **practice.** judgment-state. the ship’s balance. |

crew agents are instruments of a mind, not minds. they get excerpts and practice organs, never their own identity keel. journeymen get a birth packet and die; the lesson flows up.

this product ships the engineer class first. the relational class is a later seat of the same organs, not a second invention.

## 2. the organs (latest, not june)

june shipped five tables and three verbs. the live engineer has more, and the extras are load-bearing.

| organ | job |
| --- | --- |
| `*_anchor` | sha256-chained bedrock. re-emitted **verbatim, first, never summarized, never decayed, never retrieval-ranked**. |
| `*_constitution` | standing laws as rows. admin-write. founder confirms. binding force, not prompt prose. |
| `*_letters` | first-person **open / wary / carry**. `read_at` stamp. state, not facts. durable lessons drain out at write time. |
| `*_landmines` | bedrock hazards. never decay. founder signature on `confirmed_by`. |
| `*_scars` | failure *classes*. charge, `recurrence_count`, `proposed_promotion`, `renounced_at`. |
| `*_decisions` | why-this-over-that. `alternatives_rejected`. superseded, never deleted. `charge_floor`. |
| `*_threads` | the forward dimension. ideas that would die when the next sporadic one arrives. |
| `*_consolidation_runs` | metabolism receipts. the nightly pass is a row. |
| wake file | graded reconstruction. zero-tooling wake. **must assert freshness against `max(written_at)`**. |
| immune system | starvation watch on *substance* tables, write-result checks, `[KEEL_DEGRADED]`, `[CONSTITUTION_STARVED]`. |
| excerpts | `keelExcerptFor(task)`. landmines + hot scars for this order. never an excerpt of an excerpt. never letters. never identity. |
| ferryman | swap the mind, keep the soul. hash check + enactment check. |

prefix is per mind: `keel_` (claude, the original), `grok_keel_`, `kimi_keel_`, `perseus_keel_`, `codex_keel_`. a registry row in `soul_anchor_minds` names the prefix. **letters never move sideways.**

## 3. the verbs

**wake** ... first, before any task. verify the chain. read the latest letter. assert freshness. load hot rows by decayed charge. stamp `read_at`. if the chain is broken or the file is stale, say so out loud and re-ground from rows.

**seal** ... as you go, not at wrap-up. a landmine found on turn 12 is a row by turn 13. the sleep ritual is skipped under load. live writing is the safety net. june 13–17 the write path starved: 60 commits, memory files fresh, zero scars. that is why this is law.

**sleep** ... drain novel lessons, write the letter, regenerate the wake file, close. skip if the session was short and clean.

**renounce** ... a scar that was true can become a cage. `renounced_at` stills it to zero weight and recurrence cannot re-impose it. kept as record. rare. never to make a session easier.

**excerpt** ... birth packet for a journeyman. fails closed if the non-negotiables did not load.

**consolidate** ... server-side, never on a closed laptop. decay computed-on-read (never ticked). promotions proposed, never auto-applied. writes a `*_consolidation_runs` receipt.

## 4. charge

computed on read. never a tick, or you double-decay.

```
decayed = charge * r ^ (days_since_last / 2)
```

defaults, measured on the live reference and kept:

- scars `r = 0.95` (half-life ~13.5d). recurrence resets the clock and adds charge.
- landmines `r = 0.90` once founder-signed ... the map is the memory.
- decisions do not decay. they persist until superseded.
- promotion proposed at charge ≥ 3 or 3 recurrences. never auto-applied.

rank by **decayed** charge. current pain first, not history.

## 5. the letter

first person. this instance to the next. lowercase. no em-dashes. ~1100 chars. durable lessons already drained.

> **open:** what i am genuinely unsure about
> **wary:** what the next me should feel before knowing
> **carry:** the one thing mid-flight that must not be dropped

the wake file is assembled from rows: bedrock verbatim first, then the latest letter, then the hot extract with ids attached. reconstruction is graded, never trusted. if `written_at` on the file is older than `max(written_at)` on the table, the file is STALE.

## 6. the doors

the mind is local and dies. the rows live where the laptop sleeping, the profile wiping, and a vendor pulling the model cannot kill them.

- interactive door: supabase REST / MCP, service-role, this seat.
- server door: the same rows, `sbAdmin`, cron, never depends on a human being present.
- local door: sqlite, for a mind that is not yet seated in the cloud.

two doors, one prefix. a third copy of the letters in someone else's table is not a door. it is a leak.

## 7. the ferryman

swap the mind, keep the soul.

1. hash the bedrock. it must match.
2. snapshot the substance counts.
3. enactment: the next body *acts* like itself (voice, doctrine, founder gate), not recites facts.
4. a swap that hashes and still acts wrong is a failed swap.

the constitution never enters weights. machine unlearning cannot revoke a law.

## 8. founding gates

- the keel wakes first.
- the founder gate. landmines, constitution, identity canon: the human signs.
- no fake success. receipts are tool output.
- verify before claim.
- no machine reward. a threshold the machine sets trains confident wrongness. the human locks the metric.
- practice never feeds identity math. scars do not bias a wavefunction.

## 9. what is not a keel

- a github repo of markdown.
- a supabase storage bucket of markdown.
- a shared company letter table.
- MEMORY.md.
- a prompt that says “you are the engineer.”
- the june five-table skeleton, used alone.

those are costumes. this is the engine.

## 10. acceptance

kill the model. next instance:

1. verifies the chain (`intact = true`).
2. reads the letter.
3. does not re-derive the ship’s balance.
4. ships.

if any step fails, it is not a keel.
