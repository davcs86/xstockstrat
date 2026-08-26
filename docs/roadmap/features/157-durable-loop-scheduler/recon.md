# Recon: durable-loop-scheduler

**Created**: 2026-08-26
**From**: product-spec.md
**Affected services**: xstockstrat-analysis

---

## Objective

Generalize feature 156's inline durable, crash-safe schedule (prompt-on-boot, redeploy-safe cadence,
crash-safe retry, bounded startup jitter, write-next-due-**after**-completion) — currently living only
inside `fundsignal_loop.py` — into a **shared reusable scheduler helper** backed by a generalized
`(job_name, user_id)`-keyed schedule table, then migrate three `xstockstrat-analysis` recurring loops
onto it (`fundsignal_loop` interval, `live_loop` interval, `run_opportunity_refresh_forever`
wall-clock) with no change to what any loop produces.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.12, asyncpg, gRPC)
  - Entry / loop spawn sites: `app/main.py` — shared `asyncpg` pool `main.py:55-63`; `live_loop.run_forever()` `create_task` `main.py:113-134`; `entry_backfill.run_once` `main.py:139-143`; `fundsignal_loop.run_forever()` `create_task` `main.py:149-161`; `pnl_pattern_consumer.run_forever()` `main.py:170-180`; `servicer.run_opportunity_refresh_forever()` `main.py:186`.
  - **156 durable scheduler (the seam to extract)** — `app/engine/fundsignal_loop.py`: ctor `(config_watcher, db_pool, stubs)` `:61,:74-75`; `_SCHEDULE_JOB="fundsignal"` `:107`; `_now_ms` `:109`; `_process_name` `:112`; `_seed_schedule` (`INSERT … (job_name, blocked_until_ms) VALUES ($1,0) ON CONFLICT DO NOTHING`) `:115-122`; `_next_sleep_seconds` (`SELECT blocked_until_ms WHERE job_name=$1`, `0.0` if due) `:124-135`; `_advance_schedule` (`UPDATE … SET blocked_until_ms=$1, process_name=$2, updated_at=now() WHERE job_name=$3`) `:137-147`; `_tick` (testable seam; reads enabled/interval/retry; overlap-guarded by `self._lock`) `:149-177`; `run_forever` (seed → one-shot jitter → `while True: await asyncio.sleep(await self._tick())`) `:179-186`; `run_once` never touches the schedule row `:99-105`.
  - **FR-4 interval loop** — `app/engine/live_loop.py`: `LiveEvaluationLoop.__init__(config_watcher, db_pool, stubs, evaluator)` `:182-226`; `run_forever` (**sleep-then-run**: `interval = get_int("analysis.engine.eval_interval_seconds", default=60)` `:252` → `await asyncio.sleep(interval)` `:253` → `_run_cycle`) `:249-261`; cycle body `_run_cycle` `:263`.
  - **FR-6 wall-clock loop** — `app/handlers/servicer.py`: `run_opportunity_refresh_forever` `:3466`; reads `get_int_present("analysis.opportunity.refresh_hour_utc", 0)` `:3476`; `await asyncio.sleep(_seconds_until_hour_utc(hour))` `:3477`; wall-clock math `_seconds_until_hour_utc` (`target=now.replace(hour=hour,…); if target<=now: target+=1 day; return (target-now).seconds`) `:3841-3850`.
  - Last migration: `019_fundsignal_schedule.up.sql` (`services/xstockstrat-analysis/migrations/`) → **next free NNN = 020**.
  - Config-read pattern: `app/config/watcher.py` `ConfigWatcher` — `get_int` (zero-trap `int_val or default`) `:95-101`; `get_int_present` (`HasField("int_val")`, 0 legitimate) `:103-114`; `get_bool` `:116`. WatchConfig subscription built in `main.py:42-50`.
  - Repository pattern to mirror: `app/repositories/strategy_cooldowns.py:21-26` — `class …Repository: __init__(self, db_pool): self._db = db_pool`, upsert-on-PK + `list_all()` hydrate-at-boot.

## Patterns to REUSE

