# Recon: fix-fundamentals-signal-producer

**Created**: 2026-08-25
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (internal — no consumer surface; the producer is a background loop)

---

## Objective

The fundamentals signal producer's scheduler (`app/engine/fundsignal_loop.py` `run_forever`) sleeps a
full `analysis.fundsignal.run_interval_hours` (default 24h) **before** its first `run_once`, and keeps
no persisted schedule. Because CI/CD redeploys the whole app on every `main-dev` push, each restart
resets the sleep, so the first cycle is deferred up to a full interval on every deploy and, under
normal cadence, may never fire. Fix the boot timing so the first cycle fires promptly and the schedule
survives restarts, without regressing the once-per-symbol-per-day idempotency guard.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.12, asyncio/grpc.aio)
  - Scheduler: `run_forever` — `app/engine/fundsignal_loop.py:96-110` (the bug: `await asyncio.sleep(max(1,interval)*3600)` at `:100` runs **before** `run_once` at `:108`; `enabled` gate at `:101` is checked *after* the sleep; a `self._lock` guards against overlapping cycles at `:103-106`).
  - Single cycle: `run_once` — `fundsignal_loop.py:114`; writes the run record (INSERT `status='running'`) at `:124-129`; closes it in `_finish` (`UPDATE ... SET finished_at=$2, status=$3 ...`) at `:456-467`.
  - Idempotency: `fundsignal_emitted` claim (`INSERT ... ON CONFLICT DO NOTHING`) at `:172-183`; day-level read of already-emitted symbols `_already_emitted` at `:293-299`.
  - Constructor: `fundsignal_loop.py:59-92` — `config_watcher`→`self._cfg`, `db_pool`→`self._db`, gRPC stubs, optional `md_config_watcher` (2nd watcher, `namespace="marketdata"`, boot-frozen provider read `:86-91`).
  - Loop startup wiring: constructed `app/main.py:149-159`; scheduled `asyncio.get_event_loop().create_task(fundsignal_loop.run_forever())` at `main.py:161`; ConfigWatcher snapshots awaited before loops start (`main.py:42-50`, `wait_for_snapshot(timeout_seconds=90)`).
  - Last migration (fundsignal tables): `003_fundsignal_runs.up.sql` (PK `run_id uuid`; `started_at timestamptz NOT NULL DEFAULT now()`, `finished_at timestamptz`, `status`; index `idx_fundsignal_runs_started_at ON (started_at DESC)`), `004_fundsignal_emitted.up.sql` (PK `(symbol, source, as_of_date)`). Both under `services/xstockstrat-analysis/migrations/`.
  - Config-read pattern: `self._cfg.get_int("analysis.fundsignal.run_interval_hours", default=24)` (`:99`), `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)` (`:101`).

## Patterns to REUSE

