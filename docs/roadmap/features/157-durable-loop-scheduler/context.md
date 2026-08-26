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
