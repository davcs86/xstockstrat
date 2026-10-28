# Implementation Spec: fix-python-loop-supervision

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/259-fix-python-loop-supervision/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/fix-python-loop-supervision`

---

## Execution Summary

The work follows design.md § Build order (recon.md:301-319). (1) A new shared `app/supervision.py` in analysis
(`spawn`/`_on_done`/`retry_until_ok`/`run_supervised`) and the eight `main.py` boot sites routed through `spawn`
(FR-2). (2) The four analysis `*_forever` loops move to seed via `retry_until_ok` → the existing one-shot jitter →
`run_supervised(tick)` (FR-1). (3) The same `_watch` catch-widen + retained-task edit in each of the three
`config/watcher.py` copies, one red-green pair per service (FR-3, D-20 kept). (4) The P&L consumer in two cycles:
first `_emit` gains keyword-only `correlation_id`/`idempotency_key`/`timeout` and the two existing emits carry the
event's trace (C-03, operator 2026-10-21); then the per-event retry, the `_is_poison` allow-list (operator r3,
binding), the replay counter with its reset rule and the bounded DB-health probe (operator r2), the stream-fail
escalation, and the log → idempotent ledger emit → advance park (FR-4, FR-5). (5) Docs and the context-forge teardown.

No proto change, no migration, no config key, no env var or port (design.md § Chosen Approach; recon.md:202-222).
Every new tunable is a documented fixed invariant under the `servicer.py:346-347` precedent (F-07).

### Scenario Coverage (C-15)

`acceptance.feature` was edited this session as design.md §4 requires: `@AC-7` is now a Scenario Outline (poison →
3 attempts, `non-transient`; persistent non-poison with the probe succeeding → 15 attempts, `transient-persistent`)
with the `analysis.pnl.event_parked` ledger step, and `@AC-9` / `@AC-10` were appended. FR-5 in product-spec.md was
amended to match.

| Scenario | Covered by |
|---|---|
| @AC-1 | Step 4 |
| @AC-2 | Step 4 |
| @AC-3 | Step 4 (all three Examples rows) |
| @AC-4 | Step 2 |
| @AC-5 | Step 6 (analysis row), Step 8 (indicators row), Step 10 (ingest row) |
| @AC-6 | Step 14 |
| @AC-7 | Step 12 (park ledger event shape: `idempotency_key`, `correlation_id`, `timeout`), Step 14 (both Examples rows) |
| @AC-8 | Step 6 (analysis row), Step 8 (indicators row), Step 10 (ingest row) |
| @AC-9 | Step 14 (both Examples rows) |
| @AC-10 | Step 14 |

### Consumer surfaces (C-14)

None — internal/platform-only (product-spec § Consumer Surface(s); design.md § Chosen Approach). No RPC, response
shape, UI route or Agent MCP tool changes; the existing surfaces show fresh data again because the loops, watchers
and consumer keep producing. This is a recorded decision, not an omission. No consumer step.

### Open-risk resolutions made by this spec (design.md § Open Risks)

- **Trace field and mTLS acceptance — confirmed.** `LedgerEvent.correlation_id` / `AppendEventRequest.correlation_id`
  is the trace field (`packages/proto/ledger/v1/ledger.proto:28` "trace/request correlation", `:41`); identity maps
  `x-trace-id → correlation_id` the same way (`services/xstockstrat-identity/src/grpc/ledgerAudit.ts:3,49`); ledger
  stores `req.correlationId` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:50`) and treats a missing
  `x-user-id` as an ownerless row, not an error (`:37-39`). Analysis's existing emits already call `AppendEvent` with
  no metadata under mTLS (`pnl_pattern_consumer.py:425-432`). `metadata` (field 8) is not used. Portfolio's emitter
  sets no `CorrelationId` today (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1026-1035`),
  so for `portfolio.position.closed` the trace is empty and no `x-trace-id` is sent: the trace is carried when
  available, never minted (operator 2026-10-21).
- **`_PROBE_TIMEOUT_SECONDS` — pinned at `5`.** `_PARK_EMIT_TIMEOUT_SECONDS = 5`.
- **Attempt hang — decided (operator 2026-10-22): bound every DB wait in an attempt.** Add
  `_ATTEMPT_DB_TIMEOUT_SECONDS = 10` (a code constant like its siblings; > `_PROBE_TIMEOUT_SECONDS`). Every
  `pool.acquire()` in the consumer (`pnl_pattern_consumer.py:205,268,400`) becomes `pool.acquire(timeout=…)`, and
  every query on the attempt path, including `fetchval` (`:141`), passes asyncpg's per-call `timeout=…`. asyncpg
  cancels a timed-out query server-side and the `async with` transaction rolls back, so nothing is cancelled
  mid-transaction at the Python level (this is why no blanket `asyncio.wait_for` wraps the attempt). The resulting
  `asyncio.TimeoutError` is non-poison, so it flows into retry → replay → probe. A pool-exhaustion hang therefore
  surfaces as WARNING/ERROR logs instead of a silent stall.
- **Probe false park under load — documented** (Step 15), K=5 with a single probe confirmation kept (design.md
  Rejected Alternatives: two-confirmation K).
- **Ledger replay amplification — recorded** in `docs/roadmap/features/merge-order.md` at Step 15 against peer
  `fix-ledger-query-pagination` (at most 5 unpaged `StreamEvents` re-queries per stuck event).

## Step Dependencies

- Step 2 [test] covers Step 1 [service]; Step 4 covers Step 3; Step 6 covers Step 5; Step 8 covers Step 7; Step 10
  covers Step 9; Step 12 covers Step 11; Step 14 covers Step 13 (C-08). Each pair is red-before-green (P-06).
- Step 3 requires Step 1: the loops import `retry_until_ok` / `run_supervised` from `app/supervision.py`.
- Step 13 requires Step 11: the park emit uses the new `_emit` keywords. Steps 11/13 share
  `pnl_pattern_consumer.py` and Steps 12/14 share `tests/test_pnl_pattern_consumer.py`: Step 13 re-greps its anchors
  on the post-Step-11 file and Step 14 builds on the post-Step-12 test file (line numbers shift).
- Steps 5, 7, 9 (watchers) are independent of Steps 1-4 and of each other; they share one edit shape (D-20).
- Step 15 requires Steps 1-14 (documents the shipped behaviour; runs the teardown last).
- **Peer rebases** (record in `merge-order.md` at Step 15; all line-disjoint today):
  - `248-fix-ledger-trimmed-notify-payload` re-greps `pnl_pattern_consumer.py:147-162` and greps
    `await asyncio.sleep(2)`. Step 13 keeps that exact line in the outer handler. Sequence 248 first or re-point.
  - `244-fix-python-config-stored-zero` edits the getters in all three `watcher.py` files and the `retry_seconds`
    reads at `fundsignal_loop.py:143,154` and `servicer.py:5890,6066`. Steps 3/5/7/9 rebase against it.
  - `246-fix-fundsignal-neutral-score` and `260-fix-fundsignal-emit-accounting` edit `fundsignal_loop.py` (scoring /
    emit areas); Step 3 rebases.
  - `262-fix-analysis-owner-scope` touches `main.py:174` and must reuse `supervision.spawn` from Step 1, not add a
    second helper.
  - `268-fix-indicators-formula-correctness` touches indicators `tests/test_config_watcher.py`; Step 8 rebases.
  - `fix-ledger-query-pagination`: replay amplification coordination (above).
  - Batch peer `256-fix-offline-book-consistency` (portfolio/trading/ui): no file overlap.

---

### Step 1 — service: analysis supervision helper + retained boot tasks (FR-2)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/supervision.py` — create
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- No supervisor exists: a grep for `add_done_callback`, `_background_tasks`, `task_registry`, `supervis` across
  `services/xstockstrat-{analysis,indicators,ingest}/app/**` returns nothing (recon.md:147-149, :279).
- The eight bare boot sites: `grep -n "create_task" services/xstockstrat-analysis/app/main.py` →
  `:143` `_boot_recompute()`, `:167` `live_loop.run_forever()`, `:174-176` `backfill_entry_times(live_loop, db_pool,
  servicer._trading, cfg_watcher)`, `:194` `fundsignal_loop.run_forever()`, `:211`
  `pnl_pattern_consumer.run_forever()`, `:215` `servicer.run_opportunity_refresh_forever()`, `:221`
  `servicer.run_readiness_materializer_forever()`, `:225` `servicer.run_template_intent_sweep_forever()`. `:120` is
  the shutdown `grpc_server.stop(grace=5)` task — out of scope, unchanged.
- Benign early returns that must not log as errors: `servicer.py:5917-5918` (`_opportunities_repo is None`),
  `:6088-6093`, `:6141-6142` (recon.md:238-244).
- Per-cycle swallow + log shape to reuse: `live_loop.py:335-338` (`except Exception as e:  # never let one bad cycle
  kill the loop` / `log.error(...)`); broad-except marker style `# noqa: BLE001 — <reason>`
  (`pnl_pattern_consumer.py:158,160`).
- Fixed-invariant precedent: `_INTENT_STALE_SECONDS = 900` / `_INTENT_SWEEP_SECONDS = 300` (`servicer.py:346-347`).
- Module logger idiom: `log = logging.getLogger(__name__)` (`main.py:25`, `fundsignal_loop.py:33`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `services/xstockstrat-analysis/app/supervision.py` (stdlib only: `asyncio`, `functools`, `logging` — import `functools` for the
   `partial` below, or use a closure and drop it) with:
   - `_LOOP_ERROR_BACKOFF_SECONDS = 30` — a fixed invariant, not a config key (design.md §3.8).
   - `_BACKGROUND_TASKS: set[asyncio.Task] = set()` — module-level retention set.
   - `def spawn(coro, name: str, *, forever: bool) -> asyncio.Task`: `task = asyncio.get_running_loop().create_task(coro,
     name=name)`; add it to `_BACKGROUND_TASKS`; `task.add_done_callback(functools.partial(_on_done, forever=forever))`
     (or a closure); return the task.
   - `def _on_done(task, *, forever)`: wrap the whole body in `try … except Exception` so it never raises (it runs on
     the event loop, and must not break `serve()` start-up — `@AC-3 @feature-171`). Always `_BACKGROUND_TASKS.discard(task)`.
     Then: `task.cancelled()` → return silently (shutdown). `exc = task.exception()`; if `exc is not None` →
     `log.error("background task %s exited unexpectedly: %r", task.get_name(), exc, exc_info=exc)`. A normal return
     → silent when `forever=False` (one-shot completion), `log.info("background task %s returned", name)` when
     `forever=True` (a `*_forever` benign early return; never an error).
   - `async def retry_until_ok(fn, name: str)`: `while True: try: return await fn() except Exception as e:
     log.error("%s failed, retrying in %ss: %s", name, _LOOP_ERROR_BACKOFF_SECONDS, e)` then
     `await asyncio.sleep(_LOOP_ERROR_BACKOFF_SECONDS)` — the sleep sits **outside** the `try`.
   - `async def run_supervised(tick, name: str)`: `while True:` `try: delay = await tick()` `except Exception as e:
     # noqa: BLE001 — one failed tick never kills the loop` → `log.error("%s: tick error, backing off %ss: %s", name,
     _LOOP_ERROR_BACKOFF_SECONDS, e)`; `delay = _LOOP_ERROR_BACKOFF_SECONDS`; then `await asyncio.sleep(delay)`
     **outside** the `try` (no busy-spin, `@AC-5 @feature-156`; a sentinel raised from `sleep` propagates). The
     backoff never touches the schedule, so an unadvanced row stays due (`@AC-3/@AC-4 @feature-156`).
   - `CancelledError` is a `BaseException` and is never caught by any of these.
2. In `services/xstockstrat-analysis/app/main.py`, add `from app.supervision import spawn` and replace each of the
   eight `asyncio.get_event_loop().create_task(X)` calls with `spawn(X, "<name>", forever=<bool>)`:
   `:143` `"boot-recompute"`, `forever=False`; `:167` `"live-loop"`, `True`; `:174` `"entry-backfill"`, `False`;
   `:194` `"fundsignal-loop"`, `True`; `:211` `"pnl-pattern-consumer"`, `True`; `:215` `"opportunity-refresh"`, `True`;
   `:221` `"readiness-materializer"`, `True`; `:225` `"template-intent-sweep"`, `True`. Leave `:120` unchanged.
   Keep the existing `log.info(... started)` lines.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -c "create_task(" app/main.py   # expect 1 (the :120 shutdown task; the :220 comment has no "(")
grep -n "spawn(" app/main.py          # expect 8 call sites
ruff check . && ruff format --check .
```

---

### Step 2 — test: supervision helper and boot retention (@AC-4)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_supervision.py` — create

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `asyncio_mode = "auto"` (`services/xstockstrat-analysis/pyproject.toml:32`) — bare `async def test_*` runs.
- Source-inspection test idiom on `app.main`: `from app import main as app_main` +
  `inspect.getsource(app_main)` (`tests/test_strategy_templates.py:21,589`; `tests/test_owner_header_guard.py:19,114`).
- `app/supervision.py` does not exist before Step 1, so every test here is RED at import against the pre-Step-1 tree.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. `@AC-4` — spawn two tasks via `supervision.spawn`: `boom` (an `async def` that raises `RuntimeError("boom")`,
   `forever=True`) and `steady` (awaits an `asyncio.Event`, `forever=True`). Yield the loop (`await asyncio.sleep(0)`
   twice). Assert with `caplog` (level ERROR) a record whose message contains the task name and `"boom"`; assert
   `steady` is not done and is still in `supervision._BACKGROUND_TASKS`; `boom` was discarded. Cancel `steady` at
   teardown and assert no ERROR is logged for it (cancellation is silent).
2. One-shot normal completion (`forever=False`) logs nothing at ERROR/INFO from the supervisor; a `forever=True`
   normal return logs at INFO, never ERROR.
3. `_on_done` never raises: patch `task.exception` to raise inside a fake task object and call `_on_done` directly —
   no exception escapes.
4. `run_supervised`: a tick that raises `asyncpg.PostgresConnectionError` once then returns `0.0`; patch
   `app.supervision.asyncio.sleep` with a recorder that raises a `class _Stop(BaseException)` on its 3rd call. Assert
   the recorded sleeps start `[30, 0.0]` (backoff equals `_LOOP_ERROR_BACKOFF_SECONDS`, then the tick's own delay),
   the tick ran a second time, and an ERROR record was logged. The sentinel is a `BaseException` (design.md Open
   Risks: an `Exception` sentinel would be swallowed and spin).
5. `retry_until_ok`: `fn` raises twice then returns `"ok"`; sleeps recorded `[30, 30]`; result `"ok"`.
6. Boot wiring guard: `inspect.getsource(app_main)` contains exactly one `create_task(` (the shutdown task) and the
   eight `spawn(` names from Step 1.
- C-13: all literals are scenario one-offs with a single consumer (this file) — inline is compliant; no conftest entry.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_supervision.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest" tests/test_supervision.py   # expect none (single-consumer inline literals, C-13)
```

---

### Step 3 — service: analysis `*_forever` loops run under supervision (FR-1)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `FundamentalsSignalLoop.run_forever` `fundsignal_loop.py:158-165`: `await self._seed_schedule()` `:160`, jitter
  `:162-163`, `while True: await asyncio.sleep(await self._tick())` `:164-165`. `_tick` `:128-156` calls
  `_next_sleep_seconds` at `:131` outside any try; its `except Exception` at `:152` calls
  `await self._advance_schedule(retry)` at `:155`, unguarded (recon.md:33-40).
- `run_opportunity_refresh_forever` `servicer.py:5906`: early return `:5917-5918`, `DurableSchedule(...)` `:5919-5924`,
  `await schedule.seed()` `:5925`, jitter `:5927-5928`, loop `:5929-5930`
  (`await asyncio.sleep(await self._opportunity_refresh_tick(schedule))`).
- `run_readiness_materializer_forever` `servicer.py:6082`: early return `:6088-6093`, `seed` `:6100`, jitter
  `:6103-6104`, loop `:6105-6106`.
- `run_template_intent_sweep_forever` `servicer.py:6139`: early return `:6141-6142`, `seed` `:6144`, loop
  `:6145-6146` (no jitter).
- `functools` is already imported in `servicer.py:15`; app imports are grouped at `servicer.py:42-89`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `fundsignal_loop.py`: add `from app.supervision import retry_until_ok, run_supervised`. Rewrite `run_forever` as
   `await retry_until_ok(self._seed_schedule, "fundsignal seed")` → the unchanged jitter lines → `await
   run_supervised(self._tick, "fundsignal")`. Look `self._seed_schedule` / `self._tick` up at call time (bound
   attributes), so test monkeypatches still apply. Do **not** add a `try` inside `_tick`: the unguarded `:131`
   `next_sleep_seconds` and the `:155` error-path `_advance_schedule` are covered by the wrapper (design.md §1).
2. `servicer.py`: add `from app.supervision import retry_until_ok, run_supervised`. In each of the three loops replace
   `await schedule.seed()` with `await retry_until_ok(schedule.seed, "<loop> seed")` and the `while True` loop with
   `await run_supervised(functools.partial(self.<tick>, schedule), "<loop>")`, where `<tick>` is
   `_opportunity_refresh_tick` / `_readiness_materializer_tick` / `_template_intent_sweep_tick` and `<loop>` is
   `opportunity-refresh` / `readiness-materializer` / `template-intent-sweep`.
3. Keep unchanged: the early returns, the jitter bounds and keys, the wall-clock anchor, every `advance(...)` call and
   the `retry_seconds` cadence (`@AC-7/@AC-8/@AC-9 @feature-158`, `@AC-4 @feature-156`). `live_loop.run_forever`
   (`live_loop.py:326-338`) is not touched — it only gains retention via Step 1.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "run_supervised\|retry_until_ok" app/engine/fundsignal_loop.py app/handlers/servicer.py   # 4 run_supervised + 4 retry_until_ok call sites
grep -n "while True" app/engine/fundsignal_loop.py   # expect none left in run_forever
ruff check . && ruff format --check .
```

---

### Step 4 — test: loops survive schedule and cycle errors (@AC-1, @AC-2, @AC-3)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_loop_supervision.py` — create

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Sentinel `class _StopLoop(Exception)` `tests/test_fundsignal_loop.py:377`, used by the `@AC-7 @feature-156` jitter
  tests at `:496-501` and `:513-516` with `_tick` patched to `AsyncMock(side_effect=_StopLoop)`. Under Step 3 that
  sentinel is raised inside `run_supervised`'s `try`, swallowed, and the mocked sleep spins forever — it must become
  a `BaseException` (design.md Open Risks).
- Helpers `_sched_loop` `:381`, `_make_loop` `:47`, `_make_cfg` `:23`; `fundsignal_module.asyncio` sleep patched at `:496`
  and `:513`; `_tick` patched with `side_effect=_StopLoop` at `:501` and `:516` (re-grep these anchors before editing).
- `app/engine/fundsignal_loop.py`: `_tick` `:128` (the `_advance_schedule(retry)` raise path `:155`), `run_forever`
  `:158` (`await asyncio.sleep(await self._tick())` `:165`).
- `tests/test_opportunity_refresh.py:109` `class _Stop(Exception)` is raised from the patched sleep, which Step 1
  places outside the `try`, so `test_startup_jitter_bounded` (`:93`) stays valid unchanged.
- Servicer builder `make_servicer` imported from `tests.test_analysis_servicer` (`tests/test_opportunity_refresh.py:15`).
- `DurableSchedule` is imported into `app.handlers.servicer` (`servicer.py:44`), so
  `monkeypatch.setattr("app.handlers.servicer.DurableSchedule.next_sleep_seconds", ...)` patches the class the loops build.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. `tests/test_fundsignal_loop.py`: change `class _StopLoop(Exception)` to `class _StopLoop(BaseException)` (keep the
   docstring); the two `@AC-7 @feature-156` jitter tests otherwise stay as they are.
2. `@AC-1` (same file): a `_sched_loop({"analysis.fundsignal.enabled": True}, blocked_until_ms=0)` loop whose
   `_schedule.next_sleep_seconds` is an `AsyncMock(side_effect=[asyncpg.PostgresConnectionError("down"), 0.0, ...])`,
   `run_once` an `AsyncMock`, `_seed_schedule` an `AsyncMock`; patch `random.uniform` → 0 and `asyncio.sleep` with a
   recorder raising `_StopLoop` on the 4th call (jitter, backoff, post-tick, stop). Run `run_forever` under
   `pytest.raises(_StopLoop)`. Assert: the task did not end with the connection error, `_tick` ran again after the
   error (`next_sleep_seconds.await_count >= 2`, `run_once` awaited), the recorded sleeps contain `30`, and an ERROR
   record names the error. RED today: the error escapes `run_forever` at `:165`.
3. `@AC-2`: `run_once = AsyncMock(side_effect=asyncpg.PostgresConnectionError("down"))`, `_advance_schedule =
   AsyncMock(side_effect=[asyncpg.PostgresConnectionError("adv"), None])`, schedule due. Same sleep recorder. Assert a
   further tick runs (`run_once.await_count >= 2`) and the connection error was logged. RED today: the `:155` raise
   ends the loop.
4. `@AC-3` (new `tests/test_loop_supervision.py`, `pytest.mark.parametrize` over the three Examples rows): build the
   servicer with `make_servicer()`; set the attributes the early return checks to non-`None`
   (`_opportunities_repo` / `_readiness_cache_repo` + `_strategies_repo` / `_template_intents_repo`, and `_db_pool` an
   `AsyncMock()` pool); patch `app.handlers.servicer.DurableSchedule.seed` to an `AsyncMock`,
   `.next_sleep_seconds` to raise `asyncpg.PostgresConnectionError` once then return `3600.0`, `random.uniform` → 0,
   and `asyncio.sleep` with a `BaseException` sentinel recorder that stops after the post-error tick. Assert the loop
   did not die on the error, `next_sleep_seconds` was awaited twice (the tick ran again), and an ERROR was logged.
   Add a second parametrized case per loop (and one for the fundsignal loop with `_seed_schedule =
   AsyncMock(side_effect=[asyncpg.PostgresConnectionError("seed"), None])`) where `DurableSchedule.seed` raises
   `asyncpg.PostgresConnectionError` once then returns: assert `seed` was awaited twice, a `30` backoff sleep was
   recorded before the first tick, and an ERROR was logged — pins the per-loop `retry_until_ok` wiring.
5. Re-run the existing scheduler suites unchanged as the PRESERVE guard: `tests/test_fundsignal_loop.py::TestScheduler`
   (`@AC-1..@AC-7 @feature-156`), `tests/test_opportunity_refresh.py` (`@AC-7/@AC-8/@AC-9 @feature-158`),
   `tests/test_readiness_materializer.py`, `tests/test_durable_schedule.py`.
- C-13: the new test's pool/schedule doubles are single-consumer scenario one-offs (`AsyncMock`) — inline is compliant.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_fundsignal_loop.py tests/test_loop_supervision.py tests/test_opportunity_refresh.py tests/test_readiness_materializer.py tests/test_durable_schedule.py tests/test_strategy_templates.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "class _StopLoop(BaseException)" tests/test_fundsignal_loop.py
```

---

### Step 5 — service: analysis ConfigWatcher reconnects after any exception; watch task retained (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `ConfigWatcher.__init__` `watcher.py:43`; unretained `asyncio.get_event_loop().create_task(self._watch())` `:56`.
- `_build_watch_request` `:58-64` (`client_id=f"analysis-{id(self)}"`, `@AC-1 @feature-174`).
- `_watch` `:66-80`: `stream = self._stub.WatchConfig(self._build_watch_request())` `:69`, snapshot assignment
  `:71-72`, `except grpc.aio.AioRpcError as e:` `:78`, `log.warning("config stream error: %s, reconnecting in 2s", e)`
  `:79`, `await asyncio.sleep(2)` `:80`.
- Analysis builds two watchers (`cfg_watcher` and `ConfigWatcher(namespace="marketdata")`), both covered by one edit
  (recon.md:90-91).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `__init__`, replace `:56` with `self._watch_task = asyncio.get_event_loop().create_task(self._watch(),
   name=f"config-watch-{namespace}")` and `self._watch_task.add_done_callback(self._on_watch_done)`.
2. Add `def _on_watch_done(self, task)`: return silently on `task.cancelled()`; otherwise `exc = task.exception()` and
   `log.error("config watch task %s exited unexpectedly: %r", task.get_name(), exc)` (an exit of any kind is
   unexpected — `_watch` never returns). Wrap the body in `try … except Exception` so the callback never raises.
   This is a local callback, not `supervision.spawn`, so the three copies stay identical (design.md §2).
3. In `_watch`, widen `except grpc.aio.AioRpcError as e:` to `except Exception as e:  # noqa: BLE001 — any error
   reconnects; CancelledError propagates` and log `"config stream error (%s): %s, reconnecting in 2s"` with
   `type(e).__name__, e`. Keep `await asyncio.sleep(2)` and the single `while True` loop — no second `_watch` task
   (stream-doubling shape, recon.md:226-228). Do not reset `self._snapshot` on error (zero-trap, recon.md:229-231).
   Keep `self._build_watch_request()` as the per-reconnect request builder.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "except grpc.aio.AioRpcError" app/config/watcher.py   # expect none
grep -n "_watch_task\|_on_watch_done\|_build_watch_request()" app/config/watcher.py
ruff check . && ruff format --check .
```

---

### Step 6 — test: analysis watcher reconnect and exit log (@AC-5, @AC-8 analysis rows)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The file today covers only `resolve_environment` / `resolve_trading_mode` (`tests/test_config_watcher.py:11-38`).
- Dial-free construction idiom `ConfigWatcher.__new__(ConfigWatcher)` (indicators `tests/test_config_watcher.py:52`,
  ingest `:52`, comment "fails-074"). A live `__init__` dials `grpc.aio.secure_channel` with `mtls.channel_credentials()`
  / `mtls.target_override(...)` (`watcher.py:51-54`; `app/mtls.py:36,44`) and must be patched (ledger fails.md:125).
- `ConfigSnapshot.version` is field 2 (`packages/proto/config/v1/config.proto:51`).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-8` (analysis rows)

**Instructions**:
1. `@AC-5`: build `w = ConfigWatcher.__new__(ConfigWatcher)` and set `namespace`, `_environment`, `_trading_mode`,
   `_snapshot = None`, `_snapshot_event = asyncio.Event()`, and `_stub` a fake whose `WatchConfig(req)` returns, on call
   1, an async iterator raising `RuntimeError("boom")`; on call 2, one yielding `config_pb2.ConfigSnapshot(version="v2")`
   and then raising a `class _Done(BaseException)`. Patch `app.config.watcher.asyncio.sleep` with an `AsyncMock`.
   `with pytest.raises(_Done): await w._watch()`. Assert `WatchConfig` was called twice, `sleep` awaited with `2` between
   the calls, `w._snapshot.version == "v2"`, and both requests carry the `analysis-` `client_id` prefix. RED today: the
   `RuntimeError` escapes `_watch`.
2. `@AC-8`: monkeypatch `app.config.watcher.grpc.aio.secure_channel`, `app.config.watcher.mtls.channel_credentials`,
   `app.config.watcher.mtls.target_override` and `app.config.watcher.config_pb2_grpc.ConfigServiceStub` to stubs, and
   `ConfigWatcher._watch` to an `async def` raising `RuntimeError("boom")`. Construct `ConfigWatcher("x:1", "analysis")`
   inside the async test, yield the loop, and assert `w._watch_task` is retained and done, and an ERROR record contains
   `config-watch-analysis` and `"boom"`. RED today: there is no `_watch_task` and no log.
- C-13: single-consumer inline doubles — compliant.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_config_watcher.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 7 — service: indicators ConfigWatcher reconnects after any exception; watch task retained (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- `ConfigWatcher.__init__` `watcher.py:43`; unretained `create_task(self._watch())` `:56`.
- `_watch` `:58-79` builds `config_pb2.WatchConfigRequest(namespace=..., client_id=f"indicators-{id(self)}", ...)`
  inline (`:61-68`, no `_build_watch_request` helper); `except grpc.aio.AioRpcError as e:` `:77`; `sleep(2)` `:79`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Apply the Step 5 edit shape identically (D-20; design.md §2): retained `self._watch_task` named
`f"config-watch-{namespace}"` with the local `_on_watch_done` callback; `_watch`'s catch widened to `Exception` with the
same `# noqa: BLE001` reason and log text; keep the inline request build (no new helper — not in scope), the 2 s sleep,
the single loop and the last good snapshot (`@AC-4 @feature-173`).

**Verification**:
```bash
cd services/xstockstrat-indicators
grep -n "except grpc.aio.AioRpcError" app/config/watcher.py   # expect none
grep -n "_watch_task\|_on_watch_done" app/config/watcher.py
ruff check . && ruff format --check .
```

---

### Step 8 — test: indicators watcher reconnect and exit log (@AC-5, @AC-8 indicators rows)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Existing dial-free helpers `_str_watcher` `tests/test_config_watcher.py:51-52` and the `__new__` idiom `:68`;
  `config_pb2` already imported `:10`.
- `asyncio_mode = "auto"` (`services/xstockstrat-indicators/pyproject.toml:35`).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-8` (indicators rows)

**Instructions**:
Mirror Step 6 for indicators: `@AC-5` drives `_watch()` on a `__new__` watcher with the two-stream fake stub and a
patched `app.config.watcher.asyncio.sleep`, asserting two `WatchConfig` calls, a 2 s backoff, snapshot version `"v2"`
and the `indicators-` `client_id` prefix; `@AC-8` constructs a patched live watcher whose `_watch` raises
`RuntimeError("boom")` and asserts the retained task and an ERROR naming `config-watch-<namespace>` and `"boom"`.
Keep the existing getter tests (`:59-73`) untouched (feature 244 rebase).

**Verification**:
```bash
cd services/xstockstrat-indicators
uv run pytest tests/test_config_watcher.py -q
uv run pytest --cov=app --cov-fail-under=50
ruff check . && ruff format --check .
```

---

### Step 9 — service: ingest ConfigWatcher reconnects after any exception; watch task retained (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `ConfigWatcher` `watcher.py:50`, `__init__` `:56`, unretained `create_task(self._watch())` `:69`.
- `_build_watch_request` `:71-77` (`client_id=f"ingest-{id(self)}"`, `@AC-2 @feature-174`).
- `_watch` `:79-93`: `except grpc.aio.AioRpcError as e:` `:91`, `sleep(2)` `:93`.
- Out of scope, left untouched (P-03): the unretained `run_mcp_client_loop` task at `app/main.py:127` (peer 261's area).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Apply the Step 5 edit shape identically: retained `self._watch_task` + `_on_watch_done`; catch widened to `Exception`;
reconnect still through `self._build_watch_request()`; 2 s sleep, single loop and last good snapshot kept
(`@AC-1..@AC-3 @feature-173`).

**Verification**:
```bash
cd services/xstockstrat-ingest
grep -n "except grpc.aio.AioRpcError" app/config/watcher.py   # expect none
grep -n "_watch_task\|_on_watch_done\|_build_watch_request()" app/config/watcher.py
ruff check . && ruff format --check .
```

---

### Step 10 — test: ingest watcher reconnect and exit log (@AC-5, @AC-8 ingest rows)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Dial-free helper `_int_watcher` `tests/test_config_watcher.py:50-52` (`__new__`, comment "fails-074"); `pytest` and
  `config_pb2` already imported (`:9,11`).
- `asyncio_mode = "auto"` (`services/xstockstrat-ingest/pyproject.toml:33`).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-8` (ingest rows)

**Instructions**:
Mirror Step 6 for ingest, asserting the `ingest-` `client_id` prefix on both requests in `@AC-5` and the
`config-watch-<namespace>` + `"boom"` ERROR in `@AC-8`. Keep the existing getter tests untouched.

**Verification**:
```bash
cd services/xstockstrat-ingest
uv run pytest tests/test_config_watcher.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 11 — service: P&L consumer `_emit` keywords; existing emits carry the event trace (C-03)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_emit(self, event_type, stream_key, payload)` `pnl_pattern_consumer.py:415-435`: builds a `Struct`, calls
  `self._ledger.AppendEvent(ledger_pb2.AppendEventRequest(event_type=..., source_service="xstockstrat-analysis",
  stream_key=..., payload=p))` `:425-432` with no metadata, and swallows every error at `:434-435`
  (`# noqa: BLE001 — audit is best-effort`).
- Existing callers: `:243` (snapshot captured/degraded, in `_handle_order_event`) and `:299` (`analysis.pattern.sealed`,
  in `_handle_close_event`); both have `event` in scope.
- Request fields: `AppendEventRequest.correlation_id = 3`, `idempotency_key = 8` (`ledger.proto:41,50`).
- Header-propagation mechanism for Python is per-call `metadata` (root `CLAUDE.md` § Header Propagation; the consumer
  already passes `metadata=meta` per call, e.g. `:72`, `:101`, `:111`). This is a background consumer with no inbound request; the
  only trace available is `event.correlation_id` (operator 2026-10-21). No `x-user-id`/`x-access-scope` is minted.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signature to `async def _emit(self, event_type, stream_key, payload, *, correlation_id: str = "",
   idempotency_key: str = "", timeout: float | None = None) -> None`. Set `correlation_id=correlation_id` and
   `idempotency_key=idempotency_key` on the `AppendEventRequest`; call
   `self._ledger.AppendEvent(req, metadata=(("x-trace-id", correlation_id),) if correlation_id else (), timeout=timeout)`.
   The existing `except` still swallows everything, including `DEADLINE_EXCEEDED`.
2. Pass `correlation_id=event.correlation_id` at the `:243` and `:299` call sites. Their `timeout` stays `None`, so
   latency is unchanged (design.md §3.7).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "correlation_id=event.correlation_id" app/engine/pnl_pattern_consumer.py   # expect 2
grep -n "x-trace-id" app/engine/pnl_pattern_consumer.py
ruff check . && ruff format --check .
```

---

### Step 12 — test: `_emit` request shape and trace propagation

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `FakeLedger` `tests/test_pnl_pattern_consumer.py:138-145`: `AppendEvent(self, req, metadata=())` records only
  `req.event_type` into `self.appended`; it does not accept `timeout`, so the Step 11 call would raise `TypeError`
  (and `_emit` would swallow it) — the fake must widen.
- `make_event` `:22-34` builds real `ledger_pb2.LedgerEvent`s (no `correlation_id` today); `make_consumer` `:177-196`.

**TDD**: `red-green required`

**Covers**: `AC-7` (the park ledger event's request shape: `idempotency_key`, `correlation_id`, `timeout`)

**Instructions**:
1. Widen `FakeLedger.AppendEvent(self, req, metadata=(), timeout=None)` and add `self.calls = []` recording
   `(req, tuple(metadata), timeout)`; keep `self.appended` as is so existing assertions hold.
2. Add a keyword `correlation_id=""` to `make_event` (default keeps every existing caller unchanged).
3. Tests: (a) `_emit(..., correlation_id="t-1", idempotency_key="k-1", timeout=5)` sends a request with those fields,
   metadata `(("x-trace-id", "t-1"),)` and `timeout=5`; (b) an empty `correlation_id` sends no metadata and empty
   fields; (c) an order event and a close event built with `correlation_id="t-9"` produce `analysis.snapshot.*` and
   `analysis.pattern.sealed` appends whose request `correlation_id == "t-9"` and whose metadata carries
   `x-trace-id: t-9`, with `timeout is None`. RED today: `_emit` takes no keywords and sends no correlation.
- C-13: `FakeLedger`/`make_event` stay in this file (single consumer) — compliant.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_pnl_pattern_consumer.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 13 — service: P&L consumer retry, poison allow-list, replay, probe, escalation and park (FR-4, FR-5)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `run_forever` `:147-162`: outer `while True: try:` → `cursor = await self._cursor()` `:151` →
  `StreamEvents(StreamEventsRequest(from_sequence=cursor))` `:152-154` → `async for event in stream:` `:155` → per-event
  `try: await self.process_event(event)` `:156-157` / `except Exception as e:  # noqa: BLE001 — one bad event never
  kills the loop` `:158` / `log.warning("pnl consumer: event %s error: %s", ...)` `:159`; outer
  `except Exception as e:  # noqa: BLE001 — reconnect on stream drop` `:160`, `log.warning(... retrying ...)` `:161`,
  `await asyncio.sleep(2)` `:162`.
- `_cursor()` `:140-145`; `process_event` `:164` re-reads the cursor `:165` and returns early on
  `event.sequence <= cursor` `:167-168`; self-emissions advance the cursor at `:170-174` (so the park event is skipped
  on the way back in).
- `_advance_cursor(sequence)` `:399-401` over the `GREATEST` upsert `:403-413` — reused for the park, no new write.
- Constants block `CONSUMER_NAME` `:37`, `ORDER_EVENTS` `:41-46`, `CLOSE_EVENT` `:47`.
- Inclusive replay: ledger `StreamEvents` seeds `maxSeq` at `fromSequence-1` and queries `sequence >= $3`
  (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:190-191,239`; context.md r2 rationale), so the cursor's
  own row is re-delivered on every reconnect.
- asyncpg exception import idiom `import asyncpg.exceptions as apg` (`app/repositories/read_budget.py:8`);
  `asyncpg.DataError` is already used in this repo (2 hits). `read_budget.is_transient_db_error` / `_TRANSIENT` are
  **not** used (operator r3; fails.md 2026-10-22 entry).
- asyncpg exception names verified 2026-10-22 against the locked `asyncpg==0.31.0` wheel
  (`services/xstockstrat-analysis/uv.lock:44-45`), `asyncpg/exceptions/__init__.py`: `PostgresConnectionError`,
  `DataError`, `IntegrityConstraintViolationError`, `SerializationError`, `DeadlockDetectedError` (both
  `TransactionRollbackError` subclasses), `OutOfMemoryError` (an `InsufficientResourcesError` subclass, as is
  `DiskFullError`); all re-exported at top level by `from .exceptions import *`. Re-confirm if the lock is bumped.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Imports: `import asyncpg.exceptions as apg`, `from google.protobuf.json_format import ParseError` (add to the
   existing `MessageToDict` import), `from google.protobuf.message import DecodeError`.
2. Fixed invariants beside the constants at `:37-47` (not config keys, design.md §3.8): `_EVENT_MAX_ATTEMPTS = 3`,
   `_EVENT_RETRY_BACKOFF_SECONDS = 1.0`, `_REPLAY_ESCALATE_AFTER = 5`, `_PROBE_TIMEOUT_SECONDS = 5`,
   `_PARK_EMIT_TIMEOUT_SECONDS = 5`; `_POISON = (ValueError, TypeError, KeyError, DecodeError, ParseError,
   apg.DataError, apg.IntegrityConstraintViolationError)` (SQLSTATE classes 22 / 23); and
   `def _is_poison(e: BaseException) -> bool: return isinstance(e, _POISON)`. Everything unlisted (incl.
   `OutOfMemoryError` 53200, `DeadlockDetectedError`/`SerializationError` class 40, `DiskFullError`,
   `InsufficientResourcesError`, `OSError`/`TimeoutError`, gRPC errors) is non-poison.
3. `__init__`: `self._replay_seq: int | None = None`, `self._replay_count = 0`, `self._stream_fail_count = 0`.
4. `async def _probe_db(self) -> None: await asyncio.wait_for(self._cursor(), _PROBE_TIMEOUT_SECONDS)` — the single
   DB-health probe seam (`_cursor` per design.md §3.4).
5. `async def _process_with_retry(self, event) -> None`: up to `_EVENT_MAX_ATTEMPTS` attempts of
   `await self.process_event(event)`; return on the first success. On an exception, keep it as `last` and
   `log.warning` (sequence, event_type, attempt, error); `await asyncio.sleep(_EVENT_RETRY_BACKOFF_SECONDS)` between
   attempts, **outside** the `try`. Only an exception escaping `process_event` is a failed attempt; degraded/partial
   snapshots are successes (`@AC-17 @feature-225`, `@AC-6 @feature-042`). Each attempt re-reads the cursor, so a
   partly committed attempt short-circuits (no double apply, no double emit — `@AC-7 @feature-042`,
   `@AC-10 @feature-029`). After exhaustion:
   - `_is_poison(last)` → `await self._park(event, attempts=_EVENT_MAX_ATTEMPTS, reason="non-transient", error=last)`;
     return.
   - Otherwise update the replay pair: `if event.sequence == self._replay_seq: self._replay_count += 1` else
     `self._replay_seq, self._replay_count = event.sequence, 1`. Log at WARNING below `_REPLAY_ESCALATE_AFTER`, at
     ERROR from it on, naming sequence, event_type and correlation_id.
   - If `self._replay_count >= _REPLAY_ESCALATE_AFTER`: `try: await self._probe_db()` `except Exception as probe_err:`
     → `log.error(...)` (DB down / pool exhausted / probe timed out) and `raise last from probe_err` — no park, no time
     cap. If the probe returns → `await self._park(event, attempts=self._replay_count * _EVENT_MAX_ATTEMPTS,
     reason="transient-persistent", error=last)`; return.
   - Else `raise last` to the outer reconnect handler.
6. `async def _park(self, event, *, attempts, reason, error) -> None` — fixed order (design.md §3.6):
   (a) `log.error` with sequence, event_id, event_type, correlation_id, attempts, reason, `type(error).__name__` and the
   identity key read directly from `event.payload.fields` (`user_id`/`account_id`/`symbol` `.string_value` when present
   — never `MessageToDict`, which a poison payload may be what failed);
   (b) `await self._emit("analysis.pnl.event_parked", f"pnl_park:{event.sequence}", {sequence, event_id, event_type,
   attempts, reason, error, identity keys}, correlation_id=event.correlation_id,
   idempotency_key=f"pnl_park:{event.sequence}", timeout=_PARK_EMIT_TIMEOUT_SECONDS)`;
   (c) `await self._advance_cursor(event.sequence)`;
   (d) `self._replay_seq, self._replay_count = None, 0`.
   A raise in (c) propagates to the reconnect handler without running (d); the re-park on replay is deduplicated by
   the ledger idempotency key.
6b. Per-attempt DB bound (operator 2026-10-22): apply `_ATTEMPT_DB_TIMEOUT_SECONDS` to every `pool.acquire()`
   (`:205,268,400` → `acquire(timeout=_ATTEMPT_DB_TIMEOUT_SECONDS)`) and every attempt-path query (`:141` `fetchval` and
   the `execute`/`fetch` calls inside `process_event`) via asyncpg's `timeout=` argument. Do not wrap
   `process_event` in `asyncio.wait_for`.
7. `run_forever`: inside `async for event in stream:` first set `self._stream_fail_count = 0`, then
   `await self._process_with_retry(event)` (replacing `:156-159`), then the reset rule — only
   `if self._replay_seq is not None and event.sequence >= self._replay_seq: self._replay_seq, self._replay_count = None, 0`
   (the re-delivered cursor row has `sequence < _replay_seq`, so it never resets). In the outer `except` at `:160`,
   increment `self._stream_fail_count` and log at WARNING below `_REPLAY_ESCALATE_AFTER`, ERROR from the 5th
   consecutive failure on. Keep `await asyncio.sleep(2)` byte-identical (peer 248's verification grep).

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "_is_poison\|_process_with_retry\|_probe_db\|_park(\|_stream_fail_count\|_replay_seq" app/engine/pnl_pattern_consumer.py
grep -n "await asyncio.sleep(2)" app/engine/pnl_pattern_consumer.py   # still present (peer 248)
grep -n "is_transient_db_error\|_TRANSIENT" app/engine/pnl_pattern_consumer.py   # expect none
grep -n "acquire(" app/engine/pnl_pattern_consumer.py   # every hit passes timeout=_ATTEMPT_DB_TIMEOUT_SECONDS
ruff check . && ruff format --check .
```

---

### Step 14 — test: retry, park, replay, probe and escalation (@AC-6, @AC-7, @AC-9, @AC-10)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `FakeLedger` `:138` has no `StreamEvents` (recon.md:144-146); `FakePool.fetchval` returns `self.cursor` for
  `ledger_stream_cursor` SQL and `execute` applies `max(...)` (`:59-75`), matching the real `GREATEST` upsert.
- `make_event(seq, event_type, payload, ...)` `:22`; `CLOSE_EVENT = "portfolio.position.closed"`
  (`pnl_pattern_consumer.py:47`); `_handle_close_event` is the per-event seam to make fail (`:256`).
- No test drives `PnLPatternConsumer.run_forever` under an injected exception today (recon.md:283-284).

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-9, AC-10`

**Instructions**:
1. Add to `FakeLedger` a scripted `StreamEvents(self, req)` (sync call returning an async iterator): record
   `req.from_sequence`; yield every scripted event with `sequence >= from_sequence` (inclusive replay); after a
   configured number of calls raise `class _StopConsumer(BaseException)` so `run_forever` exits. Patch
   `app.engine.pnl_pattern_consumer.asyncio.sleep` with an `AsyncMock` recorder in each test. Fail an event by
   monkeypatching `consumer._handle_close_event` with a wrapper that counts attempts for sequence 10 and raises per
   the scenario, delegating to the original otherwise.
2. `@AC-6`: cursor 9; events 9 (already processed), 10, 11 (close events with an open window for 11 or plain advance);
   10 raises `asyncpg.PostgresConnectionError` once then succeeds. Assert 10 succeeded before 11 was processed (order
   of handler calls), the cursor ends at 11, and the stream was opened once. RED today: 10 is skipped and never retried.
3. `@AC-7` (parametrize both Examples rows): row 1 raises `ValueError` (also run with `asyncpg.DataError` and
   `asyncpg.IntegrityConstraintViolationError` as extra cases) → exactly 3 attempts, parked `reason="non-transient"`;
   row 2 raises `asyncpg.exceptions.OutOfMemoryError` with the real `_probe_db` (FakePool succeeds) → 15 attempts
   across 5 reconnects, parked `reason="transient-persistent"`. Both: an ERROR park record names sequence 10 and the
   reason; `FakeLedger.calls` holds one `analysis.pnl.event_parked` request with `idempotency_key == "pnl_park:10"` and
   `timeout == 5`; event 11 is processed; the cursor ends at 11; the park order is log → emit → advance (record order
   via the caplog index, the `calls` index and a wrapped `_advance_cursor`).
4. `@AC-9` (parametrize): `OutOfMemoryError` with `consumer._probe_db = AsyncMock(side_effect=asyncpg.PostgresConnectionError)`
   and `DeadlockDetectedError` with `_probe_db` raising `TimeoutError`. Stop after the 5th replay. Assert no park (no
   `analysis.pnl.event_parked` call), cursor still 9, the 5th replay logged ERROR naming sequence 10 (replays 1-4 at
   WARNING), and `consumer._replay_count == 5` even though event 9 was re-delivered on every reconnect (reset-rule
   test). Add a unit test that `_probe_db` raises `TimeoutError` when `_cursor` hangs and `_PROBE_TIMEOUT_SECONDS` is
   monkeypatched to `0.01` (bounded probe).
5. `@AC-10`: `consumer._cursor = AsyncMock(side_effect=asyncpg.PostgresConnectionError)`; let the sleep recorder raise
   `_StopConsumer` on its 5th call. Assert 4 WARNING then 1 ERROR outer-handler records.
6. Extra pinned behaviours: success on `sequence >= _replay_seq` resets the pair; a raise in `_advance_cursor` during a
   park (both branches) leaves `_replay_seq` set and the re-park reuses `idempotency_key "pnl_park:10"`; `_is_poison`
   truth table (True: `ValueError`, `TypeError`, `KeyError`, `DecodeError`, `ParseError`, `DataError`,
   `IntegrityConstraintViolationError`; False: `OutOfMemoryError`, `DeadlockDetectedError`, `SerializationError`,
   `TimeoutError`, `RuntimeError`).
6c. Per-attempt DB bound (operator 2026-10-22): with `_ATTEMPT_DB_TIMEOUT_SECONDS` monkeypatched to 0.05, a fake
   pool whose `acquire(timeout=…)` honours the timeout (raises `asyncio.TimeoutError`) makes `_process_with_retry`
   fail each attempt within the bound and reach the replay path (WARNING logged, replay pair updated), never a
   silent stall. Assert `acquire` was called with `timeout=_ATTEMPT_DB_TIMEOUT_SECONDS`. RED today: `acquire()`
   takes no timeout.
7. Re-run the existing consumer tests unchanged as the PRESERVE guard (`@AC-2/@AC-6/@AC-7 @feature-042`,
   `@AC-10 @feature-029`, `@AC-17 @feature-225`).
- C-13: `FakeLedger.StreamEvents` and the event literals have one consumer (this file) — inline is compliant.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_pnl_pattern_consumer.py tests/test_query_pnl_patterns.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest" tests/test_pnl_pattern_consumer.py   # expect none (single consumer, C-13)
```

---

### Step 15 — docs: analysis CLAUDE.md, config-startup pattern, findings, merge order; teardown

**Status**: `pending`
**Service**: `services/xstockstrat-analysis/CLAUDE.md`, `docs/patterns/`, `docs/roadmap/features/`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/patterns/config-startup.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution-findings.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Analysis `CLAUDE.md` § "Shared durable scheduler (feature 158)" `:130-141`, § "P&L pattern consumer (feature 042)"
  `:143-172`, § "Ledger Events Emitted" `:549-559` (no `analysis.pnl.*` row today); fixed-invariant wording precedent
  `:64` ("fixed invariants, not config keys").
- `docs/patterns/config-startup.md:87` says the Python watcher "retries the WatchConfig stream every 2 s on
  `AioRpcError`" — becomes drift after Steps 5/7/9; `:16` and `:149` say "on error" (still true).
- `services/xstockstrat-analysis/docs/context-constitution-findings.md:23` "Boot recompute task is unreferenced"
  (REFUTED, hygiene only) — Step 1 retains every boot task.
- `docs/roadmap/features/merge-order.md` has no 259 entry of its own: `grep -n "259\|loop-supervision"` returns only
  `:83`, inside the 262 (`fix-analysis-owner-scope`) row ("262 also reuses 259's task-retention helper for the
  main.py:174 task"). The 259 entry is still to be added.
- `.agents/context-forge.json` `scrubberExtraTargets`: `README.md`, `docs/patterns/ui-ux-governance.md` (not touched).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Analysis `CLAUDE.md`:
   - § Shared durable scheduler: the four `*_forever` loops seed via `supervision.retry_until_ok` and tick under
     `supervision.run_supervised` (a failed tick or schedule seam logs ERROR and sleeps `_LOOP_ERROR_BACKOFF_SECONDS`
     = 30, a fixed invariant; the schedule is never advanced by the backoff); every boot task is started with
     `supervision.spawn` (retained; an exception exit logs ERROR with the task name). Peers reuse `spawn`.
   - § P&L pattern consumer: the retry (3 attempts, 1.0 s), the `_is_poison` allow-list (and why it is not
     `is_transient_db_error`), the replay counter and its reset rule, the bounded probe at 5 replays, the stream-fail
     escalation, and the log → idempotent emit → advance park order. Fixed invariants: `_EVENT_MAX_ATTEMPTS=3`,
     `_EVENT_RETRY_BACKOFF_SECONDS=1.0`, `_REPLAY_ESCALATE_AFTER=5`, `_PROBE_TIMEOUT_SECONDS=5`,
     `_PARK_EMIT_TIMEOUT_SECONDS=5`. Accepted limitations: probe false park under contention (~25-30 s); an unlisted
     deterministic error parks after ~25-30 s, not ~2 s (keep the list narrow); each attempt's DB waits are bounded by `_ATTEMPT_DB_TIMEOUT_SECONDS=10` (acquire + per-query `timeout=`); a parked `order.created`/`filled`
     opens no window so its later close no-ops, and a parked `position.closed` leaves its window open (reconcile from
     the park payload); the replay and stream-fail counters are in-memory (`instance_count: 1`), so a restart delays
     escalation by K; existing emits now carry `event.correlation_id` as `correlation_id` + `x-trace-id`.
   - § Ledger Events Emitted: add `analysis.pnl.event_parked` — "P&L-pattern consumer parked a ledger event (poison, or
     persistent non-poison with the DB probe up); ownerless, idempotent per sequence (`pnl_park:<seq>`)".
2. `docs/patterns/config-startup.md:87`: "on `AioRpcError`" → "on any exception (feature 259; `CancelledError` still
   propagates)", and mention the retained `_watch_task` whose unexpected exit logs ERROR.
3. `context-constitution-findings.md:23`: append "Addressed by feature 259 — boot tasks are retained via
   `app/supervision.py#spawn`."
4. `merge-order.md`: add the 259 entry (its own row/section; leave the 262 row's `:83` reference to 259 intact) with the peer rebases from § Step Dependencies (248 first on
   `pnl_pattern_consumer.py:147-162`; 244/246/260 rebases; 262 reuses `spawn`; 268 indicators test file; replay
   amplification note vs `fix-ledger-query-pagination`).
5. Teardown (root `CLAUDE.md` § Teardown): run `/context-forge:context-constitution refresh` scoped to the touched
   context files (analysis `CLAUDE.md`, analysis `docs/context-constitution*.md`, `docs/patterns/config-startup.md`)
   and fix grounded drift; if the plugin is unavailable, re-read each touched file against the code by hand and record
   both facts and the reconciliation in the PR body.

**Verification**:
```bash
grep -n "analysis.pnl.event_parked" services/xstockstrat-analysis/CLAUDE.md
grep -n "_PROBE_TIMEOUT_SECONDS\|_LOOP_ERROR_BACKOFF_SECONDS\|supervision" services/xstockstrat-analysis/CLAUDE.md
grep -n "AioRpcError" docs/patterns/config-startup.md   # expect none
grep -n "fix-python-loop-supervision" docs/roadmap/features/merge-order.md   # expect the new 259 entry (the :83 262-row hit does not count)
grep -n "259" services/xstockstrat-analysis/docs/context-constitution-findings.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
