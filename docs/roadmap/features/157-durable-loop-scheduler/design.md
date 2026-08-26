# Design: durable-loop-scheduler

**Created**: 2026-08-26
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-08-26
**Grounded in**: recon.md

---

## Chosen Approach

Add one shared unit `services/xstockstrat-analysis/app/engine/durable_schedule.py` and migrate **two**
recurring loops onto it (`fundsignal_loop` interval; `run_opportunity_refresh_forever` wall-clock).
`live_loop` is descoped (operator decision — see Rejected Alternatives / product-spec Out of Scope).
Internal/platform-only: no consumer surface changes (C-14) — the loops' outputs already reach users via
ingest and `/insights/opportunities`, unchanged.

**Shared unit.** `durable_schedule.py` holds (a) a module-level `seconds_until_hour_utc(hour)` relocated
verbatim from `servicer.py:3841-3850` (recon `recon.md`: FR-6 wall-clock math; single caller at
`servicer.py:3477`, grep-confirm before deleting or leave a re-export shim), and (b) a **thin**
`DurableSchedule(db_pool, job_name, mode, *, user_id="", anchor_hour=None)` class owning only the four
timing/persistence seams extracted from feature 156's `fundsignal_loop.py:107-186`: `_now_ms`,
`_process_name`, `seed()`, `next_sleep_seconds()`, `advance(seconds)`. The class holds the shared
`asyncpg` pool directly (mirrors `strategy_cooldowns.py:21-26`; no new pool, F-06) and targets the
generalized `analysis.job_schedule` table.

- `mode ∈ {"interval","wallclock"}`; `anchor_hour` is a zero-arg callable (wall-clock only) so the
  config read stays **in the loop**, not the shared unit (the loop passes
  `lambda: cfg.get_int_present("analysis.opportunity.refresh_hour_utc", 0)`).
- `seed()` is the **sole** mode branch: interval → `INSERT (job_name,user_id,blocked_until_ms=0) ON
  CONFLICT (job_name,user_id) DO NOTHING` (immediately due → prompt first run); wall-clock → same INSERT
  with `blocked_until_ms = now_ms + seconds_until_hour_utc(anchor_hour())*1000`. `ON CONFLICT DO
  NOTHING` preserves a persisted due, so a crash-in-the-fire-window row is still due and re-runs.
- `next_sleep_seconds()` is byte-identical to 156 (`SELECT blocked_until_ms WHERE job_name=$1 AND
  user_id=$2`; remaining ms or `0.0`).
- `advance(seconds)` is **mode-uniform**: `blocked_until_ms = now_ms + seconds*1000`, `process_name`,
  `updated_at = now()`. The caller supplies `seconds`: interval success → `interval_hours*3600`;
  wall-clock success → `seconds_until_hour_utc(hour)`; either mode's caught error → `retry_seconds`.

**Loop composition (each keeps its own `_tick`/`run_forever`).**
- `fundsignal_loop`: ctor builds `DurableSchedule(db_pool,"fundsignal","interval")`; the three
  `_seed_schedule`/`_next_sleep_seconds`/`_advance_schedule` bodies become one-line delegations; `_tick`
  (`fundsignal_loop.py:149-177`) keeps its `analysis.fundsignal.enabled` gate, overlap `self._lock`, and
  config reads **unchanged**; `run_forever` keeps seed → one-shot bounded jitter → `while`. This keeps
  all seven `@AC-*` behaviors local. The manual `RunFundamentalsScan`/`run_once` path never touches the
  row (@AC-6-of-156, manual-no-contaminate).
- `run_opportunity_refresh_forever`: rewritten as a `_tick`/`run_forever` pair composing
  `DurableSchedule(db_pool,"opportunity","wallclock", anchor_hour=…)`. Keeps the
  `if self._opportunities_repo is None: return` startup guard (`servicer.py:3473-3474`) — its only
  bail-out. Enumeration/`distinct_user_ids()` failure raises → `advance(max(1, retry_seconds))`; the
  existing per-user `try/except continue` (`servicer.py:3487-3492`) is untouched, so a completed pass
  (even with some users failing) → `advance(seconds_until_hour_utc(hour))`. The `advance` seconds at the
  error site are clamped `max(1, retry_seconds)` to mirror `fundsignal_loop.py:175` and prevent a
  `retry_seconds=0` busy-spin.

**Migration `020_job_schedule` (additive ALTER).**
```sql
-- up
ALTER TABLE analysis.fundsignal_schedule RENAME TO job_schedule;
ALTER TABLE analysis.job_schedule ADD COLUMN user_id text NOT NULL DEFAULT '';
ALTER TABLE analysis.job_schedule DROP CONSTRAINT fundsignal_schedule_pkey;  -- 019 inline PK auto-name; verify with \d, use IF EXISTS if custom
ALTER TABLE analysis.job_schedule ADD CONSTRAINT job_schedule_pkey PRIMARY KEY (job_name, user_id);
-- down (reversible under the v1 single-global-row invariant — comment this in the file)
ALTER TABLE analysis.job_schedule DROP CONSTRAINT job_schedule_pkey;
ALTER TABLE analysis.job_schedule DROP COLUMN user_id;
ALTER TABLE analysis.job_schedule ADD CONSTRAINT fundsignal_schedule_pkey PRIMARY KEY (job_name);
ALTER TABLE analysis.job_schedule RENAME TO fundsignal_schedule;
```
`user_id text NOT NULL DEFAULT ''` (empty string, never NULL) backfills the one existing row to
`('fundsignal','')` and keeps `ON CONFLICT (job_name,user_id) DO NOTHING` idempotent for global jobs
(a NULL would be distinct in a PK and break the conflict target).

