# Context: durable-loop-scheduler

**Feature**: `docs/roadmap/features/158-durable-loop-scheduler/feature.md`
**Product Spec**: `docs/roadmap/features/158-durable-loop-scheduler/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/158-durable-loop-scheduler/implementation-spec.md`

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
  feature refactors). The 158 branch is currently stacked on the 156 branch; once 156 merges to
  main-dev the 158 PR shows only the 158 additions.
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
  (lands first; 158 rebases + takes next-free migration `020`). Added a hard build-order row to
  `docs/roadmap/features/merge-order.md`: 158 → 156 (Resolved: No).
- Next: `/sdd-design durable-loop-scheduler`.

## Session 2026-08-26 — sdd-design (2 rounds, full)

- **Grounding note:** ran on a local `design-grounding-157` branch that merged 156's landed code
  (fundsignal scheduler, migration 019, specs) into the working tree, since the clean PR branch
  (`feature/durable-loop-scheduler`, PR #1017) is based on `main-dev` and 156 isn't merged yet. The
  recon subagents needed 156's actual scheduler code to be grounded. Only the 158 doc commits are
  cherry-picked back onto the clean PR branch — no 156 code enters #1017.
- **Phase 0 Recon** (recon.md): one `codebase-discovery` (analysis) + one `scenario-recon`. Located the
  seven 156 seams (`fundsignal_loop.py:107-186`), next migration `020`, the two loops' shapes, config
  getters, shared pool, and the 156 `@AC-1..7` regression guard. Two design tensions surfaced:
  `live_loop` is 60s (durable persistence ≈ pointless) and the wall-clock refresh is already largely
  redeploy-safe (durability only closes a narrow crash-window gap).
- **Phase 1 Grilling** (design.md): proposer vs adversary, 2 rounds.
  - **Chosen approach:** a THIN `DurableSchedule` class in `app/engine/durable_schedule.py` owning only
    the mode-branched `seed`/`next_sleep_seconds`/`advance` seams; each loop keeps its own
    `_tick`/`run_forever`. Additive `ALTER` migration `020` (rename `fundsignal_schedule`→`job_schedule`,
    add `user_id`, re-key PK). `seconds_until_hour_utc` relocated from servicer. Write-after-completion
    kept; no lease/CAS (instance_count:1 trap honored).
  - **Rejected:** `run_scheduled` god-driver (lossy for 3 different disabled shapes); fresh-table+copy
    (orphan); `advance` branching on mode.
- **OPERATOR DECISIONS (sign-offs recorded here per C-11/P-04):**
  - **`live_loop` EXCLUDED from v1** (round-1 gate answer "Exclude live loop"). FR-4 retired; `@AC-6`
    retired (not renumbered, C-15 append-only). Rationale in product-spec Out of Scope. A separate
    prompt-on-boot follow-up may be filed later; not bundled here.
  - **Approve design with review warnings fixed first** (round-2 gate answer). All round-2 adversary
    warnings folded into the artifacts BEFORE approval: FR-4/@AC-6 descoped; **new `@AC-9`** added to
    guard the opportunity enumeration-failure change (skip-to-tomorrow → retry-soon); `max(1,retry)`
    clamp, `_opportunities_repo is None` guard, and the `020.down` single-global-row assumption recorded
    as design Open Risks / spec-time guards.
- **Business rules (C-16):** PRESERVE 156 `@AC-1..7`; opportunity retry change is net-new behavior
  (no promoted rule to change), guarded by `@AC-9`.
- **Constitution:** F-01/F-06/F-07 honored; C-05/C-07/C-08/C-11/C-14/C-15 addressed. No Floor breach.
- Status: spec-ready → design-approved. Next: `/sdd-spec durable-loop-scheduler`.

## Session 2026-08-26 — sdd-spec

- Generated implementation-spec.md with **8 steps**. Status → implementation-ready.
- Grounded on the `spec-grounding-157` working branch (156's landed code merged into the tree, same
  approach the design session used) so every `path:line` is verified against real code, not the clean
  `main-dev`-based PR branch which lacks 156.
- Step map: (1) migration `020_job_schedule` additive-ALTER; (2) `durable_schedule.py` shared helper +
  relocated `seconds_until_hour_utc`; (3) helper unit test (@AC-1/2/3); (4) fundsignal migration onto
  the helper + its promoted 156 suite stays green (@AC-4/5/7); (5) two new config keys + CLAUDE.md
  defaults; (6) opportunity refresh wall-clock rewrite (@AC-7/8/9); (7) opportunity test; (8) CLAUDE.md
  module doc. Config (5) ordered before the opportunity consumer (6).
- Scenario coverage (C-15): all live scenarios mapped — @AC-1/2/3→step 3, @AC-4/5→step 4, @AC-7→steps
  4 & 7, @AC-8/9→step 7. @AC-6 is retired (FR-4 descoped), not a live scenario.
- Key codebase findings:
  - **Feature-156 seams confirmed** at `app/engine/fundsignal_loop.py`: `_now_ms`/`_process_name` `:109-113`,
    `_seed_schedule` `:115-122`, `_next_sleep_seconds` `:124-135`, `_advance_schedule` `:137-147`,
    `_tick` `:149-177`, `run_forever` `:179-186` — the exact code the shared helper extracts.
  - **Last migration = `019_fundsignal_schedule`** → next free `020`. `019` up is an inline
    `job_name text PRIMARY KEY` → auto-named constraint `fundsignal_schedule_pkey` (the ALTER target).
  - **`seconds_until_hour_utc` single-caller confirmed**: `grep -rn` over `app/ tests/` shows only the
    def (`servicer.py:3841`) + one call (`servicer.py:3477`) — the opportunity rewrite (step 6) removes
    that call, so the servicer copy is deleted, no re-export shim needed.
  - **Opportunity loop shape** `servicer.py:3466-3493`: `_opportunities_repo is None` guard `:3473-3474`
    (only bail-out), `get_int_present(refresh_hour_utc)` `:3476`, enumeration `distinct_user_ids()`
    `try/except continue` `:3478-3482`, per-user `try/except log.warning` `:3487-3492`.
  - **Config getter** `watcher.py:103-114` `get_int_present` (HasField, 0 legitimate) — the F-07 read for
    both new keys, mirroring fundsignal's jitter/retry keys.
  - **Regression guard** `tests/test_fundsignal_loop.py` `TestScheduler` `:391-519` — 156's promoted
    @AC-1..7; step 4 retargets its SQL-text assertions from `fundsignal_schedule` → `job_schedule` with
    unchanged behavioral intent.
  - Reviewers per registry: `migration` → DBA + analysis owner; `service`/`config`/`test` → analysis owner;
    `docs` → none.

## Open Threads

_All five design-time spec guards were resolved into concrete step instructions:_
- [x] `019` PK constraint name `fundsignal_schedule_pkey` — spelled out in step 1 (with an apply-time `\d`
  fallback note); derivation is the Postgres `<table>_pkey` default for the inline PK.
- [x] `seconds_until_hour_utc` single caller — grep-confirmed (only def + 1 call); step 6 deletes the
  servicer copy, verified by a post-edit `grep` expecting zero matches. No shim.
- [x] `max(1, retry_seconds)` clamp at the opportunity error site — required explicitly in step 6.
- [x] Single-global-row invariant comment in `020.down.sql` — required in step 1.
- [x] Preserve `_opportunities_repo is None` early return in the rewritten `run_forever` — required in step 6.

## Session 2026-08-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings (advisory — did not block). PASS WITH WARNINGS. No Floor breach.
- **Two grounding warnings fixed in the spec this session** (pre-execution, so the fix is a re-spec
  correction, not an F-09 during-execution edit):
  - Step 6: `[x]` FIXED — spec said `DurableSchedule(self._db_pool, …)` but `AnalysisServicer.__init__`
    (`servicer.py:325-332`) stores `db_pool` only inside repos (`:358-402`), never as `self._db_pool`
    (would have hit F-04/C-01 at execute). Added an explicit Instruction to `self._db_pool = db_pool`
    in `__init__` first, plus a Codebase-Evidence note.
  - Step 7: `[x]` FIXED — Codebase Evidence overstated that `test_analysis_servicer.py` "already
    references `run_opportunity_refresh_forever`" (grep: zero matches; only a `distinct_user_ids` fake
    stub at `:3915`). Corrected to "net-new coverage; `distinct_user_ids` stub exists, loop untested".
  - Step 1 (NOTE, not fixed): migration up/down inverse check is prose, not a runnable command —
    acceptable for an un-applied offline migration (reviewer agreed). `[x]` acknowledged, no change.
