# Implementation Spec: watchlist-readiness-precompute

**Status**: `pending`
**Created**: 2026-09-05
**Feature**: `docs/roadmap/features/180-watchlist-readiness-precompute/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/watchlist-readiness-precompute`

---

## Execution Summary

Implements design.md's **Option B** (dedicated readiness materializer loop) with the mandated
modularization. The order builds the shared, testable units first, then the loop that reuses them:

1. **Steps 1–2** extract the SLOW readiness compute body into one shared unit (`compute_readiness_row`)
   plus two pure helpers (`is_readiness_row_fresh`, `readiness_valid_until`) in a new
   `app/services/readiness.py`, and re-point the interactive `EvaluateReadiness` SLOW body at it —
   guaranteeing byte-identity (design component #1) with **no gate change yet**.
2. **Steps 3–4** make the shared FAST gate `bar_epoch`-aware via `is_readiness_row_fresh` + a
   per-request memoized `latest_bar_epoch` map (design component #2; @AC-2 reconciliation; risk R2/R3).
3. **Steps 5–6** add the `run_readiness_materializer_forever` loop (a servicer method mirroring
   `run_opportunity_refresh_forever`, servicer.py:3780), its owner-scoped binding-aware warm-set
   drain, its own bars-fetch semaphore, the skip-fresh gate, and the `main.py` wiring.
4. **Step 7** declares the three new config keys.

**Consumer surface (C-14):** the product spec names UI `/insights/watchlists` (`WatchlistReadiness.tsx`)
but explicitly requires **no new UI code** — the existing `EvaluateReadiness` read benefits from the
warm cache. This is a decision, not an omission: there is no `xstockstrat-ui` step, per product-spec
§ Consumer Surface(s) and § Out of Scope. The user-observable outcome (fast overlay load) is delivered
by the backend warm cache alone.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| @AC-1 (materialized pair served FAST, no recompute) | Step 2 (interactive byte-identity FAST hit), Step 6 (materialized row → FAST hit) |
| @AC-2 (materialized set derived from watchlist bindings, owner-scoped) | Step 6 (owner-scoped derivation from bindings) |
| @AC-3 (stale fingerprint recomputed) | Step 6 |
| @AC-4 (cycle stays within resource envelope; own semaphore) | Step 6 |
| @AC-5 (uncovered pair → SLOW fallback, never blank; writes row) | Step 4 |
| @AC-6 (non-live binding not materialized; cycle not halted) | Step 6 |
| @AC-7 (busted by a new daily bar, not intraday drift) | Step 4 (interactive `bar_epoch` semantic), Step 6 (materialized) |

## Step Dependencies

- **Step 2** [test] covers **Step 1** [service]; **Step 4** [test] covers **Step 3** [service];
  **Step 6** [test] covers **Step 5** [service].
- Step 3 requires Step 1: the FAST-gate refactor calls `is_readiness_row_fresh` created in Step 1.
- Step 5 requires Steps 1 and 3: the loop reuses `compute_readiness_row`, `is_readiness_row_fresh`,
  `readiness_valid_until`, and the `latest_bar_epoch` memo helper.
- Step 7 (config declaration) has no code dependency but its keys are **read** in Step 5; declare
  before or with Step 5 so the reviewer sees the key contract alongside its first read site.
- **Merge order (design R4):** 180 depends on features **176** (concurrency offload — the restructured
  `EvaluateReadiness`/`_bars_fetch_sem`) and **177** (readiness cache + migration 022, the FAST gate
  this feature refactors). Both are `code-completed`, not `launched`. Sequence **176 → 177 → 180**
  (row already present in `docs/roadmap/features/merge-order.md`, lines 227–246). This spec is written
  against the post-176/177 tree currently on disk.

### Open design points surfaced at /sdd-spec (P-03 — do not silently resolve at execute)

- **D-1 — `_drain_watchlist` does NOT yield bindings (corrects design.md § Warm-set sourcing).**
  design.md says to "reuse the live loop's existing owner-scoped watchlist drain (`_drain_watchlist`,
  live_loop.py:483) to obtain each owner's `(strategy_id → {symbols})` bindings." **This is not what
  that method returns.** `_drain_watchlist(owner)` (`live_loop.py:467-496`) collapses every binding to
  its bare symbol (`out.update(_normalize_symbol(b.symbol) for b in wl.bindings)`, live_loop.py:490) —
  it **discards `binding.strategy_id`**, because the live loop applies each live strategy's own
  `resolve_universe` to the whole watchlist symbol set. The materializer's target read-set is the
  overlay's read-set = the actual `(symbol, strategy_id)` bindings where `strategy_id` is set
  (`WatchlistReadiness.tsx:183` `bound = bindings.filter(b => b.strategyId)`, recon). Step 5 therefore
  adds a **new** binding-aware drain (`_drain_watchlist_bindings`) rather than reusing `_drain_watchlist`.
  Record this correction in the `## Deviation Log` at execute.
- **D-2 — loop cadence mechanism. RESOLVED (operator, 2026-09-05): dedicated decoupled key.**
  design.md component #3 said "DurableSchedule interval mode," but interval mode needs an interval
  value; FR-7 (readiness changes at daily bar close) makes a **wall-clock daily re-warm shortly after
  close** the right shape, mirroring `run_opportunity_refresh_forever` (servicer.py:3780-3804). The
  choice between reusing `analysis.opportunity.refresh_hour_utc` vs. a dedicated key was put to the
  operator, who chose the **dedicated key `analysis.readiness_materializer.refresh_hour_utc`** — the
  two daily loops are decoupled so tuning the opportunity refresh hour never silently moves the
  readiness re-warm (fault-tolerant / independently operable). Step 5 uses this key; Step 7 declares
  it (four keys total). This reopens FR-3's "cadence is not a new config axis" wording — reconciled in
  product-spec (the materializer adds one cadence anchor key, `refresh_hour_utc`, plus the
  `valid_window_hours` backstop). FR-1 remains rescoped to eventually-consistent (design R1): openers
  before the first daily warm fall to the Step 4 SLOW fallback.
- **D-3 — R2 FAST-gate `latest_bar_epoch` cost.** The `bar_epoch`-aware gate (Step 3) needs each
  symbol's latest 1d-bar epoch on every FAST read. The grounded cheap source is
  `MarketDataService.GetDataCoverage(symbol, timeframe=1d).latest` (a `MAX(time)` metadata read,
  `marketdata.proto:32,149-158`), **not** a 400-day `GetBars` pull. It is memoized per request/cycle
  and filled **before** the per-symbol loop (C-08 — insights.md:220). This trades a per-symbol coverage
  read for eliminating the 400-day pull + indicator compute + rule scoring — still a large win, but it
  is a per-symbol RPC on every overlay poll; flag for /sdd-review impl-spec sign-off. Benchmark note:
  the gate compares against the **evaluated symbol's** latest bar only; a materialized row stamped
  `bar_epoch = max(symbol, benchmark)` (servicer.py:2807) is therefore always `>= symbol_latest` and
  never falsely stale. The only untracked edge (benchmark prints a new bar while the symbol does not)
  self-heals at the symbol's next daily bar — acceptable on this 1d-bar platform (FR-7).

---

### Step 1 — service: Extract shared readiness compute + freshness helpers (`app/services/readiness.py`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/readiness.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias; readiness byte-identity

**Codebase Evidence**:
- SLOW body to extract: `servicer.py:2786-2818` — `async with self._bars_fetch_sem:` → `bars = await self._fetch_bars_paged(symbol, range_msg, propagation_meta)` (:2789) → empty-bars WARN (:2794-2801) → `trace = await evaluator.evaluate_conditions_traced(definition, bars, symbol, rule=rule, benchmark_bars=benchmark_bars)` (:2802) → `bar_epoch = max(bars[-1].time.seconds if bars else 0, _benchmark_epoch())` (:2807) → `staged = {...}` (:2808-2818).
- The FAST-gate inline predicate (NOT changed in this step, changed in Step 3): `servicer.py:2780` `if c is not None and c["def_fingerprint"] == fingerprint and now < c["valid_until"]:`.
- Per-request inputs the extracted unit needs are already assembled in the handler: `evaluator` (`servicer.py:2745`), `definition` (:2740), `range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)` (:2748, `_READINESS_LOOKBACK_DAYS = 400` at :249), `benchmark_bars` (:2750 via `self._load_benchmark_bars_windowed`), `rule` (:2743), `fingerprint = _definition_fingerprint(row["definition_json"])` (:2758), `now` (:2756), `stale_after` (:2757), `caller_user_id` (:2728).
- Bars fetch helper: `servicer.py:1037` `async def _fetch_bars_paged(self, symbol, range_msg, propagation_meta)`.
- Semaphore the interactive path passes: `self._bars_fetch_sem` (`servicer.py:395-397`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `services/xstockstrat-analysis/app/services/readiness.py` with three units (design components #1, #2, #4):
   - `def is_readiness_row_fresh(row, *, now, fingerprint, latest_bar_epoch) -> bool` — pure. Returns
     `row["def_fingerprint"] == fingerprint and now < row["valid_until"] and row["bar_epoch"] >= latest_bar_epoch`.
     This is the single freshness semantic for both the interactive FAST gate and the materializer
     skip-fresh gate (design § component #2 — "no two-policies-per-table trap").
   - `def readiness_valid_until(now, *, valid_window_hours) -> datetime` — pure. Returns
     `now + timedelta(hours=max(1, valid_window_hours))`. The design (§ component #4) keeps @AC-2
     correctness on the `bar_epoch` predicate, not on TTL precision, so a plain window suffices.
   - `async def compute_readiness_row(symbol, *, fetch_bars, bars_sem, evaluator, definition, range_msg, propagation_meta, benchmark_bars, rule, fingerprint, user_id, now, valid_until, benchmark_epoch) -> dict`
     — the shared SLOW body. Move the current `servicer.py:2786-2818` block here verbatim in behavior:
     acquire `bars_sem`, `bars = await fetch_bars(symbol, range_msg, propagation_meta)` (best-effort
     try/except → `[]` + WARN, preserving the two WARN log lines), `trace = await
     evaluator.evaluate_conditions_traced(definition, bars, symbol, rule=rule, benchmark_bars=benchmark_bars)`,
     `bar_epoch = max(bars[-1].time.seconds if bars else 0, benchmark_epoch)`, return the same staged
     dict shape (`user_id, strategy_id`—see note, `rule, symbol, def_fingerprint, bar_epoch,
     readiness_json=trace, computed_at=now, valid_until`). Pass `strategy_id` in as a param too (the
     handler has `request.strategy_id`; the materializer has the binding's strategy). Keep `benchmark_epoch`
     as a passed-in int (the handler's `_benchmark_epoch()` closure, servicer.py:2767-2773, becomes a
     value computed once and passed in) so the unit stays pure of the handler's closures.
   - Do **not** move `_readiness_to_proto` / `_symbol_readiness_from_json` — proto conversion stays in
     the interactive handler.
2. In `servicer.py`, refactor `_readiness_for` (the SLOW branch, :2786-2819) to call
   `compute_readiness_row(...)`, passing `fetch_bars=self._fetch_bars_paged`, `bars_sem=self._bars_fetch_sem`,
   and the already-assembled per-request values. The FAST branch (:2779-2785) is **unchanged in this
   step**. The returned `staged` dict feeds the existing `upsert_many` path (:2826) unchanged, and the
   handler wraps `staged["readiness_json"]` back into a proto via the existing `_readiness_to_proto`.
3. This step is a **pure refactor** — verdicts, `bar_epoch`, fingerprint, and row shape must be
   byte-identical to before (design § component #1; the DRY guard rail — one compute path, not two).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
# Behavior parity proven by the paired Step 2 test:
cd services/xstockstrat-analysis && uv run pytest tests/test_readiness_cache.py -q
```

---

### Step 2 — test: Byte-identity parity + pure freshness/valid-until units

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Existing readiness test scaffolding to reuse (C-13 canonical single-consumer home): `tests/test_readiness_cache.py:16-21` imports `_real_bars`, `_simple_strategy_row`, `_benchmark_strategy_row` from `tests/test_readiness_opportunities_source_symbol.py`, and `make_servicer`, `_EOF_PAGE`, `_HEADERS`, `_ctx` from `tests/test_analysis_servicer.py`.
- Coverage config: `services/xstockstrat-analysis` threshold 40% (`pytest --cov=app --cov-fail-under=40`), spec-template coverage table.

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. Create `tests/test_readiness.py`. Import `compute_readiness_row`, `is_readiness_row_fresh`,
   `readiness_valid_until` from `app.services.readiness`. Reuse existing fixtures per C-13 (import,
   never re-declare, `_real_bars`/`_simple_strategy_row` — one existing consumer today, so keep them
   in their current home; add no new fixture module).
2. **Pure `is_readiness_row_fresh`** — table-drive: fresh when fingerprint matches AND `now <
   valid_until` AND `bar_epoch >= latest_bar_epoch`; stale on each of the three negations
   independently (fingerprint mismatch, expired window, `bar_epoch < latest_bar_epoch`).
3. **Pure `readiness_valid_until`** — asserts `now + valid_window_hours` and the `max(1, …)` floor.
4. **Byte-identity (AC-1)** — call `EvaluateReadiness` (SLOW, empty cache) once; capture the upserted
   staged rows and the response verdicts. Assert the row shape/fields and verdicts are unchanged from
   the pre-refactor golden (reuse `test_readiness_cache.py`'s `_verdicts` shape). The existing
   `tests/test_readiness_cache.py` suite (177 @AC-1/@AC-2) must also still pass unchanged — run it.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && uv run pytest tests/test_readiness.py tests/test_readiness_cache.py -q \
  && uv run pytest --cov=app --cov-fail-under=40
```
Written to fail before Step 1 (module `app.services.readiness` does not yet exist → ImportError).

---

### Step 3 — service: Make the FAST gate `bar_epoch`-aware (memoized `latest_bar_epoch`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias; **@AC-2 regression guard for feature 177 (design R3)**

**Codebase Evidence**:
- FAST-gate inline predicate to replace: `servicer.py:2780` `if c is not None and c["def_fingerprint"] == fingerprint and now < c["valid_until"]:`.
- `gather` over `_readiness_for`: `servicer.py:2821` `results = await asyncio.gather(*[_readiness_for(s) for s in request.symbols])` — the memo must be filled **before** this (C-08; insights.md:220 the "read-at-top, write-at-bottom" trap).
- Cheap latest-bar source: `MarketDataService.GetDataCoverage` (`packages/proto/marketdata/v1/marketdata.proto:32`), `GetDataCoverageResponse.latest` timestamp (`marketdata.proto:149-158`); request carries `symbol` + `timeframe` (`marketdata.proto:135-140`). Analysis already holds `self._marketdata` and propagates the C-03 header tuple (`servicer.py:2719-2723` builds `propagation_meta`).
- 177 @AC-2 test busts via expired `valid_until`, not `bar_epoch` (`tests/test_readiness_cache.py:82-105` sets `valid_until=past`), so the added `bar_epoch` conjunct keeps it green — but that test's `_cache_svc` mocks only `GetBars`; the FAST path will now call `GetDataCoverage`, which Step 4 must mock.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a per-request `latest_bar_epoch` memo, filled once **before** the `asyncio.gather` at
   `servicer.py:2821` (C-08): for each distinct symbol in `request.symbols`, call
   `self._marketdata.GetDataCoverage(GetDataCoverageRequest(symbol=symbol, timeframe=<1d>), metadata=propagation_meta)`
   and store `latest_bar_epoch[symbol] = resp.latest.seconds` (0 on RPC error / no coverage —
   best-effort, mirroring the existing per-symbol best-effort bars fetch at :2790). Use the `1d`
   timeframe enum consistent with the readiness bars (confirm the enum member via
   `packages/proto/common/v1/common.proto` `Timeframe`). Consider batching but per-symbol is fine at
   overlay scale.
   - **Cost bound (review D-3):** `GetDataCoverage` runs `SELECT MIN(time), MAX(time), COUNT(*)` over
     the symbol's full history (`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:213`),
     yet this memo runs on **every** FAST read and needs only `.latest`. To keep this per-symbol-per-read
     lookup cheap, pass a **narrow recent time range** on `GetDataCoverageRequest` if the message exposes
     one (confirm the field at execute) so the server bounds its scan; consume only `resp.latest`. If no
     range field exists, keep the call (still far cheaper than the 400-day pull + indicator/rule fan-out
     it replaces) but record the full-history-scan cost as a follow-up for the marketdata owner rather
     than leaving it unstated (P-03).
2. Replace the inline FAST-gate predicate at `servicer.py:2780` with
   `is_readiness_row_fresh(c, now=now, fingerprint=fingerprint, latest_bar_epoch=latest_bar_epoch.get(symbol, 0))`
   (from `app.services.readiness`, Step 1). On `True`, serve FAST exactly as today (:2781-2785); on
   `False`, fall to the SLOW `compute_readiness_row` path. This is the design § @AC-2 reconciliation:
   one freshness semantic across lazy and materialized rows.
3. Preserve FR-5/@AC-5: a miss (no row, mismatch, expired, or stale-by-epoch) still computes
   synchronously and writes the row — the overlay is never blank.
4. Keep the `computed_at = min(served)` behavior (:2831-2835) unchanged.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
# Behavior proven by the paired Step 4 test.
```

---

### Step 4 — test: interactive `bar_epoch` gate — @AC-1 / @AC-5 / @AC-7

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness.py` — modify
- `services/xstockstrat-analysis/tests/test_readiness_cache.py` — modify (add `GetDataCoverage` mock to `_cache_svc`)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_cache_svc` mock builder to extend: `tests/test_readiness_cache.py:28-48` (mocks `svc._marketdata.GetBars` only; must also mock `svc._marketdata.GetDataCoverage`).
- 177 scenarios that must stay green: `tests/test_readiness_cache.py:63-90` (@AC-1 FAST), `:82-105` (@AC-2 expiry), `:112-127` (benchmark bar_epoch).
- Acceptance source: `docs/roadmap/features/180-watchlist-readiness-precompute/acceptance.feature` @AC-1, @AC-5, @AC-7. (Owner-scoped derivation @AC-2 is a materializer behavior — covered in Step 6, not here.)

**TDD**: `red-green required`

**Covers**: `AC-1, AC-5, AC-7`

**Instructions**:
1. Add a `GetDataCoverage` AsyncMock to `_cache_svc` (returns `latest.seconds` = the symbol's newest
   mocked bar epoch by default) so the FAST-gate memo resolves. Verify the three existing 177 tests
   still pass with this addition (R3).
2. **@AC-1 (FAST hit within window, current epoch):** a fresh, fingerprint-matching row whose
   `bar_epoch == latest_bar_epoch` serves FAST — assert `GetBars.await_count == 0` after warm-up (a
   `GetDataCoverage` call is allowed; assert no `GetBars`).
3. **@AC-7 (new daily bar busts, intraday does not):** with a cached row at `bar_epoch = E`
   and `valid_until` in the future, when `GetDataCoverage.latest.seconds == E` (same trading day, no
   new bar) → FAST (no `GetBars`); when it advances to `E+1` (new daily bar) → `is_readiness_row_fresh`
   returns `False` → SLOW recompute (`GetBars` called), verdict reflects the new bar. This asserts the
   FR-7 semantic: bust on daily-bar epoch advance, not on `valid_until` alone.
4. **@AC-5 (uncovered pair → SLOW fallback, writes row):** empty cache → SLOW compute returns a
   verdict and `upsert_many` is called with the pair's row.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && uv run pytest tests/test_readiness.py tests/test_readiness_cache.py -q \
  && uv run pytest --cov=app --cov-fail-under=40
```
Written to fail before Step 3 (the epoch-advance case serves FAST instead of recomputing).

---

### Step 5 — service: Readiness materializer loop + owner-scoped binding drain + wiring

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`__init__` semaphore + `run_readiness_materializer_forever` + `_drain_watchlist_bindings` + `_readiness_materializer_tick`)
- `services/xstockstrat-analysis/app/main.py` — modify (start the loop via `create_task`)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias; **owner-scoping/IDOR guard (fails.md:1153)**

**Codebase Evidence**:
- Loop template to mirror: `servicer.py:3780` `run_opportunity_refresh_forever` + `servicer.py:3777,3793-3804` (DurableSchedule seed → jitter → `while True: await asyncio.sleep(await self._..._tick(schedule))`). `DurableSchedule` lives in `app/engine/durable_schedule.py` (interval + wall-clock modes).
- Own semaphore precedent (design § resource bounding; feature-176 priority-inversion guard): `servicer.py:395-403` — `_bars_fetch_sem` (:395) and `_candidates_sem` (:401) both `asyncio.Semaphore(max(1, self._cfg.get_int(...)))`. Add `self._readiness_materializer_bars_sem` the same way, **separate from** `self._bars_fetch_sem`.
- Live-strategy enumeration: `app/repositories/strategies.py:205` `list_live_enabled(user_id=None)` → all `live_enabled=TRUE AND active=TRUE` rows (each carries `user_id`, `strategy_id`, `definition_json`); predicate `strategies.py:19`.
- **Binding drain correction (D-1):** existing `_drain_watchlist` returns bare symbols only
  (`live_loop.py:467-496`, esp. :490 `_normalize_symbol(b.symbol)` — `strategy_id` discarded). Portfolio
  `ListWatchlists` returns `Watchlist{bindings:[WatchlistBinding{symbol, strategy_id, source}]}`
  (portfolio.proto:220-246, recon). Model the new drain on `live_loop._drain_watchlist`'s paging shape
  (`ListWatchlistsRequest` page loop, metadata `[("x-user-id", owner)]`, `live_loop.py:475-495`) but
  **keep `binding.strategy_id`**, returning `list[(strategy_id, symbol)]` for bindings where
  `strategy_id` is non-empty.
- Shared compute + freshness + valid_until: `app/services/readiness.py` (Steps 1, 3).
- Cache repo: `app/repositories/readiness_cache.py:25` `read_many(user_id, strategy_id, rule, symbols)`, `:44` `upsert_many(rows)`.
- `latest_bar_epoch` source: `GetDataCoverage` (Step 3 helper — factor it so the loop reuses it per cycle).
- Config-read patterns: `get_bool` (`live_loop.py:265`), `get_int_present`/`get_int` with `max(1,…)` clamp (`servicer.py:391,396`); model the wall-clock anchor read on `analysis.opportunity.refresh_hour_utc` presence-aware handling (`servicer.py:3797` via `self._opportunity_refresh_hour`) but read the **dedicated** `analysis.readiness_materializer.refresh_hour_utc` (D-2). Jitter/retry may reuse the opportunity knobs `analysis.opportunity.startup_jitter_seconds` (:3801) / `analysis.opportunity.retry_seconds` (:3762) (bounded, non-cadence operational knobs — not the daily anchor), or read materializer-scoped values; confirm at execute.
- Background-task wiring precedent: `main.py:175` `asyncio.get_event_loop().create_task(servicer.run_opportunity_refresh_forever())` inside the `if db_pool is not None:` block.
- C-03 background header synthesis: `servicer.py:3766-3768` `meta = [("x-user-id", uid)]` per owner.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`__init__`** — add `self._readiness_materializer_bars_sem = asyncio.Semaphore(max(1, self._cfg.get_int("analysis.readiness_materializer.max_concurrent_bars_fetches", 2)))`, distinct from `self._bars_fetch_sem` (@AC-4; feature-176 priority-inversion guard — the background pre-warm can never starve interactive readiness).
2. **`_drain_watchlist_bindings(owner) -> list[tuple[str, str]]`** — the binding-aware drain (D-1). Page `ListWatchlists` metadata `[("x-user-id", owner)]`; for each `wl.bindings` entry with a non-empty `strategy_id`, yield `(strategy_id, _normalize_symbol(symbol))`. Best-effort (an RPC failure returns what was drained so far, mirroring `_drain_watchlist`). Ignore legacy flat `wl.symbols` (they carry no strategy — not part of the overlay read-set).
3. **`run_readiness_materializer_forever`** (orchestration only — design § component #3):
   - Early-return if `self._readiness_cache_repo is None or self._strategies_repo is None or self._db_pool is None`.
   - DurableSchedule wall-clock mode with a **distinct `job_name="readiness_materializer"`** (NOT
     `"opportunity"` — `analysis.job_schedule` is keyed `(job_name, user_id)` per migration 020, so
     reusing the opportunity job name would collide on that PK). Anchored to the **dedicated** key
     `analysis.readiness_materializer.refresh_hour_utc` (D-2 decision — decoupled from the opportunity
     loop's anchor), read presence-aware like `self._opportunity_refresh_hour` (`servicer.py:3797`).
     Seed → one-shot bounded startup
     jitter → `while True: await asyncio.sleep(await self._readiness_materializer_tick(schedule))`.
   - **`_readiness_materializer_tick`**: (a) check `self._cfg.get_bool("analysis.readiness_materializer.enabled", False)` — if disabled, advance the schedule and return (kill-switch, default OFF). (b) `live_rows = await self._strategies_repo.list_live_enabled()`; group into `owner -> {strategy_id: definition_row}`. (c) For each owner: `bindings = await self._drain_watchlist_bindings(owner)`; keep `(strategy_id, symbol)` where `strategy_id` is in that owner's live set (**@AC-6**: a binding to a non-live/other strategy is skipped, never fabricated — P-03; do not raise). (d) Build the warm-set of `(owner, strategy_id, symbol, definition)` with `rule="entry"`. (e) **Skip-fresh gate** (fails.md:118): per `(owner, strategy_id)` batch, `read_many(owner, strategy_id, "entry", symbols)` and fill a per-cycle `latest_bar_epoch` memo (via the Step-3 `GetDataCoverage` helper, **before** the per-pair compute — C-08); skip any pair where `is_readiness_row_fresh(row, now=now, fingerprint=_definition_fingerprint(definition_row["definition_json"]), latest_bar_epoch=…)`. (f) For each surviving pair, `compute_readiness_row(...)` with `bars_sem=self._readiness_materializer_bars_sem`, `valid_until=readiness_valid_until(now, valid_window_hours=self._cfg.get_int_present("analysis.readiness_materializer.valid_window_hours", 24))`, benchmark bars via `self._load_benchmark_bars_windowed`, meta `[("x-user-id", owner)]`. (g) `upsert_many(staged_rows)` per owner/strategy batch (best-effort try/except → log.warning; one bad pair or owner never halts the cycle — @AC-6). (h) `await asyncio.sleep(0)` cooperative pacing between owners (mirror servicer.py:3775). Advance the schedule to the next wall-clock hour on success; on a caught enumeration error advance by `analysis.opportunity.retry_seconds`.
4. **`main.py`** — inside the existing `if db_pool is not None:` block (near :175), add `asyncio.get_event_loop().create_task(servicer.run_readiness_materializer_forever())` + a `log.info`. The loop self-gates on `.enabled` (default OFF), so unconditional `create_task` is safe (mirrors `fundsignal_loop`).
5. Shared `asyncpg` pool only (F-06) — no new pool.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
# Behavior proven by the paired Step 6 test.
```

---

### Step 6 — test: materializer — @AC-1 / @AC-2 / @AC-3 / @AC-4 / @AC-6

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness_materializer.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Loop-test precedent: `tests/test_opportunity_refresh.py` (tests `run_opportunity_refresh_forever`/`_opportunity_refresh_tick`) and `tests/test_durable_schedule.py`.
- Servicer builder + headers: `tests/test_analysis_servicer.py` (`make_servicer`, `_EOF_PAGE`, `_HEADERS`, `_ctx`), reused across `tests/test_readiness_cache.py:16-20`.
- Fixtures (C-13): reuse `_real_bars`, `_simple_strategy_row` from `tests/test_readiness_opportunities_source_symbol.py` (one existing consumer — keep inline home; add none).
- Acceptance source: `.../180-watchlist-readiness-precompute/acceptance.feature` @AC-1..@AC-6.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6`

**Instructions**:
1. Drive `_readiness_materializer_tick` directly (unit-level, like `test_opportunity_refresh.py`),
   mocking `list_live_enabled`, `ListWatchlists`, `GetBars`, `GetDataCoverage`, `ComputeIndicator`,
   and the cache repo (`read_many`/`upsert_many`). Force `analysis.readiness_materializer.enabled=True`.
2. **@AC-2 owner-scoping** (acceptance @AC-2 = derived-from-bindings, owner-scoped): U1 binds
   `("MSFT","STR-1")`, U2 binds `("NVDA","STR-2")`; both strategies live per owner. Assert `upsert_many`
   is called with a MSFT row keyed `user_id=U1` and an NVDA row keyed `user_id=U2`, and that no row is
   ever written under a user for a binding they do not own (`ListWatchlists` was called with each
   owner's own `x-user-id`; a strategy_id not in that owner's live set is skipped, not fabricated —
   P-03 / fails.md:1153).
3. **@AC-1 materialized → FAST** (behavioral link): after the tick upserts `("AAPL","STR-1")`, feed
   that row back as the cache and call `EvaluateReadiness` for the pair with `GetDataCoverage.latest`
   equal to the row's `bar_epoch` → FAST (no `GetBars`).
4. **@AC-3 stale fingerprint recomputed:** an existing row with `def_fingerprint="fp-old"` while the
   strategy's current fingerprint is `fp-new` → the skip-fresh gate does **not** skip it → recompute
   → `upsert_many` writes the row with `fp-new`.
5. **@AC-4 resource envelope:** assert the loop's bars fetches go through
   `self._readiness_materializer_bars_sem` and **not** `self._bars_fetch_sem` (e.g. patch/inspect the
   two semaphores and assert only the materializer sem is entered), covering the separate-semaphore
   requirement; and that an on-demand `EvaluateReadiness` issued concurrently is unaffected (its own
   sem). No new DB pool is created (F-06).
6. **@AC-6 non-live binding skipped + cycle not halted:** owner binds `("AMD","STR-4")` but STR-4 is
   not in `list_live_enabled()` → no AMD/STR-4 row upserted, and the tick completes without raising
   (assert it returns normally and any other live binding in the same cycle is still materialized).
7. **Skip-fresh steady state (fails.md:118):** all rows already fresh under the predicate → zero
   `compute_readiness_row`/`GetBars` calls, only cheap reads.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && uv run pytest tests/test_readiness_materializer.py -q \
  && uv run pytest --cov=app --cov-fail-under=40
```
`main.py` wiring is in a coverage-excluded startup module — the loop behavior above is the required
coverage; the wiring is verified by lint + the tick tests (no separate `main.py` test).
Written to fail before Step 5 (`_readiness_materializer_tick` does not yet exist).

---

### Step 7 — config: Declare the four `analysis.readiness_materializer.*` keys

**Status**: `pending`
**Service**: `xstockstrat-analysis` / `xstockstrat-config`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (append to the `## Config Keys Consumed` table)
- `docs/patterns/config-governance.md` — modify (append a Per-Feature Registered Keys entry)

**Reviewers**: `xstockstrat-analysis` (service owner) — config key naming, defaults declared in service CLAUDE.md; `xstockstrat-config` (service owner) — config key naming (`<service>.<category>.<key>`), env × global/per-user scoping

**Codebase Evidence**:
- Config Keys Consumed table (append target): `services/xstockstrat-analysis/CLAUDE.md` § "Config Keys Consumed" (namespace `analysis`); the `analysis.opportunity.*` **no-seed** precedent is documented there for features 131/141/176.
- Registered-keys log format: `docs/patterns/config-governance.md:101` `## Per-Feature Registered Keys` (newest-first; one entry per feature). Feature 177 / 176 entries (`:105-`) are the template — a per-key table with Key/Type/Default/Description.
- No-seed pattern (no config migration): design.md § Config keys ("no seed migration"); mirrors `analysis.opportunity.max_concurrent_candidates` / `analysis.compute.max_worker_threads` (feature 176 entry).

**TDD**: `N/A (docs/config declaration — keys are read at their Step 5 call sites)`

**Covers**: —

**Instructions**:
1. Append four rows to `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed:
   - `analysis.readiness_materializer.enabled` | bool | `false` | Master kill-switch for the readiness materializer loop (feature 180). Read via `get_bool` (HasField — an explicit operator value is honored). Default OFF. No-seed.
   - `analysis.readiness_materializer.refresh_hour_utc` | int | `<same post-close hour as `analysis.opportunity.refresh_hour_utc`'s default>` | Wall-clock UTC hour for the daily readiness re-warm (feature 180, D-2). **Dedicated** and decoupled from `analysis.opportunity.refresh_hour_utc` so tuning the opportunity refresh never moves the readiness re-warm. Read presence-aware (mirror `self._opportunity_refresh_hour`). No-seed.
   - `analysis.readiness_materializer.valid_window_hours` | int | `24` | Backstop TTL for a materialized row's `valid_until` (feature 180); the **authoritative** freshness bust is the `bar_epoch`-aware FAST gate (`is_readiness_row_fresh`). Read via `get_int_present`. No-seed.
   - `analysis.readiness_materializer.max_concurrent_bars_fetches` | int | `2` | The loop's **own** bars-fetch semaphore (feature 180), separate from `analysis.opportunity.max_concurrent_bars_fetches` so a background pre-warm never starves interactive readiness (feature-176 priority-inversion guard). Read once at `__init__` via `get_int` with a `max(1, …)` clamp. No-seed.
2. Append a `### feature 180 — watchlist-readiness-precompute (xstockstrat-analysis)` entry (newest
   first) to `docs/patterns/config-governance.md` § Per-Feature Registered Keys, with the same
   four-key table and a one-line note: all four **no-seed** (the `analysis.*` no-seed pattern), no
   config migration, no `SCALAR_BOUNDS_REGISTRY` entry (unlike feature 177's `stale_after_seconds`);
   the daily cadence anchor is the **dedicated** `analysis.readiness_materializer.refresh_hour_utc`
   (decoupled from the opportunity loop — D-2), not a reuse.
3. Do not add a config seed migration; do not reuse `analysis.readiness.stale_after_seconds` (owned by
   feature 177's lazy path — product-spec § Config Key Changes).

**Verification**:
```bash
grep -n "analysis.readiness_materializer" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
# Confirm all three keys appear in both files with matching type/default; no new *.up.sql added:
ls services/xstockstrat-config/migrations/ | tail -3   # confirm no new config seed migration
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
