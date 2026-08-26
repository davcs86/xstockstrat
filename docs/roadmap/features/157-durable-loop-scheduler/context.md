# Context: durable-loop-scheduler

**Feature**: `docs/roadmap/features/157-durable-loop-scheduler/feature.md`
**Product Spec**: `docs/roadmap/features/157-durable-loop-scheduler/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/157-durable-loop-scheduler/implementation-spec.md`

---

## Session 2026-08-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user story.
- Origin: follow-up to feature 156 (`fix-fundamentals-signal-producer`), which made only the
  fundamentals producer's schedule durable/crash-safe. This feature generalizes 156's mechanism (the
  `analysis.fundsignal_schedule` row + write-next-due-after-completion + compute-sleep-until-due +
  startup jitter + retry cadence) into a shared helper + a `(job_name, user_id)`-keyed table, and
  migrates the analysis interval loops (`fundsignal_loop`, `live_loop`; opportunity refresh pending an
  OQ) onto it.
- **Merge-order:** depends on and merges after feature 156 (which introduces the table + mechanism this
  feature refactors). The 157 branch is currently stacked on the 156 branch; once 156 merges to
  main-dev the 157 PR shows only the 157 additions.
- Consumer surface (C-14): **None (internal/platform)** — changes scheduling reliability of existing
  loops; no new user surface (156 already shipped the config-ui trigger).
- Open questions carried to design: (1) wall-clock vs interval schedules (opportunity refresh is a daily
  wall-clock pass, not an interval loop); (2) whether any current loop is genuinely per-user-scheduled
  (both live_loop and opportunity refresh are single global passes iterating users internally — the
  per-user key may be forward-looking schema, weigh against principle #2); (3) new-table + data-copy vs
  additive ALTER of fundsignal_schedule (F-01 forbids editing applied migration 019 either way).
- Ledger grounding: 2026-08-25 / feature 156 insight — keep the crash-safe *write-after-completion*
  shape; do NOT rebuild lease/CAS/process_name fencing on an instance_count:1 service.

## Session 2026-08-26 — sdd-review product-spec

- Product spec reviewed via `/sdd-review durable-loop-scheduler product-spec` (spec-reviewer +
  feature-overlap subagents). Status: draft → spec-ready.
- **spec-reviewer**: initial verdict FAIL on criterion 9 (four unchecked Open Questions), all
  code-checkable claims verified (live_loop.py, run_opportunity_refresh_forever, pnl_pattern_consumer,
  entry_backfill, migration 019, config keys, feature 156 at code-completed). Three advisory warnings.
- **Two scope-defining OQs resolved with the operator (2026-08-26):**
  - OQ#1 (interval vs wall-clock) → **include wall-clock mode.** Shared helper now supports interval
    *and* wall-clock-anchored modes (FR-1); the daily opportunity refresh is in v1 (new FR-6, migrated
    as a global wall-clock job anchored to the existing `analysis.opportunity.refresh_hour_utc`).
  - OQ#2 (per-user key) → **ship it.** Table carries `(job_name, user_id)` from v1 (FR-2), matching the
    story's generalization goal — recorded as the accepted principle-#2 exception (forward-looking
    schema, operator-signed-off, not a silent guess).
  - OQ#3 (table strategy) and OQ#4 (ledger multi-instance-fencing trap) remain as design-scoped,
    non-blocking notes.
- **Warnings addressed** in `acceptance.feature`: quantitative bounds replace qualitative "promptly"
  (jitter window `[0,N]`, `21600s`, `300s`, `08:00 UTC`); @AC-4's compound four-trigger `When` split
  into atomic scenarios (@AC-4 fresh-boot / @AC-5 redeploy+crash+manual); @AC-6 (was the source-
  inspection `Then`) reframed as an observable `[0,30]` delay + retry-advance. Scenarios re-mapped to
  8 IDs covering FR-1..FR-6 (safe to renumber pre-gate — no test steps cite these IDs yet).
- **Overlap scan: CLEAN** (no FAIL). Only 156 shares concrete resources and is correctly sequenced
  (lands first; 157 rebases + takes next-free migration `020`). Added a hard build-order row to
  `docs/roadmap/features/merge-order.md`: 157 → 156 (Resolved: No).
- Next: `/sdd-design durable-loop-scheduler`.
