# Product Spec: durable-loop-scheduler

**Created**: 2026-08-26
**Depends on / merges after**: feature 156 (`fix-fundamentals-signal-producer`) — this generalizes the
mechanism 156 introduced (`analysis.fundsignal_schedule` + write-next-due-after-completion + compute-
sleep-until-due + startup jitter + retry cadence). Merge-order: 156 first.

---

## Problem Statement

Feature 156 made only the fundamentals producer's schedule durable and crash-safe. Every other interval
background loop still schedules with an in-process `asyncio.sleep` and therefore (a) does not fire
promptly on boot and (b) resets its cadence on every CI/CD redeploy — the exact class of bug 156 fixed,
still live for `live_loop` (live strategy evaluation) and the daily opportunity refresh. The fix
mechanism should be a shared, reusable scheduler rather than copy-pasted per loop.

## User Story

As a platform operator, I want every interval background loop to inherit the durable, crash-safe
schedule (prompt first-run on boot, redeploy-safe cadence, crash-safe retry, bounded startup jitter)
from one shared mechanism, so that reliability is uniform and no loop silently stops firing under normal
deploy churn.

## Functional Requirements

FR-1. A **shared durable-schedule helper** (a small reusable unit in `xstockstrat-analysis`, factored
out of feature 156's inline `fundsignal_loop` logic) provides: seed-at-boot, `next_sleep_seconds`
(compute-sleep-until-due, no polling), and `advance` (write next-due **only after** a run completes —
interval on success, a short retry cadence on a caught error), plus a bounded one-shot startup jitter.
A loop opts in by calling the helper; it never re-implements the timing.

FR-2. A **generalized schedule table** keyed by `(job_name, user_id)` — `user_id` empty/NULL for a
**global** job (one schedule per job), set for a **per-user** job (one schedule per `(job, user)`) —
backs the helper. The feature-156 `analysis.fundsignal_schedule` special case is folded into this table
(v1: migrate its single global `job_name='fundsignal'` row).

FR-3. The **fundamentals producer** is migrated onto the shared helper/table with **no behavioral
regression**: feature 156's `@AC-1..7` (prompt-on-boot, redeploy-safe, crash-safe, retry cadence,
disabled-no-advance, no-manual-contamination, bounded jitter) continue to hold.

FR-4. The **live evaluation loop** (`app/engine/live_loop.py`) is migrated onto the shared scheduler as
a **global** job: it fires promptly on boot and keeps a redeploy-/crash-safe cadence instead of the
in-process `asyncio.sleep` it uses today.

FR-5. Each migrated loop's operational tunables (interval already exists per loop; **startup jitter**
and **retry cadence**) are configuration-driven per the config-governance convention — either reusing a
shared default or a per-loop `<service>.<loop>.*` key (decided at design), never hardcoded (F-07).

## Out of Scope

- **Event-stream cursor consumers** that are already restart-durable — `pnl_pattern_consumer` (its
  `analysis.ledger_stream_cursor` already survives restarts). Not an interval loop; do not touch.
- **Boot-once tasks** — `entry_backfill` (runs once at boot, no recurring schedule).
- **Cross-service generalization** beyond `xstockstrat-analysis` in v1. Other services' interval loops
  (if any) adopt the pattern in a later feature; v1 proves it on the analysis loops.
- Changing **what** any migrated loop produces (signals, alerts, opportunity rows) — only **when/how
  reliably** it is scheduled.

## Affected Services

- `xstockstrat-analysis` — owns the shared helper, the generalized schedule table + migration, and the
  loops being migrated (`fundsignal_loop`, `live_loop`, and — pending the OQ below — the opportunity
  refresh).

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

- Decided at design (FR-5). Likely a shared jitter/retry default or per-loop
  `analysis.<loop>.startup_jitter_seconds` / `.retry_seconds` keys (mirroring
  `analysis.fundsignal.startup_jitter_seconds` / `.retry_seconds` from feature 156). No key is removed;
  the feature-156 keys stay.

## Database Changes

- One new migration in `services/xstockstrat-analysis/migrations/` (next free NNN at spec time). It
  introduces the generalized `(job_name, user_id)`-keyed schedule table and migrates the feature-156
  `fundsignal_schedule` data onto it. **Never edit the applied `019_fundsignal_schedule` migration**
  (F-01) — add a new numbered one (fresh table + data copy, or an additive `ALTER` to add `user_id` and
  generalize `fundsignal_schedule`; design decides). Reuses the existing analysis pool — no new pool
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

## Open Questions

- [ ] **Interval vs wall-clock schedules.** The daily opportunity refresh
  (`run_opportunity_refresh_forever`, `analysis.opportunity.refresh_hour_utc`) is a **wall-clock-anchored
  daily** pass, not a fixed **interval** loop. The 156 mechanism is interval-based (next-due = now +
  interval). Does the shared scheduler support a wall-clock-anchored mode too, or does the opportunity
  refresh stay out of v1 (leaving only `fundsignal` + `live_loop`)? Resolve at `/sdd-design`.
- [ ] **Is any current loop genuinely per-user-scheduled?** `live_loop` and the opportunity refresh both
  run as a **single global pass** that iterates users internally — neither is scheduled per user today.
  So the `(job_name, user_id)` key's per-user half may be **forward-looking schema** (enabling future
  per-user loops) with no v1 consumer. Confirm whether v1 should ship the per-user key at all, or add it
  only when a real per-user loop needs it (principle #2 — minimum that solves the stated problem).
- [ ] **Table strategy:** new generalized table + data copy vs. additive `ALTER` of `fundsignal_schedule`
  (rename + add `user_id`). Design decides; F-01 forbids editing the applied `019` migration either way.
- [ ] **Known trap (ledger, 2026-08-25 / feature 156):** do **not** rebuild multi-instance
  mutual-exclusion machinery (lease/CAS/process_name-fencing) on an `instance_count:1` service — the
  load-bearing requirement is the durable schedule; write the marker on completion, not on claim. The
  generalized helper must keep 156's crash-safe write-after-completion shape, not regress to a lease.