- **Read persisted state at boot to reconstruct an in-memory schedule** → reuse the local
  boot-hydration precedent: `live_loop.hydrate_cooldowns()` (`app/engine/live_loop.py:228-247`, "load
  persisted last-exit/last-entry timestamps at boot") and `servicer.hydrate_scores()`
  (`app/handlers/servicer.py:2227`), both called **best-effort, non-blocking** in `main.py`
  (`:129-133`, `:104`). Ledger precedent (insights ~L580): "a per-account status that must survive a
  restart" is solved by *persisted column + boot-time hydration*, not a new mechanism.
- **The catch-up read source already exists** → `analysis.fundsignal_runs.finished_at` +
  `idx_fundsignal_runs_started_at` (migration `003`) already record and index per-cycle completion.
  A "when did the last cycle finish?" read reuses this table — **no migration, no new state** (matches
  the product-spec Option 2). NOTE: there is currently **no** `SELECT ... FROM analysis.fundsignal_runs`
  anywhere in `app/` (see Not-found) — the read query itself is net-new inline SQL, mirroring the
  existing inline INSERT/UPDATE in the same file.
- **Duplicate-emission safety net** → the existing `fundsignal_emitted` PK guard (`:172-183`) +
  `_already_emitted` (`:293-299`) already make any same-day re-run emit nothing and spend zero cache
  calls. An eager boot-time run that lands the same day as a prior run is therefore *cheap and safe by
  construction* — reuse this guard rather than adding a new "did we already run today" check on the emit path.
- **Config getters** → reuse the loop's existing `self._cfg.get_int/get_bool` calls; no new config key.
- **Test fakes** → reuse the module-level helpers in `tests/test_fundsignal_loop.py`: `_make_cfg(overrides)`
  (`:19-26`), `_make_loop(overrides)` (`:43-66`, all stubs `AsyncMock`, `_db.execute/fetch/fetchrow` faked),
  `_make_loop_154(...)`/`_make_md_cfg(...)` (`:245-267`). C-13 canonical home is `tests/conftest.py` (today
  holds only the proto-path shim — reuse the module helpers, promote to conftest only if a 2nd test file needs them).

## Existing Business Rules (preserve / extend)

- **No existing acceptance suite for `xstockstrat-analysis`** (`services/xstockstrat-analysis/acceptance/`
  does not exist). The producer's scheduling/cadence, once-per-day idempotency, universe resolution, and
  `fundamentals` source registration are **not** guarded by any promoted `@AC-*`. There is no C-16
  guarantee for this fix to preserve — but also no regression net, so the fix **must add** new `@AC-*`
  scenarios (this feature's `acceptance.feature` already has AC-1 first-cycle-on-boot, AC-2
  restart-does-not-defer) and should add a **no-duplicate-emission-across-a-boot-catch-up** scenario.
- `docs/sdd/business-rules/platform.feature` holds one cross-cutting scenario (`@AC-8 @FR-7 @feature-147`,
  MCP_AGENT_SECRET absence) — **not relevant** to this fix.

## Dependencies

- Proto/RPC: none (no `.proto` change; the fix is internal to the loop).
- Migration: **none** — reuse `analysis.fundsignal_runs` (migration `003`). If a boot-catch-up read is
  chosen it is a `SELECT`, not DDL.
- Config keys: none new — reads existing `analysis.fundsignal.run_interval_hours` / `.enabled`.
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **`## Not found`: no existing `SELECT ... FROM analysis.fundsignal_runs`** in `app/` (only the INSERT
  at `:125` and UPDATE at `:459`). A boot-catch-up read is net-new inline SQL — write it in the same
  hand-rolled style (there is no fundsignal repository/DAO class; all run SQL is inline in the loop).
- **Idempotency regression risk (flagged by scenario-recon):** a boot-time catch-up / eager first run
  must not re-emit a symbol already emitted today. Mitigated by the existing `fundsignal_emitted` PK
  guard — but because there is no `@AC-*` net, the fix must prove this with a **new** test/scenario, not
  rely on the guard silently.
- **`run_forever` scheduling is currently untested** — no test asserts sleep-vs-run ordering. The fix
  must make the scheduling decision **unit-testable without a real 24h sleep** (a monkeypatchable seam),
  mirroring feature 082's "boot-time fix proved via a monkeypatch-testable runner" (insights L417-429).
- **Startup stampede:** an eager first run on every boot means simultaneous redeploys all fire a cycle
  at once → possible contention on marketdata `GetFundamentalsMulti` / FMP budget. The `daily_call_budget`
  defer + the same-day idempotency guard bound the blast radius, but a small startup jitter is worth
  weighing in the debate.
- **`enabled=false` behavior must be preserved:** today a disabled producer sleeps then `continue`s
  (never runs). Any "run on boot" path must still respect `analysis.fundsignal.enabled=false` (no run).

## Recommended Scope

A single, small analysis-only change (one code step + one paired test step), no proto/migration/config-key:

1. **Fix `run_forever` boot timing** — restructure so the first cycle is evaluated at loop entry (guarded
   by `enabled` and the `_lock`), and the schedule survives restart. Two design options to decide in the
   debate: (A) **run-then-sleep** (invoke `run_once` at entry when enabled, then sleep the interval; add
   optional startup jitter); (B) **persisted-schedule catch-up** (read latest `fundsignal_runs.finished_at`
   at entry; run now iff `now - last >= interval`, else sleep the remainder). Both lean on the
   `fundsignal_emitted` guard so an unnecessary boot run is a no-op.
2. **Paired test** — assert the ordering/decision without a real sleep (monkeypatch `asyncio.sleep`):
   first-cycle-runs-on-boot (AC-1), restart-before-interval-does-not-defer-a-full-interval (AC-2), and
   no-duplicate-emission-across-a-boot-triggered-run (new). Reuse `_make_loop`/`_make_cfg`.
