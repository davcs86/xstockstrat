# Product Spec: durable-loop-scheduler

**Created**: 2026-08-26
**Depends on / merges after**: feature 156 (`fix-fundamentals-signal-producer`) — this generalizes the
mechanism 156 introduced (`analysis.fundsignal_schedule` + write-next-due-after-completion + compute-
sleep-until-due + startup jitter + retry cadence). Merge-order: 156 first.

---

## Problem Statement

Feature 156 made only the fundamentals producer's schedule durable and crash-safe. Every other
recurring background loop in `xstockstrat-analysis` still schedules with an in-process `asyncio.sleep`
and therefore (a) does not fire promptly on boot and (b) resets its cadence on every CI/CD redeploy —
the exact class of bug 156 fixed, still live for the interval-based `live_loop` (live strategy
evaluation) and, in a related form, the wall-clock-anchored daily opportunity refresh
(`run_opportunity_refresh_forever`). The fix mechanism should be a shared, reusable scheduler rather
than copy-pasted per loop.

## User Story

As a platform operator, I want every recurring background loop to inherit the durable, crash-safe
schedule (prompt first-run on boot, redeploy-safe cadence, crash-safe retry, bounded startup jitter)
from one shared mechanism, so that reliability is uniform and no loop silently stops firing under normal
deploy churn.

## Functional Requirements

FR-1. A **shared durable-schedule helper** (a small reusable unit in `xstockstrat-analysis`, factored
out of feature 156's inline `fundsignal_loop` logic) provides: seed-at-boot, `next_sleep_seconds`
(compute-sleep-until-due, no polling), and `advance` (write next-due **only after** a run completes —
next cadence on success, a short retry cadence on a caught error), plus a bounded one-shot startup
jitter. The helper supports **two due-time modes**: an **interval** mode (next-due = completion + a
fixed interval, as in feature 156) and a **wall-clock** mode (next-due = the next occurrence of a
configured UTC hour). A loop opts in by calling the helper and naming its mode; it never re-implements
the timing.

FR-2. A **generalized schedule table** keyed by `(job_name, user_id)` — `user_id` empty/NULL for a
**global** job (one schedule per job), set for a **per-user** job (one schedule per `(job, user)`) —
backs the helper. The table supports both global and per-user jobs from v1 (the per-user key is part of
the requested generalization, so no second migration is needed when the first per-user loop arrives).
The feature-156 `analysis.fundsignal_schedule` special case is folded into this table (v1: migrate its
single global `job_name='fundsignal'` row).

FR-3. The **fundamentals producer** is migrated onto the shared helper/table (interval mode) with **no
behavioral regression**: feature 156's `@AC-1..7` (prompt-on-boot, redeploy-safe, crash-safe, retry
cadence, disabled-no-advance, no-manual-contamination, bounded jitter) continue to hold.

_(FR-4 — migrating the live evaluation loop — was **descoped at design** by operator decision; see Out
of Scope. The FR number is retired for this feature, not reused.)_

FR-5. Each migrated loop's operational tunables (interval/refresh-hour already exist per loop;
**startup jitter** and **retry cadence**) are configuration-driven per the config-governance
convention — either reusing a shared default or a per-loop `<service>.<loop>.*` key (decided at
design), never hardcoded (F-07).

FR-6. The **daily opportunity refresh** (`run_opportunity_refresh_forever`) is migrated onto the shared
scheduler as a **global wall-clock** job anchored to its existing `analysis.opportunity.refresh_hour_utc`
key: it re-anchors to that UTC hour across redeploys and re-runs promptly after a crash, without the
in-process sleep loop it uses today. Its output (the opportunity queue) is unchanged.

## Out of Scope

- **The live evaluation loop (`app/engine/live_loop.py`) — descoped from v1 at design (operator
  decision, 2026-08-26; sign-off recorded in `context.md`).** Its interval is ~60s
  (`analysis.engine.eval_interval_seconds`, default 60), so a durable per-cycle schedule row would write
  ~1440 rows/day to protect at most ~60s of cadence across a redeploy — the payoff a durable schedule
  gives an hours/daily loop does not exist here, and a blanket retry cadence would slow its recovery.
  `live_loop` keeps its current in-process `asyncio.sleep`. A small **prompt-on-boot** fix
  (run-then-sleep + bounded jitter, no persistence) could be filed as a separate follow-up if desired;
  it is deliberately **not** bundled into this durable-schedule feature. This leaves the shared helper
  proven on two loops (fundsignal interval + opportunity wall-clock), which is a genuine two-mode
  generalization.
- **Event-stream cursor consumers** that are already restart-durable — `pnl_pattern_consumer` (its
  `analysis.ledger_stream_cursor` already survives restarts). Not a recurring timer loop; do not touch.
- **Boot-once tasks** — `entry_backfill` (runs once at boot, no recurring schedule).
- **Cross-service generalization** beyond `xstockstrat-analysis` in v1. Other services' recurring loops
  (if any) adopt the pattern in a later feature; v1 proves it on the analysis loops.
- Changing **what** any migrated loop produces (signals, alerts, opportunity rows) — only **when/how
  reliably** it is scheduled.

## Affected Services