**Config.** Two new keys `analysis.opportunity.startup_jitter_seconds` (30) and
`analysis.opportunity.retry_seconds` (300), read via `get_int_present` (`watcher.py:103-114`), with
declared defaults added to `services/xstockstrat-analysis/CLAUDE.md` (C-05). Reuses
`analysis.opportunity.refresh_hour_utc` and `fundsignal`'s three keys unchanged.

**Recommended step boundaries for `/sdd-spec`:** (1) migration `020` up/down (DBA + analysis-owner);
(2) `durable_schedule.py` (relocate `seconds_until_hour_utc` + `DurableSchedule` + unit tests);
(3) migrate `fundsignal_loop` — regression step, promoted 156 `@AC-1..7` stay green;
(4) rewrite `run_opportunity_refresh_forever` in wall-clock mode + delete the servicer copy of
`seconds_until_hour_utc` (or shim) + wire the error semantics (`@AC-8`, `@AC-9`); (5) new config keys +
CLAUDE.md defaults (may fold into step 4).

## Rejected Alternatives

- **Migrate `live_loop` too (original FR-4)** — rejected by operator: a ~60s loop
  (`analysis.engine.eval_interval_seconds`, recon FR-4) gains almost nothing from a durable row
  (protects ≤60s of cadence for ~1440 writes/day) and a blanket retry cadence would slow its recovery.
  Descoped from v1.
- **A `run_scheduled(...)` god-driver injecting 6+ callables** — rejected: the three loops' disabled/
  guard shapes differ structurally (fundsignal config-gate + full-interval-sleep; opportunity
  startup-None-guard; live_loop none), so one driver would be lossy and risk regressing `@AC-5`. The
  thin class + per-loop `_tick` removes the real duplication (the SQL + due-time math) without a wide
  control-flow surface.
- **Fresh generalized table + `INSERT…SELECT` copy** — rejected in favor of the in-place `ALTER RENAME`:
  the copy leaves an orphaned dead `fundsignal_schedule`; the rename preserves the row with no copy and
  no orphan (the only caller of the old name is migrated in this same feature). The rename's dependence
  on `019`'s auto-named PK is verified (inline `job_name text PRIMARY KEY` → `fundsignal_schedule_pkey`).
- **`advance()` itself branches on mode** — rejected: it would duplicate the `anchor_hour` getter into a
  second seam; the uniform `advance(seconds)` keeps the persistence unit clean.
- **Defer wall-clock mode / the opportunity refresh (FR-6)** — foreclosed by the operator's earlier
  "include wall-clock mode → both" sign-off; recorded as considered-and-signed-off, not re-litigated.

## Open Risks

- [ ] **Spec-time verification of the `019` PK constraint name** (`fundsignal_schedule_pkey`) — confirm
  with `\d` and use `IF EXISTS`/actual name in `020`. To be addressed at step 1.
- [ ] **`seconds_until_hour_utc` single-caller assumption** — grep-confirm at `/sdd-spec` before
  deleting it from `servicer.py`; else leave a re-export shim. To be addressed at step 4.
- [ ] **`max(1, retry_seconds)` clamp at the opportunity error site** — must be spelled out in the spec
  step (the shared `advance` faithfully persists whatever seconds it's given). To be addressed at step 4.
- [ ] **`020.down` reversibility holds only under the v1 single-global-row invariant** — carry the
  assumption as a comment in `.down.sql` so a future per-user feature doesn't blindly trust it. Step 1.
- [ ] **Preserve the `_opportunities_repo is None` early return** in the rewritten `run_forever`
  (the opportunity loop's only bail-out; no `enabled` gate). To be addressed at step 4.

## Constitution Rules Touched

- `C-05` — honored: two new keys `<service>.<category>.<key>`; declared defaults added to
  `services/xstockstrat-analysis/CLAUDE.md`.
- `C-07` — honored: `020_job_schedule.{up,down}.sql`, paired and reversible.
- `C-08` / `P-06` — honored: `durable_schedule.py` gets unit tests; the fundsignal-migration step re-runs
  the promoted 156 suite; `@AC-8`/`@AC-9` get RED assertions.
- `C-11` — honored: full SDD pipeline (story → review → design) run before any code; the `live_loop`
  descope is an operator-signed scope change recorded in `context.md`.
- `C-14` — honored: internal/platform-only; no consumer surface stranded by the descope (live_loop's
  output surfaces are untouched).
- `C-15` — honored: FR-4 retired and `@AC-6` retired (not renumbered); `@AC-9` appended; every remaining
  `FR-N` (1,2,3,5,6) covered by ≥1 scenario.
- `F-01` — honored: `020` is a new migration that renames the table `019` created; `019` is never edited.
- `F-06` — honored: `DurableSchedule` reuses the existing shared pool; no new pool.
- `F-07` — honored: jitter/retry read from config via `get_int_present`; no hardcoded cadence.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1..7` (feature 156, `services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`)
  — not regressed: `fundsignal_loop` keeps its own `_tick`/gate/lock/jitter; only the SQL seams are
  delegated to `DurableSchedule`, which keeps write-after-completion (@AC-3), disabled-no-advance/
  no-busy-spin (@AC-5), manual-no-contaminate (@AC-6-of-156), and bounded jitter (@AC-7). The
  fundsignal-migration step re-runs this suite unchanged.
- No promoted `@AC-*` exists for the opportunity refresh — its enumeration-failure recovery change
  (skip-to-tomorrow → retry-soon) is net-new behavior guarded by this feature's own new `@AC-9`, not a
  CHANGE to an existing durable rule.