- **Overlap scan: COLLISIONS FOUND but all with 156** (already the recorded hard dependency): shared
  `app/engine/fundsignal_loop.py` and `services/xstockstrat-analysis/CLAUDE.md` config-table rows.
  Migration `020`, both `analysis.opportunity.*` config keys, `durable_schedule.py`, and `servicer.py`
  are otherwise CLEAN vs all other in-flight features. No new merge-order row required.
- Unresolved ✗ / ⚠ carried into execution: **none** (both C-01 warnings fixed above).

## Session 2026-08-26 — renumber 157 → 158 + rebase onto merged 156

- **Feature-number collision:** `157` was taken by `157-offline-account-portfolios`, which merged to
  `main-dev` while this feature was mid-pipeline on its own branch (never itself pushed to `main-dev`
  under `157`). Per the Feature Numbering collision rule (root CLAUDE.md), the not-yet-merged one
  renumbers → **158**. `git mv 157-durable-loop-scheduler 158-durable-loop-scheduler` + updated all
  self-references (feature/product-spec/recon/design/implementation-spec/context), the `merge-order.md`
  row, and the `insights.md` entry. `@AC-*` IDs and migration `020` unchanged. Git branch stays
  `feature/durable-loop-scheduler` (slug only, no number).
- **156 merged + rebase:** feature 156 (`fix-fundamentals-signal-producer`) landed on `main-dev`, so
  the hard build-order dependency is now satisfied. Rebased `feature/durable-loop-scheduler` onto the
  new `origin/main-dev` — 156's scheduler code + migration `019` are now present in the branch itself,
  so the earlier grounding-branch workaround is no longer needed. `merge-order.md` 158→156 row flipped
  to Resolved: Yes. Confirmed `019` is still the highest analysis migration → `020` remains next-free.
