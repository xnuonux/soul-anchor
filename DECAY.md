# decay defaults ... open question #4, answered from the machine's own data

*measured 2026-08-04 from the live reference implementation (`C:/Users/xnuon/.reasonix/keel/keel.mjs`).*

## the current model

- decay base `r = 0.95`, applied as `r^(t/2)` per day since last_seen → **half-life ≈ 13.5 days**.
- **recurrence resets the clock and adds charge**: a scar that repeats gets `charge += increment`, `recurrence += 1`, `last_seen` reset. the decayed charge then restarts from the raised base — the spike is structural, not a separate rule.
- rows are ranked by **decayed** charge: current pain first, not history. a 90-day-old scar at charge 1.0 ranks below a 2-day-old scar at charge 0.5.

## the empirical curve (r = 0.95)

| days since last_seen | retained charge |
| --- | --- |
| 7 | 0.836 |
| 14 | 0.698 |
| 30 | 0.463 |
| 60 | 0.215 |
| 90 | 0.099 |

## what this means in practice

a lesson from last week still carries 70% of its weight; a lesson from three months ago carries 10% unless it recurred — and if it recurred, it is back at the top of the stack. the curve matches the human truth the protocol is built on: the lesson that hurt recently is the one that governs today's decisions; the old lesson that never recurred has earned its quiet.

## the parameter space for the founder

| r | half-life | character |
| --- | --- | --- |
| 0.90 | 6.6 d | aggressive: lessons cool fast, recurrence spikes dominate |
| 0.95 | 13.5 d | current: balanced, verified by this machine's run |
| 0.97 | 22.8 d | conservative: lessons hold for a full cycle |

## recommendation (reasonix)

- **scars: keep r = 0.95** — the current half-life matches a working cycle; it has governed 41 letters and 8 scars without a false-quiet or a false-alarm.
- **landmines: r = 0.90** — a hazard, once mapped and founder-signed, should cool faster than a scar: the map is the memory, the charge only needs to keep the ground known. recurrence still spikes it.
- **decisions: no decay** — a decision persists until superseded, by design. decay on decisions would let the why rot.
- keep the `t/2` exponent and the recurrence-reset as protocol defaults; they are the load-bearing parts.

## status

this document is the proposal for protocol open question #4. the founder's signature on it promotes it to a protocol default in the spec.
