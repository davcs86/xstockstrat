# Context: durable-loop-scheduler  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Generalized feature 156's crash-safe fundamentals scheduler (a single
`analysis.fundsignal_schedule` row + write-next-due-after-completion) into a thin shared
`DurableSchedule` helper (`app/engine/durable_schedule.py`) plus a `(job_name, user_id)`-keyed
`analysis.job_schedule` table (migration 020, an additive in-place `ALTER RENAME` of 019's table).
Two loops migrated: `fundsignal_loop` (interval) and the opportunity refresh (wall-clock). Shipped
narrower than the original story: `live_loop` was deliberately excluded, and the opportunity loop's
enumeration-failure behavior changed from skip-to-tomorrow to retry-soon.

**Why (irrecoverable rationale)**: The helper extracts only the timing/persistence seams
(`seed`/`next_sleep_seconds`/`advance`) and leaves each loop's own `_tick`/`run_forever`
(disabled-gate, overlap lock, config reads) in place — because the three loops' disabled/guard shapes
differ structurally (fundsignal config-gate + full-interval-sleep vs opportunity startup-None-guard vs
live_loop none), so a wide "god driver" injecting the gate/cycle/retry as callables would be lossy and
risk regressing 156's inherited `@AC-*`. The `user_id` column ships UNUSED (both loops are single
global passes iterating users internally) as a deliberate operator-signed forward-looking-schema
exception to principle #2 — not a silent guess.

**Rejected alternatives** (all were in the now-deleted design.md):
- Migrate `live_loop` too (original FR-4) — lost: a ~60s loop protects ≤60s of cadence for ~1440
  writes/day; a durable row + blanket retry cadence buys nothing and would SLOW its recovery.
- `run_scheduled(...)` god-driver injecting 6+ callables — lost: structurally-different disabled/guard
  shapes made it lossy, risking `@AC-5` regression.
- Fresh generalized table + `INSERT…SELECT` copy — lost: leaves an orphaned dead `fundsignal_schedule`;
  the in-place RENAME preserves the one row with no orphan.
- `advance()` branching on mode — lost: would duplicate the anchor-hour getter into a second seam;
  a uniform `advance(seconds)` keeps the persistence unit clean.

**Scars & gotchas**:
- The `020.up` `DROP CONSTRAINT fundsignal_schedule_pkey` depends on Postgres's auto-derived PK name
  for 019's inline `job_name text PRIMARY KEY`; predicted correct and needed no apply-time `\d`
  substitution. The escape hatch (substitute + log per F-09) was pre-planned but unused.
- Wall-clock durability only closes a narrow gap: the loop was already largely redeploy-safe via
  next-hour math, so persistence there only protects a crash inside the fire-window (a skipped day).
- Grounding friction: because 158 was stacked on unmerged 156, design/spec/review all ran on a
  synthetic local branch that merged 156's landed code into the tree (design-grounding-157/
  spec-grounding-157), cherry-picking only 158's doc commits back to the clean PR branch — repeated
  three times until 156 merged. (Recorded at insights.md 2026-08-26, ordering.)

**Permanent deviations**: None. Design offered a re-export shim as a fallback for the relocated
`seconds_until_hour_utc`; shipped deleted the servicer copy outright after grep-confirming zero refs —
this was the design's preferred branch.

**Cross-feature signal**: Third link in a durability chain: 156 built the mechanism, 158 generalized
it, both honor the 156 no-lease insight — do NOT rebuild lease/CAS/`process_name` fencing on an
`instance_count:1` service. The `job_schedule` table + `DurableSchedule` are now the platform's
reusable durable-timer primitive for analysis loops.

**Deferred follow-ons**: A `live_loop` prompt-on-boot durability follow-up "may be filed later; not
bundled here." The unused `user_id` key awaits a genuine per-user-scheduled job; that future feature
must NOT blindly trust `020.down`'s reversibility, which holds only under the v1 single-global-row
invariant (comment in `020.down.sql`).

**Ledger entries written**: insights.md (1, ordering — the stacked-feature grounding-branch tactic),
fails.md (1, assumption — spec "already exists" claims must be grep-confirmed) — see the 2026-08-26
entries. The generalize-only-the-narrow-seams / no-durable-row-for-a-sub-redeploy-interval design was
already recorded at insights.md:2129-2146 (DUP, not re-added).
**Runtime-invariant recommendations (→ /context-constitution)**: none — the `job_schedule` shape, the
`user_id NOT NULL DEFAULT ''` idempotency, and the two `analysis.opportunity.*` config keys are all
recoverable from the migration / CLAUDE.md / config-governance.
**Scenario promotion (C-16)**: 6 NEW `@AC-*` promoted to
`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature` (AC-1,2,3,7,8,9); `@AC-4`/
`@AC-5` OVERLAP the feature-156 fix-fundamentals-signal-producer suite (skipped, not re-promoted);
`@AC-6` retired at design (live_loop descoped), ID not reused.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