- Rebase conflict on `insights.md` (append-only; `157-offline-account-portfolios` added its own entry)
  resolved by keeping both entries.

## Session 2026-08-26T05:21Z — sdd-review impl-spec (advisory, re-run vs current tree)

- Re-ran the impl-spec review against the current branch (156 merged to main-dev; 019 present) to
  confirm the earlier advisory review still holds. Result: 0 failures, 1 warning, 4 notes (advisory —
  did not block). No Floor breach; F-01 respected (020 adds a new migration, never edits 019).
  Overlap scan: CLEAN (migration 020, both analysis.opportunity.* config keys, durable_schedule.py,
  and servicer.py all uncontested; only 156 shares resources and is already merged).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 1: `DROP CONSTRAINT fundsignal_schedule_pkey` relies on Postgres's auto-derived PK name,
    unverifiable offline. `<table>_pkey` is the correct default for 019's inline `text PRIMARY KEY`.
    If an apply-time `\d` shows a different name, substitute it and record the substitution in the
    `## Deviation Log` (F-09) — do not edit the step body. — [ ] carried (apply-time only)
- Overlap findings: none new (156 dependency already resolved; 156 launched).

## Session 2026-08-26 — sdd-execute (implementation)

- Implemented all 8 steps on branch `claude/features-157-158-impl-ulk0l2` (harness-assigned single
  branch for 157+158; not the per-feature `feature/durable-loop-scheduler`).
- Step 1 apply-time PK-name note (carried warning): `019`'s inline `job_name text PRIMARY KEY`
  auto-names `fundsignal_schedule_pkey` (confirmed by reading `019_fundsignal_schedule.up.sql`), so
  `020.up`'s `DROP CONSTRAINT fundsignal_schedule_pkey` is correct; no apply-time substitution was
  needed. [x] resolved.
- Steps 2-4: `app/engine/durable_schedule.py` (`DurableSchedule` interval+wallclock + relocated
  `seconds_until_hour_utc`); `fundsignal_loop` delegates its three seams to it (behavior-preserving —
  `TestScheduler`'s @AC-1..7 stay green, SQL-text assertions retargeted `fundsignal_schedule` →
  `job_schedule`; the shared AsyncMock db object makes the delegation transparent to the tests).
- Steps 5+8: two new `analysis.opportunity.startup_jitter_seconds`/`.retry_seconds` config keys +
  the shared-scheduler module note in the analysis CLAUDE.md.
- Step 6: `run_opportunity_refresh_forever` rewritten as `_opportunity_refresh_tick`/`run_forever`
  on `DurableSchedule` (wallclock); stored `self._db_pool` in `__init__`; deleted the orphaned
  `servicer._seconds_until_hour_utc` (grep-confirmed zero refs after). Enumeration failure now
  retries after `retry_seconds` (clamped ≥1) instead of skip-to-tomorrow (@AC-9); per-user failures
  stay swallowed → the completed pass advances to the next wall-clock hour.
- Step 7: `tests/test_opportunity_refresh.py` (@AC-7/8/9) — net-new coverage (the loop had none).

Verified: ruff check/format clean, pytest 621 passed, coverage 84.52% (>=40%). No uv.lock change
(no new deps). Migration 020 verified offline (up/down inverse pairs).

## Session 2026-08-26 (CI: feature status automation)

- Promotion PR #1027 merged to main
- Feature promoted and committed: 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-26
