# decay defaults

measured on the live reference, kept as protocol defaults.

- scars: `r = 0.95`, `r^(t/2)` per day since last_recurred. half-life ≈ 13.5 days. recurrence resets the clock and adds charge.
- landmines: `r = 0.90` once founder-signed. the map is the memory; charge only keeps the ground known.
- decisions: no decay. persist until superseded.
- rank by **decayed** charge. a 90-day scar at 1.0 loses to a 2-day scar at 0.5.
- promotion proposed at charge ≥ 3 or 3 recurrences. never auto-applied.
- `renounced_at` stills a scar to zero. recurrence cannot re-impose it.

see SPEC.md §4.
