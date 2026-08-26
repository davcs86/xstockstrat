# Implementation Spec: durable-loop-scheduler

**Status**: `pending`
**Created**: 2026-08-26
**Feature**: `docs/roadmap/features/157-durable-loop-scheduler/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/durable-loop-scheduler`

---

## Execution Summary

This feature generalizes feature 156's inline durable schedule into a shared, reusable
`DurableSchedule` helper in `xstockstrat-analysis`, backed by a `(job_name, user_id)`-keyed
`analysis.job_schedule` table, and migrates **two** analysis loops onto it: `fundsignal_loop`
(interval mode, a behavior-preserving refactor guarded by 156's promoted `@AC-1..7`) and
`run_opportunity_refresh_forever` (wall-clock mode, with a deliberate enumeration-failure-recovery
improvement). `live_loop` is **descoped** (operator decision, 2026-08-26; see product-spec Out of
Scope and `context.md`).

Order: (1) migration `020` reshapes the table first; (2) the shared helper is written and unit-tested
against it; (3–4) `fundsignal_loop` is migrated and its promoted suite kept green; (5) the two new
config keys + declared defaults land before (6–7) the opportunity refresh is rewritten to read them
and tested. Config-before-consumer so the declared defaults (C-05) exist when the loop reads them.

**Consumer surface (C-14):** the product spec marks this **None — internal/platform-only** (scheduling
reliability of existing background loops; the loops' outputs already reach users via ingest and
`/insights/opportunities`, unchanged). This was an explicit decision, not an omission — no UI/agent step
is required.

### Scenario Coverage (C-15)

Every `@AC-*` in `acceptance.feature` maps to a `test` step (`@AC-6` is retired — FR-4 descoped — and
is not a live scenario):

| Scenario | FR | Covered by |
|---|---|---|
| `@AC-1` | FR-1 | Step 3 (durable_schedule test — interval sleep-until-due, no poll, advance-after-run) |
| `@AC-2` | FR-1 | Step 3 (advance interval on success; retry cadence on caught error) |
| `@AC-3` | FR-2 | Step 3 (global row → empty `user_id`; per-user → distinct `(job,user)` rows) |
| `@AC-4` | FR-3 | Step 4 (fundsignal fires within jitter window on fresh boot) |
| `@AC-5` | FR-3 | Step 4 (redeploy no-reset + crash re-run + manual-no-contaminate) |
| `@AC-7` | FR-5 | Step 4 (fundsignal jitter/retry config-driven) **and** Step 7 (opportunity retry config-driven) |
| `@AC-8` | FR-6 | Step 7 (opportunity re-anchors wall-clock across redeploy + first-boot) |
| `@AC-9` | FR-6 | Step 7 (enumeration failure → retry-soon; per-user failure → completed pass advances to next hour) |

## Step Dependencies

- Step 2 (helper) requires Step 1 (migration): the helper's SQL targets `analysis.job_schedule`
  with the `(job_name, user_id)` PK that `020` creates.
- Step 3 (helper test) covers Step 2 (helper) — pairs `@AC-1/2/3`.
- Step 4 (fundsignal migration) requires Step 2: it delegates its three SQL seams to `DurableSchedule`.
  Step 4 is a **single service+test step** — the paired regression suite is `test_fundsignal_loop.py`
  which already exists and must stay green (behavior-preserving refactor).
- Step 5 (config keys) declares the defaults for `analysis.opportunity.startup_jitter_seconds` /
  `.retry_seconds` that Step 6 reads; must precede Step 6.
- Step 6 (opportunity rewrite) requires Step 2 (helper, wall-clock mode) and Step 5 (config keys).
- Step 7 (opportunity test) covers Step 6 — pairs `@AC-8/9` and `@AC-7` (opportunity half).
- Step 8 (durable_schedule module doc line in CLAUDE.md) is a docs touch that may fold into Step 5.

---

### Step 1 — migration: generalized `(job_name, user_id)` schedule table (`020_job_schedule`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/020_job_schedule.up.sql` — create
- `services/xstockstrat-analysis/migrations/020_job_schedule.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps/conflicts), up+down pair present, index/PK
correctness, run-order compliance; xstockstrat-analysis — Backtest reproducibility / scoring
determinism / no look-ahead bias (service owner of the migration).

**Codebase Evidence**:
- Last migration confirmed: `ls services/xstockstrat-analysis/migrations/` → `019_fundsignal_schedule.{up,down}.sql`
  is the highest → **next free NNN = 020** (F-01: `019` is applied and must never be edited; `020` renames the
  table `019` created, which is allowed).
- `019_fundsignal_schedule.up.sql:9-14` — `CREATE TABLE IF NOT EXISTS analysis.fundsignal_schedule (job_name text PRIMARY KEY, blocked_until_ms bigint NOT NULL, process_name text, updated_at timestamptz NOT NULL DEFAULT now())`. The inline `text PRIMARY KEY` on table `fundsignal_schedule` → Postgres auto-names the constraint **`fundsignal_schedule_pkey`** (standard `<table>_pkey` derivation).
- `019_fundsignal_schedule.down.sql:2` — `DROP TABLE IF EXISTS analysis.fundsignal_schedule;`

**TDD**: `N/A (migration — offline SQL, no DB brought up)`

**Covers**: `—`

**Instructions**:
Author `020_job_schedule.up.sql` as the design's **additive `ALTER`** (Database Changes / design.md
§ Migration `020`):
```sql
-- 020_job_schedule.up.sql
-- Service: xstockstrat-analysis
-- Feature 157 (durable-loop-scheduler): generalize feature 156's analysis.fundsignal_schedule into a
-- (job_name, user_id)-keyed table backing the shared DurableSchedule helper. user_id = '' (never NULL)
-- for a global job (one row per job); set for a per-user job. Additive ALTER preserves the single
-- persisted 'fundsignal' row with no data copy and leaves no orphaned table (F-01: 019 is untouched;
-- 020 renames the table 019 created).
ALTER TABLE analysis.fundsignal_schedule RENAME TO job_schedule;
ALTER TABLE analysis.job_schedule ADD COLUMN user_id text NOT NULL DEFAULT '';
ALTER TABLE analysis.job_schedule DROP CONSTRAINT fundsignal_schedule_pkey;
ALTER TABLE analysis.job_schedule ADD CONSTRAINT job_schedule_pkey PRIMARY KEY (job_name, user_id);
```
Author `020_job_schedule.down.sql` reversing it, and **record the single-global-row invariant as a
comment** (design Open Risk / `context.md` Open Thread):
```sql
-- 020_job_schedule.down.sql
-- Reversible ONLY under the v1 single-global-row invariant: at v1 the sole row is ('fundsignal', ''),
-- so collapsing the PK back to (job_name) cannot collide. A future per-user feature that writes
-- ('job','<user>') rows makes this down-migration lossy/unsafe — do not blindly trust it then.
ALTER TABLE analysis.job_schedule DROP CONSTRAINT job_schedule_pkey;
ALTER TABLE analysis.job_schedule DROP COLUMN user_id;
ALTER TABLE analysis.job_schedule ADD CONSTRAINT fundsignal_schedule_pkey PRIMARY KEY (job_name);
ALTER TABLE analysis.job_schedule RENAME TO fundsignal_schedule;
```
- `user_id text NOT NULL DEFAULT ''` backfills the one existing row to `('fundsignal','')` and keeps
  `ON CONFLICT (job_name, user_id) DO NOTHING` a valid idempotent target (a NULL would be distinct in a
  PK and break the conflict target — do **not** use nullable `user_id`).
- **Open Risk (design):** the `DROP CONSTRAINT fundsignal_schedule_pkey` name assumes `019`'s
  auto-generated PK name. If a DB inspection (`\d analysis.fundsignal_schedule`) at apply time shows a
  different name, use the actual name; the derivation `<table>_pkey` → `fundsignal_schedule_pkey` is the
  Postgres default for `019`'s inline `text PRIMARY KEY` and is the expected value.

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/020_job_schedule.up.sql services/xstockstrat-analysis/migrations/020_job_schedule.down.sql
# then read both: confirm every RENAME/ADD/DROP CONSTRAINT in .up has an inverse in .down
# (rename→rename back, add column→drop column, add composite PK→drop it + restore bare PK).
```
Offline only — never bring up a database (apply/rollback runs in CI/deploy against the managed DB).

---

### Step 2 — service: shared `DurableSchedule` helper + relocated wall-clock math

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/durable_schedule.py` — create

**Reviewers**: xstockstrat-analysis — Backtest reproducibility, strategy scoring determinism, no
look-ahead bias.

**Codebase Evidence**:
- Seams to extract (feature 156), `app/engine/fundsignal_loop.py`: `_SCHEDULE_JOB="fundsignal"` `:107`;
  `_now_ms` `:109-110`; `_process_name` (`os.environ.get("HOSTNAME") or socket.gethostname()`)
  `:112-113`; `_seed_schedule` (`INSERT INTO analysis.fundsignal_schedule (job_name, blocked_until_ms)
  VALUES ($1, 0) ON CONFLICT DO NOTHING`) `:115-122`; `_next_sleep_seconds` (`SELECT blocked_until_ms
  ... WHERE job_name=$1`, returns remaining ms/1000 or `0.0`) `:124-135`; `_advance_schedule` (`UPDATE
  ... SET blocked_until_ms=$1, process_name=$2, updated_at=now() WHERE job_name=$3`) `:137-147`.
- Wall-clock math to relocate: `app/handlers/servicer.py:3841-3850` `_seconds_until_hour_utc(hour)`
  (`hour % 24`; `target = now.replace(hour=hour, minute=0, second=0, microsecond=0)`;
  `if target <= now: target += timedelta(days=1)`; `return (target - now).total_seconds()`).
  **Single caller confirmed** via `grep -rn "seconds_until_hour_utc" app/ tests/` → only the def
  (`servicer.py:3841`) and one call (`servicer.py:3477`); safe to relocate (that call is removed in
  Step 6, so no shim is needed).
- Repository/pool pattern to mirror: `app/repositories/strategy_cooldowns.py:21-26`
  (`class StrategyCooldownsRepository: def __init__(self, db_pool): self._db = db_pool`; upsert-on-PK).
  Reuses the shared `asyncpg` pool created in `app/main.py:55` — **no new pool** (F-06).
- `## Not found` — there is no pre-existing shared scheduler module; `durable_schedule.py` is net-new.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
Create `app/engine/durable_schedule.py` holding two things (design.md § Chosen Approach — Shared unit):
1. A **module-level `seconds_until_hour_utc(hour)`** relocated **verbatim** from `servicer.py:3841-3850`
   (add `from datetime import UTC, datetime, timedelta` to the new module). Public name (drop the
   leading underscore) so the loop can import it for its `advance(seconds)` wall-clock argument.
2. A **thin** `class DurableSchedule` constructed as
   `DurableSchedule(db_pool, job_name, mode, *, user_id="", anchor_hour=None)` where
   `mode in {"interval", "wallclock"}` and `anchor_hour` is a **zero-arg callable** (wall-clock only) so
   the config read stays **in the loop**, not the helper. It holds `self._db = db_pool` directly (mirror
   `strategy_cooldowns.py:21-26`; no new pool) and owns exactly these seams against
   `analysis.job_schedule`:
   - `_now_ms()` / `_process_name()` — copied from `fundsignal_loop.py:109-113`.
   - `seed()` — the **sole** mode branch: interval →
     `INSERT INTO analysis.job_schedule (job_name, user_id, blocked_until_ms) VALUES ($1, $2, 0) ON
     CONFLICT (job_name, user_id) DO NOTHING`; wall-clock → same INSERT but
     `blocked_until_ms = self._now_ms() + int(seconds_until_hour_utc(self._anchor_hour()) * 1000)`.
     `ON CONFLICT DO NOTHING` preserves a persisted future due (redeploy/crash no-op) — do not upsert.
   - `next_sleep_seconds()` — byte-identical logic to `fundsignal_loop.py:124-135` but keyed on the
     composite: `SELECT blocked_until_ms FROM analysis.job_schedule WHERE job_name=$1 AND user_id=$2`;
     remaining ms/1000 or `0.0` if due.
   - `advance(seconds)` — **mode-uniform** (design: `advance` does NOT branch on mode):
     `UPDATE analysis.job_schedule SET blocked_until_ms=$1, process_name=$2, updated_at=now() WHERE
     job_name=$3 AND user_id=$4` with `blocked_until_ms = self._now_ms() + int(seconds * 1000)`. The
     **caller** supplies `seconds` (interval success → `interval_hours*3600`; wall-clock success →
     `seconds_until_hour_utc(hour)`; either mode's caught error → `retry_seconds`).
- Keep the class **thin** — it owns only timing/persistence. The `run_scheduled` god-driver was
  **rejected** (design § Rejected Alternatives); do not add loop control flow, config reads, disabled
  gates, or overlap locks here — those stay in each loop's `_tick`/`run_forever`.
- Write-**after**-completion is preserved and **no** lease/CAS/`process_name`-fencing is added
  (`instance_count:1` trap, ledger 2026-08-25/156; design Constitution note F-06/known-trap).
- Run the lint gate (see Verification) — this is a new source file.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Behavioral verification is the paired Step 3 test (`red-green required`: Step 3's assertions fail
against the tree before this file exists, pass after).

---

### Step 3 — test: `DurableSchedule` helper unit tests (interval + wall-clock + composite key)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_durable_schedule.py` — create

**Reviewers**: xstockstrat-analysis — Backtest reproducibility, strategy scoring determinism, no
look-ahead bias.

**Codebase Evidence**:
- Mocking pattern to reuse: `tests/test_fundsignal_loop.py:379-388` — `_sched_loop` wires
  `loop._db.fetchval = AsyncMock(return_value=blocked_until_ms)` and records SQL via
  `[c.args[0] for c in loop._db.execute.await_args_list if c.args]`. Mirror this for a bare
  `DurableSchedule(db_pool=AsyncMock(), ...)`: stub `db.fetchval`/`db.execute` and assert the SQL text +
  bound args. No real DB (matches the whole `tests/` suite — all `AsyncMock` DB, per `conftest.py`).
- C-13 (non-frontend test data): these tests use only scalar `blocked_until_ms`/`job_name`/`user_id`
  literals — no shared **domain** object, so inline is compliant (no `conftest.py` centralization
  needed; the analysis `tests/conftest.py` exists but these are one-consumer scalars).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
Write `pytest`/`pytest.mark.asyncio` tests over `DurableSchedule` directly (RED before Step 2's file
exists / behavior is added):
- **`@AC-1`** (interval, sleep-until-due, no poll, advance-only-after-run): construct interval-mode
  `DurableSchedule`, `fetchval` returns a `blocked_until_ms` ~6h in the future; assert
  `next_sleep_seconds()` ≈ `21600` (±60s) and that it issues **no** `UPDATE`/`INSERT` write while merely
  reading the due time (no "poll" write). Assert the helper does not itself call any job body — the
  helper has no run seam (the loop owns running), so verify it only reads.
- **`@AC-2`** (advance semantics): with the row due, `advance(24*3600)` on success writes
  `blocked_until_ms ≈ now + 24h`; `advance(retry_seconds)` on a caught-error path writes
  `≈ now + retry_seconds` and **strictly less** than `now + one interval` (mirror
  `test_fundsignal_loop.py:439-461`'s tolerance style: capture the bound arg from
  `execute.await_args_list`).
- **`@AC-3`** (composite key): a **global** job (`user_id=""`) `seed()` binds `user_id=''` in the INSERT
  args (assert the bound `$2` is `""`, never NULL); a **per-user** job (`user_id="u-1"`) `seed()` binds
  `"u-1"`, so two `DurableSchedule("demo", user_id=a/b)` instances write **distinct** `(job_name, user_id)`
  rows — assert both INSERTs carry the correct `user_id` and the same `job_name`.
- Add a wall-clock `seed()`/`advance()` case: with `anchor_hour=lambda: 8`, `seed()` binds
  `blocked_until_ms = now + seconds_until_hour_utc(8)*1000` (assert it is in the future and consistent
  with the relocated helper), exercising `seconds_until_hour_utc`.

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_durable_schedule.py -q \
  && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm the new tests pass and total coverage stays ≥ 40%. (Lint runs here for the Step 2 source file.)

---

### Step 4 — service + test: migrate `fundsignal_loop` onto `DurableSchedule` (interval), suite stays green

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis — Backtest reproducibility, strategy scoring determinism, no
look-ahead bias.

**Codebase Evidence**:
- Delegation targets in `fundsignal_loop.py`: `__init__` `:62-95` (build the helper here);
  `_seed_schedule` `:115-122`, `_next_sleep_seconds` `:124-135`, `_advance_schedule` `:137-147` (become
  one-line delegations); `_tick` `:149-177` (keeps its `analysis.fundsignal.enabled` gate `:157`,
  overlap `self._lock` `:160,166`, `run_interval_hours`/`retry_seconds` reads `:158,164,169,175`
  **unchanged**); `run_forever` `:179-186` (keeps seed → one-shot jitter
  `random.uniform(0, max(0, jitter))` `:183-184` → `while True: sleep(await self._tick())`); `run_once`
  `:190` never touches the schedule row (the manual `RunFundamentalsScan` path — @AC-6-of-156).
- Existing regression suite: `tests/test_fundsignal_loop.py` `class TestScheduler` `:391-519` — the
  promoted feature-156 `@AC-1..7` guard, plus `_sched_loop`/`_executed_sql` helpers `:379-388`.
  Promoted durable copy: `services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`
  (C-16 regression guard).

**TDD**: `red-green required` — but note this step is a **behavior-preserving refactor**: the RED/GREEN
guarantee here is **green-stays-green**. `TestScheduler` (`:391-519`) passes today and must pass
unchanged after the delegation. No new failing assertion is expected for the refactor itself; the
new-behavior RED lives in Steps 3/7. See design § Loop composition ("keeps all seven `@AC-*` local").

**Covers**: `AC-4, AC-5, AC-7`

**Instructions**:
- In `FundamentalsSignalLoop.__init__`, construct
  `self._schedule = DurableSchedule(self._db, "fundsignal", "interval")` (import from
  `app.engine.durable_schedule`). Keep `_SCHEDULE_JOB` only if still referenced; otherwise drop it with
  its now-delegated methods.
- Replace the bodies of `_seed_schedule`/`_next_sleep_seconds`/`_advance_schedule` with one-line
  delegations to `self._schedule.seed()` / `self._schedule.next_sleep_seconds()` /
  `self._schedule.advance(seconds)` — **or** call the helper directly from `_tick`/`run_forever` and
  delete the three private wrappers. Either is acceptable; keep the change surgical.
- **Do not change** `_tick`'s disabled-gate, overlap `self._lock`, the `max(1, interval_hours)*3600`
  success advance `:169-172`, or the `max(1, retry_seconds)` caught-error advance `:174-176`
  (these encode `@AC-4/@AC-5/@AC-7`). `run_once` must still never read/write the schedule (@AC-6-of-156).
- Update `tests/test_fundsignal_loop.py` **only** where the SQL text moved from
  `analysis.fundsignal_schedule` to `analysis.job_schedule` and/or the schedule read moved from
  `loop._db.fetchval` to the helper's fetch (adjust `_sched_loop`/`_executed_sql` and the
  `TestScheduler` assertions that grep for `"analysis.fundsignal_schedule"` at
  `:404-408,455,474,483` to the new table name / helper seam). The **assertions' behavioral intent
  must not change** — same due-time math, same advance-after-completion, same disabled-no-advance,
  same bounded jitter, same manual-no-contaminate. This is a mechanical retarget, not a rewrite.
- No new outbound gRPC call is added (header-propagation gate N/A — the refactor touches only the DB
  seam). Run the lint gate (Verification).

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_fundsignal_loop.py -q \
  && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm `TestScheduler` (`@AC-1..7`) is **all green** after the delegation and total coverage ≥ 40%.

---

### Step 5 — config: two new opportunity-loop tunables + declared defaults

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (declare defaults, C-05)

**Reviewers**: xstockstrat-analysis — service owner of the service adding the config key.

**Codebase Evidence**:
- Config-read getter: `app/config/watcher.py:103-114` `get_int_present(key, default)` (returns stored
  `int_val` whenever `HasField("int_val")`, **including a legitimate 0**, else default) — the correct
  getter for these keys (F-07; mirrors the existing `analysis.fundsignal.startup_jitter_seconds` /
  `.retry_seconds` which are read presence-aware per `CLAUDE.md` § Config Keys Consumed).
- Existing precedent keys (unchanged): `analysis.fundsignal.startup_jitter_seconds` (30) /
  `.retry_seconds` (300), and the reused wall-clock anchor `analysis.opportunity.refresh_hour_utc` (0,
  read via `get_int_present` at `servicer.py:3476`) — all present in
  `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed.
- **No existing config key changes value_type** — these are net-new keys (fails.md 2026-08 rule: never
  widen an existing key's `value_type` in place; not applicable here).

**TDD**: `N/A (config — declared defaults in CLAUDE.md; behavior is exercised by Step 7's test)`

**Covers**: `—`

**Instructions**:
Add two rows to the `## Config Keys Consumed` table in `services/xstockstrat-analysis/CLAUDE.md`
(namespace `analysis`), mirroring the fundsignal jitter/retry wording (C-05 — defaults declared in the
service CLAUDE.md; the config service itself needs no schema change, keys are runtime `SetConfig` values):
- `analysis.opportunity.startup_jitter_seconds` | int | `30` | One-shot random delay `[0, N]` seconds
  applied once at the opportunity refresh loop entry to stagger concurrent redeploys (feature 157);
  read presence-aware (`get_int_present`) — `0` disables jitter.
- `analysis.opportunity.retry_seconds` | int | `300` | On a caught enumeration error the wall-clock
  `blocked_until_ms` advances by this many seconds (retry soon), not to the next wall-clock hour
  (feature 157); read presence-aware, clamped `max(1, …)` at the read site.
- Do **not** add a new anchor key — the wall-clock anchor reuses the existing
  `analysis.opportunity.refresh_hour_utc`. `fundsignal`'s three existing keys are unchanged; no key is
  removed.

**Verification**:
```bash
grep -n "analysis.opportunity.startup_jitter_seconds\|analysis.opportunity.retry_seconds" services/xstockstrat-analysis/CLAUDE.md
```
Confirm both keys appear with defaults `30` / `300` and are documented as `get_int_present` reads.

---

### Step 6 — service: rewrite `run_opportunity_refresh_forever` onto `DurableSchedule` (wall-clock)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis — Backtest reproducibility, strategy scoring determinism, no
look-ahead bias.

**Codebase Evidence**:
- Current loop: `servicer.py:3466-3493` `run_opportunity_refresh_forever` — startup guard
  `if self._opportunities_repo is None: return` `:3473-3474` (its **only** bail-out; no `enabled`
  gate); reads `get_int_present("analysis.opportunity.refresh_hour_utc", 0)` `:3476`;
  `await asyncio.sleep(_seconds_until_hour_utc(hour))` `:3477`; enumeration
  `user_ids = await self._opportunities_repo.distinct_user_ids()` inside `try/except → continue`
  `:3478-3482`; per-user body with its own `try/except → log.warning` (one bad user never kills the
  pass) `:3487-3492`; `_opportunity_lock(uid)` `:2995-3000`, `_compute_opportunities` +
  `replace_for_user` `:3489-3490`.
- Relocated wall-clock math: after Step 2, import `seconds_until_hour_utc` (and `DurableSchedule`) from
  `app.engine.durable_schedule`; **delete** the now-orphaned `_seconds_until_hour_utc` def at
  `servicer.py:3841-3850` (single-caller confirmed — the only call at `:3477` is removed by this
  rewrite; `grep -rn "seconds_until_hour_utc"` after the edit must show zero references in `servicer.py`).
  `datetime`/`UTC`/`timedelta` imports in `servicer.py` stay (used elsewhere).
- New config keys read here: `analysis.opportunity.startup_jitter_seconds` /
  `analysis.opportunity.retry_seconds` via `self._cfg.get_int_present(...)` (Step 5).
- **No stored pool attribute exists on the servicer.** `AnalysisServicer.__init__(... db_pool=None ...)`
  (`servicer.py:325-332`) passes `db_pool` only into its repos (`:358-402`, e.g.
  `self._opportunities_repo = OpportunitiesRepository(db_pool) if db_pool else None`) and never keeps
  `self._db_pool` / `self._db`. `DurableSchedule` needs the raw pool, so this step must first store it
  (see Instructions) — do not reference a `self._db_pool` that does not yet exist.

**TDD**: `red-green required` (new behavior: persisted-due re-anchor across redeploy; retry-soon on
enumeration failure — Step 7's assertions fail against the current in-process-sleep implementation).

**Covers**: `AC-7, AC-8, AC-9`

**Instructions**:
- **Store the pool first.** In `AnalysisServicer.__init__` (`servicer.py:325-402`, alongside the repo
  construction) add `self._db_pool = db_pool` — the servicer currently keeps `db_pool` only inside its
  repos, and `DurableSchedule` needs the raw pool. (This is the same F-06 shared pool; no new pool.)

Rewrite `run_opportunity_refresh_forever` as a `_tick`/`run_forever` pair composing
`DurableSchedule(self._db_pool, "opportunity", "wallclock", anchor_hour=lambda:
self._cfg.get_int_present("analysis.opportunity.refresh_hour_utc", 0))` (design.md § Loop composition):
- **Preserve** the `if self._opportunities_repo is None: return` early return as the loop's only
  bail-out (no `enabled` gate) — carry it into the new `run_forever` (design Open Risk).
- `run_forever`: `await schedule.seed()` → **one-shot bounded startup jitter**
  `await asyncio.sleep(random.uniform(0, max(0, self._cfg.get_int_present("analysis.opportunity.startup_jitter_seconds", 30))))`
  (mirror `fundsignal_loop.py:182-184`; add `import random` if absent) → `while True:
  await asyncio.sleep(await self._tick())`.
- `_tick`: `sleep_s = await schedule.next_sleep_seconds(); if sleep_s > 0: return sleep_s`. When due,
  run one pass:
  - **Enumeration failure raises → retry soon** (@AC-9, the deliberate change from today's
    skip-to-tomorrow `continue`): wrap `distinct_user_ids()`; on exception
    `await schedule.advance(max(1, self._cfg.get_int_present("analysis.opportunity.retry_seconds", 300)))`
    and `return 0.0`. The `max(1, …)` clamp is **required** (design Open Risk — mirror
    `fundsignal_loop.py:175`; prevents a `retry_seconds=0` busy-spin).
  - **Per-user failures stay swallowed** (unchanged `try/except → log.warning continue` around
    `_opportunity_lock`/`_compute_opportunities`/`replace_for_user`, `:3487-3492`) so a completed pass
    (even with some users failing) counts as complete and advances to the next wall-clock hour:
    `await schedule.advance(seconds_until_hour_utc(self._cfg.get_int_present("analysis.opportunity.refresh_hour_utc", 0)))`
    then `return 0.0`.
  - Keep the `await asyncio.sleep(0)` cooperative pacing point inside the per-user loop (`:3493`).
- Do **not** add lease/CAS/`process_name` fencing (instance_count:1 trap). No new outbound gRPC call is
  introduced (the loop keeps its existing portfolio/ingest reads via `_compute_opportunities`; header
  propagation already synthesized from `x-user-id` at `:3486`, unchanged) → header-propagation gate N/A.
- Run the lint gate (Verification).

**Verification**:
```bash
grep -n "seconds_until_hour_utc" services/xstockstrat-analysis/app/handlers/servicer.py   # expect: zero matches after edit
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Behavioral verification is the paired Step 7 test.

---

### Step 7 — test: opportunity refresh wall-clock re-anchor + enumeration-failure retry semantics

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (add opportunity-refresh
  scheduler cases)

**Reviewers**: xstockstrat-analysis — Backtest reproducibility, strategy scoring determinism, no
look-ahead bias.

**Codebase Evidence**:
- `tests/test_analysis_servicer.py` is the servicer test home and already stubs `distinct_user_ids` on
  its fake opportunities repo (`test_analysis_servicer.py:3915`), but has **no** existing test of
  `run_opportunity_refresh_forever` itself (grep: zero matches for the loop name) — these scheduler
  cases are net-new coverage added here. (Alternatively a focused `tests/test_opportunity_refresh.py`
  is acceptable; keep it in this service's `tests/`.)
- Scheduler-assertion style to mirror: `tests/test_fundsignal_loop.py:439-461` (capture the `advance`
  bound arg from `execute.await_args_list`, assert `now + retry*1000` and `< now + interval`) and
  `:410-424` (persisted future due → sleep only the remainder, no run).
- Helper seam under test: `DurableSchedule.next_sleep_seconds()`/`advance()` on `analysis.job_schedule`
  (Step 2), plus `seconds_until_hour_utc` (relocated, Step 2). No promoted `@AC-*` exists yet for the
  opportunity refresh — these become its first acceptance coverage (recon.md § Existing Business Rules).

**TDD**: `red-green required`

**Covers**: `AC-7, AC-8, AC-9`

**Instructions**:
Add `pytest.mark.asyncio` cases (RED against the current in-process-sleep loop, GREEN after Step 6),
stubbing `db.fetchval`/`db.execute` on the servicer's pool as `AsyncMock` (no real DB):
- **`@AC-8`** (wall-clock re-anchor across redeploy): with `refresh_hour_utc=8` and a persisted
  `blocked_until_ms` = 08:00 UTC **tomorrow**, `_tick()`/`next_sleep_seconds()` returns a sleep landing
  at ≈ that persisted time (**not** `now + 24h` from the restart moment) and does **not** run the pass.
  Add the first-ever-boot case: with no prior row and `now` before 08:00 UTC, `seed()` sets due to
  08:00 UTC **today** (assert via `seconds_until_hour_utc(8)` consistency).
- **`@AC-9`** (enumeration failure → retry-soon vs per-user swallow): stub
  `distinct_user_ids` to raise with `retry_seconds=300`; assert the `advance` UPDATE binds
  `blocked_until_ms ≈ now + 300_000` (±tolerance) and **strictly less** than `now + seconds to next
  wall-clock hour`. Then the completed-pass case: `distinct_user_ids` returns users but a per-user
  `_compute_opportunities`/`replace_for_user` raises for one → the pass still completes and `advance`
  binds `≈ now + seconds_until_hour_utc(hour)` (next wall-clock hour), treating the swallowed per-user
  error as a completed pass.
- **`@AC-7`** (opportunity half — config-driven): assert the caught-enumeration advance uses the
  configured `retry_seconds` (300) from `get_int_present`, and that the startup jitter draw is bounded
  `[0, startup_jitter_seconds]` (mirror `test_fundsignal_loop.py:487-519`'s `random.uniform`
  monkeypatch, asserting the `(0, N)` bounds and the `N=0 → 0` teeth).

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -q -k "opportunity or refresh or schedule" \
  && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm the new `@AC-7/8/9` cases pass and total coverage ≥ 40%.

---

### Step 8 — docs: register the `DurableSchedule` module in the analysis CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (one line noting the shared scheduler)

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md` currently documents the three background loops
  (live loop, `app/engine/fundsignal_loop.py`, `pnl_pattern_consumer`) and the opportunity refresh
  (`run_opportunity_refresh_forever`, `analysis.opportunity.refresh_hour_utc`) but has **no** reference
  to a shared scheduler module (grep of the file confirms `durable_schedule` is absent pre-feature).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
Add a short note (folded into the fundamentals-producer / opportunity sections, or a one-line pointer)
that the durable, crash-safe schedule (seed-at-boot, compute-sleep-until-due, advance-after-completion,
bounded jitter, retry cadence) now lives in the shared `app/engine/durable_schedule.py`
(`DurableSchedule`, interval + wall-clock modes) backed by the `analysis.job_schedule` table
(`(job_name, user_id)` PK, migration `020`), consumed by `fundsignal_loop` (interval) and
`run_opportunity_refresh_forever` (wall-clock). Note `live_loop` is **not** migrated (feature 157 Out of
Scope). This is a `## Teardown`-scoped context touch — keep it factual and brief. May fold into Step 5's
CLAUDE.md edit (same file) to avoid a second PR.

**Verification**:
```bash
grep -n "durable_schedule\|job_schedule\|DurableSchedule" services/xstockstrat-analysis/CLAUDE.md
```
Confirm the shared module + table are documented.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