- **The durable-schedule mechanism itself** → extract the seven seams from `fundsignal_loop.py:107-186` (`_now_ms`/`_seed_schedule`/`_next_sleep_seconds`/`_advance_schedule` + the `_tick`/jitter loop shape) into one shared helper; do **not** re-implement per loop (DRY, principle #2). `fundsignal_loop` then calls the helper instead of holding the logic inline.
- **Schedule-table repository** → mirror `app/repositories/strategy_cooldowns.py:21-26` (ctor takes the shared `db_pool`; upsert-on-PK; `list_all`/hydrate-at-boot). No new pool — reuse `main.py:55-63` (**F-06**).
- **Config reads** → `ConfigWatcher.get_int` / `get_int_present` (`watcher.py:95-114`); reuse the existing keys `analysis.fundsignal.{run_interval_hours,retry_seconds,startup_jitter_seconds}` and `analysis.opportunity.refresh_hour_utc`. New per-loop jitter/retry keys follow `analysis.<loop>.*` (**C-05/F-07**).
- **Migration shape** → `019_fundsignal_schedule.{up,down}.sql` is the template for the `020` generalized table (up + paired down, **C-07**).
- **Wall-clock hour math** → reuse `_seconds_until_hour_utc` (`servicer.py:3841-3850`) for the helper's wall-clock mode rather than re-deriving the "next occurrence of UTC hour" arithmetic.

## Existing Business Rules (preserve / extend)

_Constitution **C-16**. Feature 156's seven scenarios (promoted to
`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) are the
regression guard for FR-3 — the migration onto the shared helper is exactly the re-implementation risk
they exist to catch. The design-adversary must require the shared helper to satisfy all seven for
`fundsignal_loop` before accepting the generalization._

- **PRESERVE** `@AC-1` "Producer runs its first cycle promptly on a fresh deploy, not after a full interval" — seeded-due=0 / no-prior-row → run immediately; register the `fundamentals` source in the startup window.
- **PRESERVE** `@AC-2` "A redeploy within the interval does not reset the schedule" — read the existing row, sleep only remaining time; never re-arm a fresh full interval from restart.
- **PRESERVE** `@AC-3` "A hard crash mid-cycle re-runs promptly on restart" — next-due written **only after** completion; do not invert this ordering.
- **PRESERVE** `@AC-4` "A caught cycle error retries after `retry_seconds`, not a full interval" — the interval retry path advances by `analysis.fundsignal.retry_seconds`.
- **PRESERVE** `@AC-5` "A disabled producer neither runs nor advances the schedule, and does not busy-spin."
- **PRESERVE** `@AC-6` "A manual scan does not contaminate the scheduled cadence" — manual `RunFundamentalsScan` leaves `blocked_until_ms` unchanged; the shared helper keeps the manual path off the schedule write.
- **PRESERVE** `@AC-7` "Startup jitter is bounded" — one-shot delay in `[0, startup_jitter_seconds]`.
- **No promoted `@AC-*` exists for `live_loop` or `run_opportunity_refresh_forever`** — their cadence/boot behavior lived only in code/specs (features 048/097/131), never promoted. Migrating them regresses no *written* rule, but recon can hand the adversary no scenario-level guard for them; 157's own `@AC-5`/`@AC-8` become their first acceptance coverage. Not a CHANGE (defaulted to "no guarantee to preserve").

## Dependencies

- Proto/RPC: **none** (no proto change).
- Migration: next number **`020`** for `services/xstockstrat-analysis/migrations/`.
- Config keys: existing — `analysis.fundsignal.{run_interval_hours,retry_seconds,startup_jitter_seconds}`, `analysis.opportunity.refresh_hour_utc`, `analysis.engine.eval_interval_seconds`. New (design decides exact set) — per-loop `analysis.{engine,opportunity}.startup_jitter_seconds` / `.retry_seconds`, or a shared default.
- Inter-service edges: none new (loops already call their existing stubs).
- New env vars / ports: none.

## Risks / Not-found

- **No existing shared scheduler module** (`## Not found`) — the durable logic exists only inline in `fundsignal_loop.py`; the shared helper is net-new. No prior helper to reuse, only the 156 code to extract.
- **No existing `(job_name, user_id)` composite table** (`## Not found`) — current PK is `job_name` alone; the composite key is net-new. **F-01**: cannot edit applied `019`; `020` either creates a fresh generalized table + copies the one `fundsignal` row, or `ALTER`s `fundsignal_schedule` (add `user_id`, re-key). Design decides.
- **`live_loop` interval is 60s, not hours** (`eval_interval_seconds` default 60). A durable write-after-completion every ~60s is real DB churn on the PgBouncer-pooled analysis connection, and a redeploy only ever resets ≤60s of cadence — so durability's payoff for `live_loop` is marginal; **prompt-on-boot** (fix the sleep-then-run) + bounded jitter is the real win. The debate must decide whether `live_loop` gets the full durable row-per-cycle or only the prompt-on-boot/jitter half.
- **The wall-clock refresh is already largely redeploy-safe** — `_seconds_until_hour_utc` re-anchors to the UTC hour on every boot, so a redeploy does **not** reset its cadence (unlike the interval loops). Durability's only real add is closing the narrow **crash-in-the-fire-window → skipped-day** gap (a kill at 07:59, restart at 08:01, sees `target<=now` → schedules tomorrow, silently skipping today). The debate must weigh that narrow gain against adding a DB row + the wall-clock mode's complexity to the shared helper.
- **Known trap (ledger 2026-08-25 / feature 156):** do **not** rebuild multi-instance mutual-exclusion (lease / CAS / `process_name`-fencing) on the `instance_count:1` analysis service — the load-bearing requirement is the durable schedule; write the marker on completion, not on claim. The generalized helper must keep 156's write-after-completion shape.
- **AC-4 retry contract is `fundsignal`-specific** — if the shared helper generalizes retry to loops that had none (`live`/`opportunity`), that is a *new case alongside* AC-4, not a change to it. If the design deliberately alters `fundsignal`'s AC-4 retry contract during extraction, that flips to CHANGE and needs explicit sign-off in `context.md`.

## Recommended Scope

Advisory step boundaries (input to grilling + `/sdd-spec`, not binding):

1. **Migration `020`** — generalized `(job_name, user_id)` schedule table + migrate the one `fundsignal` row (design picks fresh-table-copy vs additive `ALTER`).
2. **Shared scheduler helper** — extract the seven seams from `fundsignal_loop.py` into a reusable unit supporting interval + wall-clock modes and an optional per-user key; keep write-after-completion.
3. **Migrate `fundsignal_loop`** onto the helper — prove FR-3 / `@AC-1..7` still hold (test-heavy step).
4. **Migrate `live_loop`** onto the helper (interval mode) — prompt-on-boot + jitter; design decides row-per-cycle vs prompt-on-boot-only.
5. **Migrate `run_opportunity_refresh_forever`** onto the helper (wall-clock mode) — reuse `_seconds_until_hour_utc`; close the skipped-day gap.
6. **Config keys** for jitter/retry per migrated loop (or shared default).