- `xstockstrat-analysis` — owns the shared helper, the generalized schedule table + migration, and the
  **two** loops being migrated in v1 (`fundsignal_loop`, interval; and the opportunity refresh
  `run_opportunity_refresh_forever`, wall-clock). `live_loop` is descoped (see Out of Scope).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] UI — none new
- [ ] Agent — none new
- [x] **None** — internal/platform-only. This changes the **scheduling reliability** of existing
  background loops; it adds no new end-user surface. The loops' outputs already reach users through
  existing surfaces (fundamentals signals via ingest; live-strategy alerts via notify; the opportunity
  queue via `/insights/opportunities`) and are unchanged. Feature 156 already shipped the one operator
  surface (the config-ui "Run fundamentals scan" trigger); this feature does not add another.

## Proto Contract Changes

- [x] No proto changes required.

## Config Key Changes

Decided at design (FR-5) — **two new keys**, both read presence-aware via `get_int_present` (F-07),
with declared defaults added to `services/xstockstrat-analysis/CLAUDE.md` (C-05):

- `analysis.opportunity.startup_jitter_seconds` (default 30)
- `analysis.opportunity.retry_seconds` (default 300)

These mirror feature 156's `analysis.fundsignal.startup_jitter_seconds` / `.retry_seconds`. The
opportunity refresh's wall-clock anchor reuses the **existing** `analysis.opportunity.refresh_hour_utc`
key — no new anchor key. `fundsignal`'s three existing keys are unchanged. No key is removed.

## Database Changes

- One new migration `020_job_schedule.{up,down}.sql` in `services/xstockstrat-analysis/migrations/`
  (next free NNN; `019` is the latest). **Design decided the additive-`ALTER` strategy** (over a
  fresh-table + data-copy): `ALTER TABLE analysis.fundsignal_schedule RENAME TO job_schedule`, add
  `user_id text NOT NULL DEFAULT ''`, and re-key the PK to `(job_name, user_id)` — preserving the
  persisted `fundsignal` row with no data copy and leaving no orphaned table. The paired `.down.sql`
  reverses it (drop composite PK → drop `user_id` → restore bare PK → rename back), reversible under the
  v1 single-global-row invariant (a comment in the `.down.sql` records that assumption). **Never edit
  the applied `019_fundsignal_schedule` migration** (F-01) — `020` is a new numbered migration that
  renames the table `019` created, which is allowed. Reuses the existing analysis pool — no new pool
  (F-06).

## Feature Workflow Notes

Branch to create: `feature/durable-loop-scheduler` (branch from `main-dev`, after 156 lands).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] DBA review + `xstockstrat-analysis` owner (schema migration)
- [x] `xstockstrat-analysis` owner (any new config keys)
- [ ] Proto approvals — N/A (no proto change)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Resolved Design Decisions

Resolved with the operator (2026-08-26) — these were the scope-defining questions from the initial
draft; recorded here so the FRs above are internally consistent:

- **Interval vs wall-clock (was OQ#1) → both.** The shared helper supports an interval mode *and* a
  wall-clock-anchored mode (FR-1), so the daily opportunity refresh is **in v1** (FR-6), not deferred.
- **Per-user key (was OQ#2) → ship it.** The generalized table carries the `(job_name, user_id)` key
  from v1 (FR-2), supporting both global and per-user jobs, matching the story's generalization goal —
  even though no v1 loop is yet per-user-scheduled (the per-user half is deliberately forward-looking
  schema the operator signed off on, not a silent guess). This is the accepted, recorded exception to
  principle #2 for this feature.
- **`live_loop` descoped (design, 2026-08-26 — operator).** During the design debate the adversary
  showed a durable schedule row buys `live_loop` (a ~60s loop) almost nothing (protects ≤60s of cadence
  for ~1440 writes/day) and a blanket retry cadence would slow its recovery. The operator chose to
  **exclude `live_loop` from v1** rather than half-migrate it; FR-4 is retired (see Out of Scope).
- **Shared unit shape (design).** A **thin `DurableSchedule` class** owns only the mode-branched
  timing/persistence seams (`seed`/`next_sleep_seconds`/`advance`); each migrated loop keeps its own
  `_tick`/`run_forever` (disabled-gate, overlap lock, config reads, cycle body) — not a wide "god
  driver" — so feature 156's `@AC-1..7` behavior stays local to `fundsignal_loop`.
- **Opportunity error semantics (design).** Enumeration failure raises → helper retries after
  `retry_seconds`; per-user failures are swallowed exactly as today → the pass counts as complete and
  advances to the next wall-clock hour. This changes enumeration-failure recovery from today's
  skip-to-tomorrow to retry-soon — a deliberate improvement, guarded by new scenario `@AC-9` and
  recorded here.

## Open Questions (resolved at design)

- [x] **Table strategy** → **additive `ALTER`** (rename `fundsignal_schedule` → `job_schedule`, add
  `user_id`, re-key PK). Chosen over fresh-table + data-copy: preserves the row with no copy, no orphan.
  See Database Changes.
- [x] **Known trap (ledger, 2026-08-25 / feature 156)** → **honored.** The `DurableSchedule` helper
  keeps 156's write-**after**-completion shape; `process_name` stays a diagnostic last-runner column;
  **no** lease/CAS/process_name-fencing is rebuilt (correct for the `instance_count:1` service).
