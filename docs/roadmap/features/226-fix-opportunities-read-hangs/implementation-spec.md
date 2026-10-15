# Implementation Spec: fix-opportunities-read-hangs

**Status**: `pending`
**Created**: 2026-10-14
**Feature**: `docs/roadmap/features/226-fix-opportunities-read-hangs/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fix-opportunities-read-hangs`

> **Evidence baseline.** Every `path:line` below is cited against **`origin/main-dev` @ `08d63011`**,
> not the feature branch tip (`1cf8bf1c`). The feature branch is one commit behind `main-dev`. That
> commit is feature 215, which rewrote much of `services/xstockstrat-analysis/app/handlers/servicer.py`
> (+647 lines), `app/repositories/opportunities.py`, `tests/conftest.py`,
> `tests/test_analysis_servicer.py`, `app/main.py`, agent `app/client.py` / `app/tools.py`, and marketdata
> `marketdata_service.go` / `marketdata_service_test.go`. design.md's line numbers predate it, so the
> handler (`ListOpportunities`) has moved from `:4178` to `:4491`. `/sdd-execute`'s BRANCH SYNC
> (`git merge -X ours origin/main-dev`) brings the feature branch onto this baseline before Step 1.
> Re-grep a symbol if `main-dev` moves again before execution.

---

## Execution Summary

Follow design.md § Chosen Approach: each hop on the opportunities read gets its own bound, and every
bound fits inside the bound of the hop that calls it. The order runs inside-out:
1. **config bounds** (Steps 1–2). Every new key is write-bounded before anything reads it.
2. **marketdata** (Steps 3–4). A detached budget for the shared singleflight closure, plus logs for every
   error that is discarded today.
3. **analysis `read_budget.py`** (Steps 5–6). The request-scoped DB budget primitive (D1/D4), unit-proven
   on its own.
4. **analysis handler** (Steps 7–8). The DB phase moves under the budget, kicks fire after release, and
   the enrichment gets its deadline.
5. **real Postgres proof** (Steps 9–10, D3). A test-scoped `local_pg` fixture and the AC-4 / G2 / F2 / G6
   real-driver tests.
6. **agent** (Steps 11–12). The consumer surface: a deadline and an explicit error message.
7. **docs and teardown** (Step 13).

Every `service` step is paired with the `test` step that follows it (C-08). The executor proves the test
RED before writing the service code (P-06, `.claude/skills/sdd-execute/reference/tdd-gate.md`).
Stall-injection tests carry the hang guards from design §6, so a RED run fails instead of hanging.

**Worst case** (design §5): the analysis DB phase takes at most B+3.05s. Analysis in total takes at most
B+3.05+E: about 26.05s at the defaults and about 27.05s at the bound ceilings. Both are under the BFF's
30s (`@AC-1 @feature-191`, preserved). The agent's floor is 30s, so it never pre-empts analysis. The agent
end to end takes at most 3+55 = 58s, under the MCP client's 60s.

**Consumer surface (C-14).** The product spec has no `## Consumer Surface(s)` section. design.md names two
surfaces:
- The agent `list_opportunities` tool. It is reached in Step 11.
- The UI BFF. It already enforces a 30s deadline (`services/xstockstrat-ui/acceptance/opportunities-latency-fix.feature:5-9`)
  and needs no code change. The analysis bound keeps it working: a stalled enrichment returns unenriched
  rows instead of the BFF's `DEADLINE_EXCEEDED`.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` A stalled price enrichment returns the stored rows unenriched within the deadline | Step 8 |
| `@AC-2` A hung analysis read fails fast at the agent instead of hanging | Step 12 |
| `@AC-3` marketdata logs the vendor error it falls back from | Step 4 |
| `@AC-4` An exhausted analysis DB pool fails the read fast | Step 10 (unit precursor: Step 6, G1 acquire-timeout routing) |

The design-level checks (G1–G10, F2, H4–H6, O8) map to steps as design §6 and its § Suggested /sdd-spec step
breakdown assign them. Each step's **Instructions** name them.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 4 covers Step 3. Step 6 covers Step 5. Step 8 covers Step 7.
  Step 10 covers Steps 5, 7 and 9. Step 12 covers Step 11. (C-08 pairing.)
- Steps 3–12 require Step 1, because every new key must be write-bounded before a reader exists. This keeps
  `B+3.05+E < 30` and the agent's `[30,55]` floor valid against operator writes (design §5).
- Step 7 requires Step 5, because the handler imports `budgeted_read` / `is_transient_db_error`.
- Step 6 requires the shared fakes it adds to `tests/conftest.py`. Step 8 reuses them, so Step 8 requires
  Step 6 (C-13: the second consumer is what forces the conftest home).
- Step 10 requires Step 9 (the `local_pg` fixture and the `real_pg` marker) and Step 7 (the real servicer
  pool path that AC-4 drives).
- Step 11 is independent of Steps 3–10 at the code level. It goes after them because AC-2's bound (agent
  floor 30 > analysis 27.05) is only meaningful once analysis is bounded.
- Step 13 requires Steps 1–12: the docs describe the shipped keys and behavior. Run the context-forge
  teardown last.
- **C-16 promotion.** AC-1..AC-4 are promoted into the durable suites at the integration PR (the
  `/sdd-execute` integration step), not in any step here:
  - AC-1 and AC-4 → `services/xstockstrat-analysis/acceptance/`
  - AC-2 → `services/xstockstrat-agent/acceptance/`
  - AC-3 → `services/xstockstrat-marketdata/acceptance/`
- **Open risks from design.md**, and where each is handled:
  - PgBouncer BEGIN/COMMIT stall → bounded by the B+2 backstop; proven by G5 (Steps 6, 8).
  - G6 orphaned backend → flagged in findings (Step 13).
  - The full-kick dedup window, the COMMIT stall → UNAVAILABLE case, and the UI `retry:1` load → accepted,
    no step.
  - ubuntu-latest PG binaries → the guarded apt step (Step 9).
  - The H5 success-path terminate → tested in Step 8.
  - The trigger is still unconfirmed → confirm on staging after deploy. This is an operator follow-up, not a
    step.

---

### Step 1 — service: Write-bound the four new timeout keys in `SCALAR_BOUNDS_REGISTRY`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` is at `configServiceImpl.ts:100-128`. It is keyed on the FULL config key path, and
  the last entry is `'analysis.opportunity.valid_window_hours': { minValue: 1, maxValue: 168 }` (:127).
- `lookupScalarBounds(namespace, key)` is at `:133-135`. It probes `SCALAR_BOUNDS_REGISTRY[key] ??
  SCALAR_BOUNDS_REGISTRY[\`${namespace}.${key}\`]`, so a full-dotted registry entry resolves for both
  key-column forms (fails.md 2026-09-16 "readiness-materializer-config-keys — config").
- Enforcement is at `:412-424`. It runs `Number(extractValueData(value))` against `[minValue, maxValue]` and
  sits **before** the existence gate (`:426+`), so it also covers `create_key=true` writes. A second
  lookup site is at `:525`.
- grep confirms none of the four keys is registered anywhere in `services/xstockstrat-config/`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Append four entries to `SCALAR_BOUNDS_REGISTRY`, after `'analysis.opportunity.valid_window_hours'` (:127),
   with exactly these full-dotted strings (design §5 table):
   - `'analysis.opportunity.read_db_budget_ms': { minValue: 1000, maxValue: 20000 }`
   - `'analysis.opportunity.live_enrich_timeout_ms': { minValue: 500, maxValue: 4000 }`
   - `'marketdata.price.batch_timeout_ms': { minValue: 500, maxValue: 2500 }`
   - `'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: 55 }`
2. Add a ≤2-line comment above the block stating the constraint: the ceilings keep analysis
   `B+3.05+E < 30s` (the BFF deadline), and the agent floor of 30 sits above analysis's own 27.05s worst case
   (feature 226).
3. Do not seed, and add no migration (operator waiver D2).
4. Do not change `lookupScalarBounds`.

**Verification**:
```bash
grep -n "read_db_budget_ms\|live_enrich_timeout_ms\|batch_timeout_ms\|opportunities.read_timeout_seconds" services/xstockstrat-config/src/grpc/configServiceImpl.ts
cd services/xstockstrat-config && pnpm run lint
```
(Behavioral proof is Step 2.)

---

### Step 2 — test: Bounds tests for the four keys (G8)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- The existing loopback harness is in `setConfigScalarBounds.test.ts:32-78`: a real `grpc.Server` with a
  recording pool. `setConfig(value, key = KEY)` is at `:72-78` and always sends `namespace: NS` (`NS =
  'analysis'`, :29).
- The feature-184 opportunity cases at `:206-243` send keys full-dotted and assert `INVALID_ARGUMENT` plus a
  `/\[min, max\]/` message plus no INSERT (`insertQuery()`, :37-39). In-bounds writes reach the INSERT.

**TDD**: `red-green required`

**Covers**: — (G8, a design check. No `@AC-*` targets the config service.)

**Instructions**:
1. Add a `describe` block (or `it` cases in the existing one) for feature 226. Give `setConfig` an optional
   `namespace` argument that defaults to `NS`, so existing calls stay unchanged.
2. For each of the four keys, assert:
   - min and max are accepted (each reaches `insertQuery()`);
   - min−1 and max+1 are rejected `INVALID_ARGUMENT`, with the `[min, max]` message and no INSERT.

   Send `intVal` for the three `*_ms` keys. Send `floatVal` (and once `intVal`) for the agent key, whose
   value_type is float and which also accepts an int.
3. **Both key-column forms** (design G8):
   - the agent key as ns `agent` + stripped key `opportunities.read_timeout_seconds`, **and** as the
     full-dotted key;
   - the two analysis keys as ns `analysis` + stripped `opportunity.read_db_budget_ms` /
     `opportunity.live_enrich_timeout_ms`, **and** full-dotted;
   - the marketdata key as ns `marketdata` + stripped `price.batch_timeout_ms`.
4. C-13 verdict: the key strings are scenario constants used only by this file (one consumer), so they stay
   inline.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
```
Confirm the c8 `--lines 40` threshold passes and every new case is green. RED before Step 1: the out-of-range
cases are accepted, so the `INVALID_ARGUMENT` assertions fail.

---

### Step 3 — service: marketdata `BatchGetLatestPrice`, a detached budget plus logs for every dropped error

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `BatchGetLatestPrice` is at `marketdata_service.go:730-807` (main-dev; the function starts at :732; singleflight key at :743).
  - The singleflight `s.priceSingleflight.Do(key, func() …)` (:749) runs with the **caller's** `ctx`.
  - `src, sErr := s.registry.Get("")` (:752). `sErr` is dropped silently.
  - `trades, _ = ms.GetLatestTradesMulti(ctx, req.Symbols)` (:756). The error is discarded.
  - The per-symbol fallback loop (:759-768; `lt.GetLatestTrade(ctx, sym)` at :763) discards each `tErr`.
  - `prevClose, _ = s.repo.GetPreviousDailyCloseBatch(ctx, req.Symbols)` (:776). The error is discarded.
  - The closure always returns `nil` error (:781).
- `priceSingleflight singleflight.Group` (:66). The struct `MarketDataService` is at `:34-99`. The
  constructor `NewMarketDataService` is at `:140-185`: it sets `cfg: cfgWatcher` (:170) and `repo: repo`
  (:169).
- Interface-seam precedent: `fundamentalsConfig` (:101-106) with `GetInt(key string, defaultVal int64) int64`.
  `(*config.Watcher).GetInt` is at `internal/config/config.go:156` and has **no nil-receiver guard**.
- Existing tests build the service as a literal with a nil `cfg`: `svc := &MarketDataService{registry: reg,
  warmSymbols: …}` (`marketdata_service_test.go:1398`). So a nil seam must fall back to the default.
- Repo method: `func (r *MarketDataRepo) GetPreviousDailyCloseBatch(ctx, symbols []string) (map[string]float64,
  error)` (`internal/repository/marketdata_repo.go:399`).
- Log-style precedents:
  - `slog.Warn("GetLatestPrice: latest-trade fetch failed", "symbol", symbol, "error", tErr)` (:602);
  - `…prev daily close read failed` (:608);
  - the warm-poller aggregate `slog.Warn("warm poller: per-symbol quote fetch failures", "failed", failed,
    "fetched", fetched, "total", len(symbols), "sample_error", firstErr)` (:899-900).
- Config getter precedent: `s.cfg.GetInt("marketdata.stream.warm_interval_ms", …)` (:835). Keys are read
  full-dotted.
- Go 1.27 (`go.mod:3`), so `context.WithoutCancel` is available.
- grep confirms `context.WithTimeout` is used in no service/handler path today. It does not exist yet.
- Trading-domain constraint check (step-constraints §A): this touches only the Alpaca **market-data** trade
  reads (`source.MultiSymbolSource` / `source.LatestTradeSource`, `internal/source/source.go:25-41`). Broker
  routing, order types, fill state and `TRADING_MODE` are unaffected.

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design §3):
1. Add a narrow seam `type intGetter interface { GetInt(key string, defaultVal int64) int64 }` next to
   `fundamentalsConfig` (:101).
2. Add two struct fields to `MarketDataService`:
   - `budgetCfg intGetter`
   - `prevClose prevCloseReader`, where `type prevCloseReader interface { GetPreviousDailyCloseBatch(ctx
     context.Context, symbols []string) (map[string]float64, error) }`
3. In `NewMarketDataService`, set `budgetCfg` **only when `cfgWatcher != nil`** (avoids the typed-nil
   interface trap), and `prevClose` **only when `repo != nil`**.
4. Add `func resolveBatchPriceBudget(cfg intGetter) time.Duration`: nil, or `GetInt("marketdata.price.batch_timeout_ms",
   2500)` ≤ 0, → `2500 * time.Millisecond`.
5. Inside the singleflight closure, first line:
   ```go
   budget := resolveBatchPriceBudget(s.budgetCfg)
   fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), budget)
   defer cancel()
   ```
   Use `fctx` for **every** fetch inside the closure. The closure is detached, so coalesced waiters no
   longer die with the first caller (design §3).
6. Start prevClose **concurrently** with the trade fetch: if `s.prevClose != nil`, run it in a goroutine
   that writes into a closure-local result and closes a `done` channel. Join on `<-done` after the trades
   resolve, **only when the goroutine was started** (`s.prevClose != nil`; otherwise `done` is never closed and
   the join blocks). This keeps `-race` safe (G10). On error, log `slog.Warn("BatchGetLatestPrice: previous-close
   lookup failed", "symbols", len(req.Symbols), "error", err)`.
7. Trade path:
   - `registry.Get("")` error → `slog.Warn("BatchGetLatestPrice: source lookup failed", "symbols", n,
     "error", sErr)`.
   - Multi-fetch error → `slog.Warn("BatchGetLatestPrice: multi-symbol fetch failed; falling back to per-symbol",
     "symbols", n, "error", err)`.
   - If `fctx.Err() != nil` after the multi-fetch → `slog.Warn("BatchGetLatestPrice: budget exhausted by
     multi-symbol fetch; per-symbol fallback skipped", "symbols", n, "budget_ms", budget.Milliseconds())`,
     and skip the fallback.
8. Per-symbol fallback: keep it sequential over `fctx` and `break` once `fctx.Err() != nil`. Count
   `failed`, `fetched` and `skipped` (the remainder), and keep the first error. Then emit once, when
   failed+skipped > 0: `slog.Warn("BatchGetLatestPrice: per-symbol fallback incomplete", "failed", …,
   "fetched", …, "skipped", …, "total", n, "sample_error", firstErr)`.
9. Keep the rest unchanged (`@AC-4/@AC-5 @feature-191`, `@AC-3 @feature-178`):
   - the closure still returns a `nil` error, so symbols are omitted rather than fabricated;
   - the singleflight key (:743) is unchanged;
   - the response-building loop (:788-806) is unchanged.
10. Header propagation: no new outbound gRPC call; Alpaca calls are HTTP. N/A.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "WithoutCancel\|resolveBatchPriceBudget\|per-symbol fallback incomplete" internal/service/marketdata_service.go
```

---

### Step 4 — test: marketdata AC-3, hang/budget, prevClose concurrency (G10), resolver

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Fakes:
  - `fakeBatchPriceSource` (`marketdata_service_test.go:1320-1355`) implements `GetLatestTradesMulti` (:1326);
  - `fakeLatestTradeOnlySource` (:1357-1385) implements `GetLatestTrade` (:1363).
- Existing tests: `TestBatchGetLatestPrice_MultipleSymbols` (:1387), `_OmitMissingSymbols` (:1428) and
  `_FallbackWhenNotMultiSymbolSource` (:1461) build `&MarketDataService{registry: reg, warmSymbols: …}`.
- slog capture precedent: `countingWarnHandler` (:802-817). It is installed via `slog.SetDefault`, which is
  process-global, so no `t.Parallel()` (:802-804). The singleflight park pattern is at :1070.
- `internal/testdata/` does not exist (`ls` → absent).

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions** (design §6 AC-3, G10):
0. **RED discipline (P-06).** Before Step 3 lands, these tests reference `budgetCfg` / `intGetter` /
   `prevCloseReader` / `resolveBatchPriceBudget`, so the package fails to compile. That is a structural RED,
   not a behavioral one. Get a behavioral RED by stubbing first: add the seam types, the fields and a
   `resolveBatchPriceBudget` that returns 2500ms but is not yet used in the closure. Confirm that the hang, G10,
   AC-3 and incomplete-record tests then fail on their assertions or guards. Only then apply Step 3's behavior.
1. Add a `recordingWarnHandler` that keeps `slog.Record` messages and attributes, in the shape of
   `countingWarnHandler`. Do not use `t.Parallel()`.
2. **AC-3.** The `fakeBatchPriceSource` gains an injectable multi-fetch error and also implements
   `GetLatestTrade`, so the fallback runs. For `["AAPL"]`, assert:
   - a WARN record with message `BatchGetLatestPrice: multi-symbol fetch failed; falling back to per-symbol`
     and attr `symbols=1`;
   - the per-symbol fallback result is returned.
3. **Hang.** The fake multi-fetch blocks on `<-ctx.Done()`. Inject a budget of 50ms through a fake
   `intGetter` set on `svc.budgetCfg`. Run the call in a goroutine and `select` on `time.After(5*time.Second)`
   → `t.Fatal` (the design §6 hang guard; without it the RED run hangs). Assert:
   - it returns in < 1s;
   - the symbol is omitted;
   - the "budget exhausted … per-symbol fallback skipped" or "skipped" record is logged.
4. **Incomplete record.** Per-symbol failures plus a mid-loop budget expiry → one "per-symbol fallback
   incomplete" record with `failed/fetched/skipped/total/sample_error`.
5. **Source-lookup record.** An empty registry → the "source lookup failed" record.
6. **prevClose record.** A fake `prevCloseReader` returns an error → the "previous-close lookup failed"
   record, and the trade is still returned.
7. **G10, under `-race`.** The fake multi-fetch blocks until the fake `prevCloseReader` has been entered
   (a channel). Use an injected 1s budget. Assert that both `last_price` and `prev_close` are present. A
   sequential implementation deadlocks until the budget expires and drops the trade (RED). Use the same 5s
   goroutine/select guard.
8. **Resolver.** Table test `resolveBatchPriceBudget` with nil → 2500ms, and with fake values 0 → 2500ms,
   -5 → 2500ms, 50 → 50ms.
9. **Detached closure.** A caller ctx that is already cancelled still gets results from a fast fake. This
   proves `WithoutCancel`.
10. C-13 verdict: the fakes live in this single test file (one consumer), so they stay inline. No
    `internal/testdata/` home is created.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm total ≥ 40%. The new logic is in `internal/service/`, which is excluded from CI coverage
measurement, so no coverage threshold applies to it. The `-race` behavioral tests are the gate.

---

### Step 5 — service: analysis `read_budget.py`, the request-scoped DB budget primitive

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/read_budget.py` — create

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Not found:** `app/repositories/read_budget.py` (`ls` → absent). grep finds no asyncpg acquire timeout,
  `command_timeout` or `statement_timeout` anywhere in analysis (recon § Not found).
- Pool construction: `asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DB_POOL_MAX",
  "2")), statement_cache_size=0 if DB_PGBOUNCER else 100)` (`app/main.py:52-60`). Pool sizes are unchanged
  (F-06).
- `asyncpg` is locked at **0.31.0** (`uv.lock:44-45`). All asyncpg source citations in design.md §1
  (`transaction.py`, `pool.py`, `connection.py`, `exceptions/__init__.py`) are against that version.
- Precedent: a `log = logging.getLogger(__name__)` module logger (`servicer.py:93`).

**TDD**: `red-green required`

**Covers**: — (the unit precursor of AC-4 is proven in Step 6, and the real driver in Step 10)

**Instructions**: implement design.md §1 "New module" exactly. In outline:
1. **Module constants.** `_READ_DB_BACKSTOP_GRACE_S = 2.0`, `_RELEASE_TIMEOUT_S = 1.0`,
   `_ROLLBACK_WINDOW_S = 1.0` (the shared rollback+release window on the error path) and
   `_RELEASE_FLOOR_S = 0.05` (the minimum release timeout inside that window). These are fixed invariants, not config (F-07 exemption per the `_INTENT_SWEEP_SECONDS` precedent, documented in Step 13).
2. **Transient classification** (D4). `_TRANSIENT` / `_NOT_TRANSIENT` tuples over `asyncpg.exceptions`, plus
   `is_transient_db_error(e)`, exactly as design §1 lists them.
   - Transient: `PostgresConnectionError`, `TooManyConnectionsError` (53300), `QueryCanceledError` (57014),
     `AdminShutdownError` / `CrashShutdownError` / `CannotConnectNowError` (57P01–03),
     `IdleSessionTimeoutError` (57P05), `InterfaceError`, `OSError`. `TimeoutError` is a subclass of
     `OSError`.
   - Not transient: `ValueError` mixins (`ClientConfigurationError`, the interface `DataError`), and
     `Unsupported{Client,Server}FeatureError`.
3. **`class BudgetedConn`.** It wraps the acquired connection and the absolute monotonic deadline.
   - `_arm()` computes the remaining ms. If ≤ 0 it raises `TimeoutError("read DB budget exhausted")` and
     sends no statement. Otherwise it runs `SET LOCAL statement_timeout = {ms}`, where `ms` is an `int`
     (simple-query, 1 RTT).
   - `fetch` / `fetchval` / `fetchrow` each `await self._arm()`, then delegate.
   - Add a ≤2-line comment: single-task; DB-phase statements must be strictly sequential.
4. **`@asynccontextmanager async def budgeted_read(pool, budget_s)`.**
   - Stages: `acquire|begin|open|commit|done`.
   - `backstop = asyncio.timeout(budget_s + _READ_DB_BACKSTOP_GRACE_S)` wraps acquire → BEGIN → yield →
     COMMIT only. It **never** wraps cleanup (G7).
   - Acquire: `con = await pool.acquire(timeout=budget_s)`, with no await between it and `stage="begin"`.
   - Transaction: an unmanaged `tr = con.transaction(readonly=True); await tr.start()`.
   - On `BaseException`:
     - Compute `cancelled = isinstance(e, asyncio.CancelledError) or backstop.expired()`.
     - Log `budgeted_read: read DB phase failed at <stage> (<Type>: <msg>); <action>` **before** any await.
     - Then, under a guarding `try/except Exception`: rollback+release only when `stage == "open"`, not
       `cancelled`, and `not con.is_closed()`. Otherwise call `con.terminate()`. A cleanup failure logs
       `budgeted_read: cleanup after … skipped/failed (…) — … original error re-raised`.
     - A bare `raise` re-raises the original exception (H4).
   - Success: `await pool.release(con, timeout=_RELEASE_TIMEOUT_S)`. On failure, log `budgeted_read: read
     connection release failed (…); connection terminated` and do not raise (H5).
5. **`async def _rollback_then_release(pool, con, tr)`.**
   - Bounded `tr.rollback()` under one shared `asyncio.timeout(_ROLLBACK_WINDOW_S)`. Any failure → log, then
     `con.terminate()` (re-raise `CancelledError`).
   - Else `pool.release(con, timeout=max(remaining, _RELEASE_FLOOR_S))`; a failure is logged. No bare
     timeout literals in the module (C-18): every duration is one of the four named constants or the budget.
6. No servicer wiring in this step (Step 7).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run python -c "from app.repositories.read_budget import budgeted_read, BudgetedConn, is_transient_db_error"
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check .
```

---

### Step 6 — test: `test_read_budget.py` (G1, G2 unit, G5, G7, classification) and the shared fakes

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (add the shared `FakePool` / `FakeConn` /
  `FakeTx` / `bc_routed`)
- `services/xstockstrat-analysis/tests/test_read_budget.py` — create

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/conftest.py` (main-dev) holds:
  - `_setup_gen_path` (:12);
  - `fund_period` (:37) and the feature-215 PIT fixtures;
  - `ctx_with(headers)` (:59-64), whose `abort` raises;
  - `OWNER_HEADERS` (:67);
  - the `RecordingStub` fake-stub precedent (:71-98), the shape design §6 tells the new fakes to follow.
- pytest config is `asyncio_mode = "auto"` (`pyproject.toml:30-32`). pytest-timeout is **not** a dev
  dependency (`pyproject.toml:21`), hence the `asyncio.wait_for(…, 10)` hang guards.
- Ledger insight `insights.md:1673`: put a shared asyncpg async-CM mock helper in the shared home at once,
  not per class. The canonical Python home here is `tests/conftest.py` (C-13).

**TDD**: `red-green required`

**Covers**: — (G1, G2-unit, G5, G7, classification. These are design checks that precede AC-4.)

**Instructions** (design §6 rows G1 / G2 unit / G5 / G7 / Classification):
1. **conftest fakes** (C-13). They have two consumers, this file and Step 8, so they go in the home now.
   - `FakeTx`: `start` records `BEGIN READ ONLY`, `commit` records `COMMIT`, `rollback` records `ROLLBACK`.
     It has per-method stall/raise injection.
   - `FakeConn`:
     - `transaction(readonly=True)` → `FakeTx`;
     - `execute` (records each `SET LOCAL statement_timeout = n`);
     - `fetch` / `fetchval` / `fetchrow`;
     - `is_closed`, a sync `terminate` (counted), and a `released` flag;
     - stall/raise injection per method, and a "detached" mode in which every method raises
       `asyncpg.InterfaceError`.
   - `FakePool`: `acquire(timeout=)` (stall/raise injection, a hand-out count) and `release(con, timeout=)`
     (raise injection).
   - `bc_routed(fake_repo)`: a factory returning a wrapper whose every read method issues **exactly one**
     `bc.fetch` / `fetchval` / `fetchrow` on the passed `BudgetedConn`, then delegates to `fake_repo`.
2. **G1.**
   - Once the deadline has passed, `_arm` raises `TimeoutError` with no `SET LOCAL` recorded, and
     `budgeted_read` routes it to rollback + release (terminate count 0).
   - An acquire timeout → stage `acquire`, no terminate.
3. **G2 unit.** Rollback, release and terminate counts per error kind: a body `QueryCanceledError` →
   rollback + release; a BEGIN failure → terminate; a COMMIT failure → terminate.
4. **G5.**
   - `monkeypatch.setattr(read_budget, "_READ_DB_BACKSTOP_GRACE_S", 0.1)`, budget 0.2s.
   - Stall separately at BEGIN, at SET LOCAL, at fetch and at COMMIT. Each raises `TimeoutError` within
     B+G+0.5s, and terminate is called exactly once.
   - Wrap each in `asyncio.wait_for(…, 10)` (hang guard).
5. **G7.**
   - The original exception object is re-raised (`is` identity), and its log record precedes the rollback.
   - A detached proxy (as after `pool.terminate()`, or the `ConnectionDoesNotExistError` connection-lost
     model, where `is_closed()` raises `InterfaceError`) → 0 terminate calls, the original error re-raised,
     and a "cleanup … failed" warning.
   - `con.terminate()` or `tr.rollback()` faked to raise `InterfaceError` → the original error is re-raised.
   - An attached proxy with `is_closed()=True` → terminate=1 (the defensive branch).
6. **Classification.**
   - Each transient class → `is_transient_db_error` is `True`.
   - Each of these → `False`: `asyncpg.DataError` (22000), the interface `DataError`,
     `ClientConfigurationError`, `UnsupportedClientFeatureError`, `UnsupportedServerFeatureError`, a plain
     `ValueError`, and `UndefinedTableError`.
7. C-13 verdict: the fakes move into conftest because they have two consumers (Steps 6 and 8). The exception
   instances are scenario one-offs and stay inline.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_read_budget.py -q
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check .
grep -n "class FakePool\|class FakeConn\|class FakeTx\|def bc_routed" services/xstockstrat-analysis/tests/conftest.py
```
RED before Step 5: the `read_budget` import fails. Write the tests against the Step-5 contract, then confirm
each assertion fails for a behavioral reason once the module skeleton exists (tdd-gate step 2).

---

### Step 7 — service: `ListOpportunities` DB phase under the budget, kicks after release, enrichment deadline

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence** (main-dev):
- `@owner_scoped` (`servicer.py:462-475`) runs `self._caller_user_id(context)` before the body, and a
  non-raising abort returns `None` (:471). This is the precedent for `return None` after `abort`.
- `ListOpportunities` is at `:4490-4635`:
  - `propagation_meta` (:4509-4513); `user_id` (:4514);
  - the no-DB early return `if self._opportunities_repo is None` (:4516-4517);
  - `w = get_float("analysis.opportunity.signal_rank_weight", 0.3)` (:4519);
  - `req_sources` / `req_symbol` (:4521-4522);
  - `read(… include_expired=False …, symbol=req_symbol)` (:4523-4532);
  - `count_for_user` (:4543);
  - `compute_state_repo.get` (:4548-4552), `datetime.now(UTC) < state["valid_until"]` (:4553);
  - kicks at :4554 / :4563 / :4576;
  - the failure-counter read (:4564-4567);
  - the stale `read(include_expired=True …)` (:4578-4587);
  - the fresh retry scan guarded by `user_id not in self._opportunity_retrying` (:4594-4605);
  - the page/offset parse (:4608-4612);
  - window and `_row_to_opportunity` (:4613-4615);
  - `_enrich_opportunities_live` (:4618);
  - `available_sources(… include_expired=served_include_expired) if offset == 0` (:4622-4628);
  - the response (:4629-4635).
- `_enrich_opportunities_live` is at `:4637-4703`:
  - `ttl = get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 20)` (:4653);
  - `self._marketdata.BatchGetLatestPrice(…, metadata=propagation_meta)` (:4683-4686), which **already
    forwards the header trio**, so no new outbound call is added (C-03, `@AC-5 @feature-210`);
  - `except Exception as e: log.warning("_enrich_opportunities_live: BatchGetLatestPrice failed: %s", e)`
    (:4691-4692);
  - the memo write, success-only (`if ttl > 0 and last_price is not None`, :4698-4702).
- Kicks:
  - `_kick_opportunity_recompute` (:4737-4761) is a sync set-add plus `create_task` (:4742, :4761);
  - `_kick_opportunity_retry` (:4763-4785).
- Repository wiring:
  - `self._db_pool = db_pool` (:494);
  - `self._opportunities_repo = OpportunitiesRepository(db_pool) if db_pool else None` (:557);
  - `self._opportunity_compute_state_repo = (OpportunityComputeStateRepository(db_pool) if db_pool else None)`
    (:570-572).
- Constructors take only `db`:
  - `OpportunitiesRepository.__init__(self, db_pool)` (`opportunities.py:71`);
  - `OpportunityComputeStateRepository.__init__(self, db_pool)` (`opportunity_compute_state.py:14`).
- Read-path DB calls:
  - `read` → `self._db.fetch` (`opportunities.py:228`);
  - `available_sources` → `fetch` (:297);
  - `count_for_user` → `fetchval` (:326);
  - `compute_state.get` → `fetchrow` (`opportunity_compute_state.py:19`).

  These are exactly the three methods `BudgetedConn` exposes.
- Precedents:
  - DB failure → `UNAVAILABLE` at `SetOpportunityAction` (`servicer.py:6116-6118`);
  - deadline-that-degrades via `asyncio.wait_for` at `app/engine/pnl_pattern_consumer.py:364,378-383`;
  - the config int reader `get_int` at `app/config/watcher.py:99-105` (`v.int_val or default`: 0 → default,
    negatives pass through).
- `dataclass` is already imported (`servicer.py:24`). `asyncio` / `grpc` are imported (:13, :28).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design §1 Handler/Error path/G3, §2):
1. **Imports.** Add `from app.repositories.read_budget import budgeted_read, is_transient_db_error`.
2. **Factories.** Next to :557 / :571, add `self._opps_repo_factory = OpportunitiesRepository` and
   `self._state_repo_factory = OpportunityComputeStateRepository`. Tests may override them.
3. **Per-request result holder.** A small `@dataclass` (new; for example `_OpportunityQueueRead`) with these
   fields:
   - `rows`
   - `available`
   - `served_include_expired`
   - `computing`
   - `compute_failed`
   - `kick_full`
   - `retry_symbols`

   Name it however fits; it is local to this handler.
4. **`async def _read_opportunity_queue(self, opps, state_repo, user_id, request, offset, q)`.** It runs the
   statements strictly **sequentially**, in the order of design §1's pseudocode, with today's arguments
   unchanged:
   1. `read(include_expired=False, sources, action_filter, sort, symbol)`.
   2. On the fresh path, compute `q.retry_symbols` (if `user_id not in self._opportunity_retrying`) with the
      same predicate as :4596-4603.
   3. On the no-rows path: `count_for_user`, then `q.kick_full = True`. If `n == 0`, call
      `state_repo.get` (if not None) and apply the `valid_until` check; otherwise set `compute_failed` /
      `computing` from `_opportunity_compute_failures` read at that same instant (G3). If `n > 0`, set
      `served_include_expired=True` and call `read(include_expired=True, …)`.
   4. `q.available = await opps.available_sources(user_id, include_expired=q.served_include_expired) if
      offset == 0 else []` (hoisted from :4622-4628).
5. **Handler body.**
   - Keep `propagation_meta`, `user_id` and the no-DB early return (:4516-4517).
   - Move the page/offset parse (:4608-4612) **above** the DB phase.
   - Read `budget_ms = self._cfg.get_int("analysis.opportunity.read_db_budget_ms", 20000)`; if ≤ 0, use
     20000.
   - Then run the try / except Exception / finally block exactly as design §1 "Error path (H6)":
     - **Pool path** (`self._db_pool is not None`): `async with budgeted_read(self._db_pool, budget_ms/1000)
       as bc:` → `_read_opportunity_queue(self._opps_repo_factory(bc), self._state_repo_factory(bc), …)`.
     - **Else** the injected repos run directly (the test path, no budget).
   - The `finally` fires `_kick_opportunity_recompute` if `q.kick_full`, and `_kick_opportunity_retry` if
     `q.retry_symbols`. This happens **after** release, and also on the error and cancel paths (G3).
   - After the `finally`:
     - Transient error → `log.warning("ListOpportunities: opportunities store unavailable (%s: %s);
       returning UNAVAILABLE", …)`, then `await context.abort(grpc.StatusCode.UNAVAILABLE, "opportunities
       store unavailable; retry")`, then `return None`.
     - Non-transient → `log.error("ListOpportunities: opportunities read failed (%s: %s)", …)`, then
       `raise err`.
   - An external `CancelledError` is a `BaseException`, so it propagates and is not logged here.
6. **Enrichment deadline** (design §2).
   - Read `enrich_ms = self._cfg.get_int("analysis.opportunity.live_enrich_timeout_ms", 3000)`; if ≤ 0,
     use 3000.
   - Wrap the call at :4683 as `await asyncio.wait_for(self._marketdata.BatchGetLatestPrice(…,
     metadata=propagation_meta), timeout=enrich_ms / 1000)`.
   - Change the log at :4692 to `"_enrich_opportunities_live: BatchGetLatestPrice failed (%s: %s); serving
     unenriched", type(e).__name__, e`.
   - Keep the memo write success-only. Leave `data_unavailable`, ranking and `composite_score` untouched
     (`@AC-1/@AC-5 @feature-185`, `@AC-14 @feature-095`, `@AC-7 @feature-199`).
7. The connection is released before `_enrich_opportunities_live` runs (the `async with` exits first).
8. Pool sizes are unchanged (F-06). There is no new env var, so `docker-compose.yml` / `.do/app*.yaml`
   (deployment audit: no `DB_*TIMEOUT` var exists) are unchanged.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check .
grep -n "budgeted_read\|_opps_repo_factory\|_state_repo_factory\|live_enrich_timeout_ms\|read_db_budget_ms\|opportunities store unavailable" services/xstockstrat-analysis/app/handlers/servicer.py
grep -n "metadata=propagation_meta" services/xstockstrat-analysis/app/handlers/servicer.py   # header trio still forwarded on the deadlined call
```

---

### Step 8 — test: handler tests (AC-1, G3, G4, G5, G6 unit, G7, H5, O8, classification)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_list_opportunities_deadlines.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (G4 parametrization)
- `services/xstockstrat-analysis/tests/test_opportunity_compute_state.py` — modify (G4 parametrization)
- `services/xstockstrat-analysis/tests/conftest.py` — modify (the shared G4 `read_path` fixture and the
  per-connection order/release assertion helper; 2 consumer files, so C-13 puts them here)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence** (main-dev):
- `make_servicer()` is at `tests/test_analysis_servicer.py:36`; `_ctx(headers)` at :3955; `_HEADERS` at
  :3963.
- `_FakeOppRepo` (:4175+) is an in-memory repo. Its `read(…, symbol="")` (:4195-4206) accepts the feature-215
  kwarg.
- `ListOpportunities` call sites: **19** in `test_analysis_servicer.py` (:4567, 4577, 5433, 5453, 5471,
  5585, 5686, 5690, 5764, 5772, 5820, 5918, 7205, 7207, 7368, 7397, 7415, 7433, 7451) and **3** in
  `test_opportunity_compute_state.py` (:66, 88, 93). design.md said 18 + 3; feature 215 added one.
- `asyncio.gather` of 6 concurrent requests is at :5916-5926 (why G4 asserts per-request release, not a
  global `in_use == 0`).
- Fake-marketdata precedent: `svc._marketdata.BatchGetLatestPrice = AsyncMock(…)` (`test_live_enrich_memo.py:32`;
  `test_analysis_servicer.py:4539`).
- Hang-fake precedent: `FakeComposer(hang_indicators=True)` (`tests/test_pnl_pattern_consumer.py:158-170`).
- A real `ConfigSnapshot` is needed for O8 / AC-1: the watcher reads `self._snapshot.values.get(key)`
  (`app/config/watcher.py:99-105`).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions** (design §6):
1. **@AC-1** (`test_list_opportunities_deadlines.py`).
   - A servicer with a `_FakeOppRepo`-style repo holding "AAPL" and "MSFT" rows (fresh).
   - `svc._marketdata.BatchGetLatestPrice` is an async function that never returns (`await asyncio.Event().wait()`).
   - `live_enrich_timeout_ms=200` via a real `ConfigSnapshot` with the full-dotted key.
   - Hang guard: `asyncio.wait_for(svc.ListOpportunities(…), 10)`.
   - Assert:
     - 2 rows in < 1.7s (the enrichment deadline + 1.5s);
     - no `live_price` (`HasField` false);
     - `data_unavailable` false;
     - a warning naming `BatchGetLatestPrice` and `TimeoutError` (`caplog`);
     - `svc._live_enrich_memo` empty.
   - RED today: the call hangs until the 10s guard.
2. **G4.** Parametrize every existing `ListOpportunities` test above over `read_path ∈ {direct, pool}`.
   - Implement the switch once in `tests/conftest.py` as a `read_path` fixture, parametrized over
     `direct`/`pool`, plus an `assert_budgeted_read_order(conn, budget_ms)` helper. Both test files consume
     these; no per-file copies (C-13).
   - Pool mode sets `svc._db_pool = FakePool()`, `svc._opps_repo_factory = lambda bc: bc_routed(<that
     test's fake opp repo>)`, and the same for the state repo. **When the test's
     `_opportunity_compute_state_repo` is `None`, `_state_repo_factory` must return `None`**, so pool mode
     matches direct mode.
   - Per acquired `FakeConn`, assert this order:
     `BEGIN READ ONLY → (SET LOCAL nᵢ → stmt)* → COMMIT → release`,
     with every nᵢ ≤ the budget in ms and the sequence non-increasing.
   - Assert that the connection *this request* acquired is `released` at enrichment time and at kick time.
   - Assert results identical to direct mode.
3. **G3.** On both paths:
   - failures ≥ MAX → `compute_failed`;
   - fewer → `computing`;
   - a fresh empty stamp → neither flag, plus a kick;
   - a stale queue → a kick plus the `include_expired=True` facet;
   - a fresh queue with a stale-unavailable row → a retry kick.
4. **G5, handler-level.** Patch `_READ_DB_BACKSTOP_GRACE_S` to 0.1 with a 0.2s budget, and stall at
   BEGIN / SET LOCAL / fetch / COMMIT. Each gives `UNAVAILABLE` within B+G+0.5s, with terminate called once.
   Use the hang guard.
5. **G6 unit.**
   - An external `task.cancel()` of the task running the handler during a stalled fetch propagates
     `CancelledError`.
   - Assert: no `context.abort`, no "opportunities read failed" log, one terminate.
6. **G7, handler-level.** A detached-proxy connection-lost fake → `UNAVAILABLE`, with the original error
   logged.
7. **H5.** On the success path, `FakePool.release` raises `TimeoutError`. Assert:
   - the rows are still returned;
   - `read connection release failed` is logged;
   - no abort.
8. **Classification, handler-level.**
   - Each transient error → `UNAVAILABLE`.
   - `asyncpg.DataError`, `ValueError` and `UndefinedTableError` → re-raised (the client would see
     `UNKNOWN`), with an `opportunities read failed` error log.
   - A `compute_state.get` `TimeoutError` → exactly one kick, then `UNAVAILABLE`.
9. **O8.** A realistic `ConfigSnapshot` with a float-typed or negative `*_ms` value reads as the default
   (20000 / 3000).
10. **Identity gate preserved** (`@AC-8/@AC-16 @feature-225`). A headerless call still gets
    `UNAUTHENTICATED` before any `FakePool.acquire`.
11. C-13 verdict:
    - The pool / conn / tx fakes come from `tests/conftest.py` (Step 6). The `read_path` fixture and the
      order/release helper are added to `tests/conftest.py` in this step.
    - The AAPL/MSFT row dicts have one consumer (this new file), so they stay inline.
    - Existing tests keep their own fakes; parametrization adds no new domain literal.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_list_opportunities_deadlines.py tests/test_analysis_servicer.py tests/test_opportunity_compute_state.py -q
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check .
grep -n "from .conftest\|conftest\|FakePool\|bc_routed" services/xstockstrat-analysis/tests/test_list_opportunities_deadlines.py
```

---

### Step 9 — test: the `local_pg` fixture, the `real_pg` marker, and the CI PostgreSQL step (D3)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (session-scoped `local_pg` fixture)
- `services/xstockstrat-analysis/pyproject.toml` — modify (register the `real_pg` marker)
- `.github/workflows/ci.yml` — modify (the guarded PostgreSQL install in `python-test`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `pyproject.toml:30-32` holds `[tool.pytest.ini_options] testpaths = ["tests"], asyncio_mode = "auto"`. No
  `markers` key exists yet. No dependency changes are needed (asyncpg is already locked), so there is no
  `uv lock`.
- CI:
  - the `python-test` job is at `.github/workflows/ci.yml:334-402`, with the analysis matrix entry at
    :355-357;
  - the precedent for a per-service guarded apt step is `install libseccomp (indicators sandbox)` with
    `if: matrix.service == 'xstockstrat-indicators'` (:383-388);
  - the pytest step `uv run --no-sync pytest --cov=…` is at :390-395.
- Host check (this sandbox): `/usr/lib/postgresql/16/bin/initdb` is present, uid 0, and a `postgres` user
  exists (`getent passwd postgres`). So the `runuser -u postgres --` path applies locally.
- Ledger: `insights.md:2565-2571` says any real Postgres binary satisfies a live-DB gate without Docker.
  `fails.md` (2026-09-15, feature 190) names the shared analysis real-DB fixture as the durable follow-up,
  and this fixture seeds it.

**TDD**: `N/A (test infrastructure: a fixture, a marker and a CI step, with no product behavior. Step 10's
real_pg runs exercise it, and their red/green covers it.)`

**Covers**: —

**Instructions** (design §6 "Session-scoped `local_pg` fixture"):
1. Write `local_pg` (session scope) in `tests/conftest.py`.
   - **Binary discovery order:**
     1. `$XSTOCKSTRAT_PG_BIN`;
     2. `shutil.which("pg_ctl")`'s directory;
     3. `glob("/usr/lib/postgresql/*/bin")` (newest);
     4. the Homebrew paths `/opt/homebrew/opt/postgresql@*/bin` and `/usr/local/opt/postgresql@*/bin`.
   - **Data dir:** `tempfile.mkdtemp(dir="/tmp")`.
   - **As root with a `postgres` user:** `chown` the dir and prefix the commands with `runuser -u postgres --`.
   - **Start:** `initdb -A trust --no-sync`, then `pg_ctl -w start -o "-c fsync=off -c listen_addresses='' -k <dir>"`
     (Unix socket only).
   - **Yield:** a DSN (`postgresql:///postgres?host=<dir>&user=postgres`).
   - **Finalizer:** `pg_ctl -m immediate stop`, then `shutil.rmtree`.
   - **If it cannot start:** `pytest.skip(...)` locally, but `pytest.fail(...)` when `os.environ.get("CI") ==
     "true"`.
2. In `pyproject.toml`, under `[tool.pytest.ini_options]`, add `markers = ["real_pg: needs a local
   PostgreSQL binary (tests/conftest.py local_pg)"]`.
3. In `ci.yml` `python-test`, add a step after the libseccomp step (:383-388) and before `pytest with
   coverage` (:390):
   - name `install postgresql (analysis real_pg tests)`
   - `if: matrix.service == 'xstockstrat-analysis'`
   - `run: ls /usr/lib/postgresql/*/bin/initdb || (sudo apt-get update && sudo apt-get install -y --no-install-recommends postgresql)`
4. Do not add a long-running container or docker service (D3). Do not change `docker-compose.yml`.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --markers | grep real_pg
grep -n "install postgresql (analysis real_pg tests)" .github/workflows/ci.yml
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check .
```
The full-suite run proves the conftest edit imports cleanly (coverage ≥ 40%). Step 10's runs prove that the
fixture starts and stops.

---

### Step 10 — test: real-Postgres proofs (AC-4, G2, F2, G6)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_read_budget_real_pg.py` — create

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `budgeted_read` / `BudgetedConn` (Step 5) and the servicer pool path `self._db_pool` + `_opps_repo_factory`
  (Step 7).
- Production pool shape: `asyncpg.create_pool(min_size=1, max_size=DB_POOL_MAX or 2,
  statement_cache_size=0|100)` (`app/main.py:52-60`). The tests use `statement_cache_size=0`, the PgBouncer
  mode.
- `owner_scoped` (`servicer.py:462-475`) runs before the DB phase, which is why a headerless call still gets
  `UNAUTHENTICATED`.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions** (design §6 rows AC-4 / G2 / F2 / G6). Mark every test `@pytest.mark.real_pg` and use
`local_pg`.
1. **@AC-4.**
   - Setup:
     - `asyncpg.create_pool(dsn, min_size=2, max_size=2, statement_cache_size=0)`;
     - create the minimal `analysis.opportunities` / `opportunity_actions` tables the read touches, **or**
       route through a `bc_routed`-style factory that issues `SELECT 1`. Either is fine, since the call
       must block at acquire.
     - The test acquires and holds both connections.
     - Use a real servicer built via `from tests.test_analysis_servicer import make_servicer` (the established
       precedent: `test_opportunity_refresh.py:15`, `test_owner_header_guard.py:28`) on the pool path
       (`svc._db_pool = pool`) and a 300ms budget via `ConfigSnapshot`
       `analysis.opportunity.read_db_budget_ms=300`.
     - Wrap `asyncpg.Connection.terminate` with a spy.
   - Assert:
     - `UNAVAILABLE` (via an `abort` that records the code);
     - elapsed < 0.3 + 0.5s, well under the B+2 backstop;
     - a `budgeted_read` warning naming stage `acquire` and `TimeoutError`;
     - the terminate spy was never called;
     - both held connections are still open (`not is_closed()`).
   - Also: a headerless call → `UNAUTHENTICATED`.
   - RED today: there is no acquire bound, so the hang guard `asyncio.wait_for(…, 10)` fails.
2. **G2.**
   - Setup: a pool with min=max=1 and `statement_cache_size=0`. Record `pg_backend_pid()`.
   - Under a 300ms budget, `bc.fetch("SELECT pg_sleep(5)")` raises `QueryCanceledError`.
   - Assert:
     - `caplog` has no asyncio "Resetting connection with an active transaction" record;
     - the reacquired connection has the **same** pid;
     - it runs `SELECT 1`;
     - `SHOW statement_timeout` is `'0'`.
3. **F2 (leak).**
   - Setup: a pool with min=max=1, `statement_cache_size=0`, and a `connection_class` with an empty reset
     query (`get_reset_query` → `""`).
   - After a budgeted read on the same pid, `SHOW statement_timeout` is `'0'` (SET LOCAL does not leak).
   - Negative control: a session `SET statement_timeout = 1234` persists across release, which proves the
     test can detect a leak.
4. **G6.**
   - Setup: a pool with min=max=1, a budget ≥ 10s, pid recorded.
   - `asyncio.timeout(0.3)` wraps the **entire** `async with budgeted_read(...)` block, with `SELECT
     pg_sleep(30)` as the body.
   - Assert:
     - it raises the outer `TimeoutError` (not `QueryCanceledError`);
     - elapsed < 1s;
     - the next acquire has a **different** pid;
     - `statement_timeout` is `'0'`.
5. Pools are closed in a `finally`. Every call carries a hang guard.
6. C-13 verdict: the SQL strings and pools are scenario one-offs used by one file, so they stay inline.
   `local_pg` comes from conftest.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest -m real_pg -q tests/test_read_budget_real_pg.py
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check .
```
`-m real_pg` must report the tests as **passed, not skipped**. A skip means the fixture did not start, and that
is a failed verification for this step.

---

### Step 11 — service: agent `list_opportunities` deadline and explicit error (consumer surface)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence** (main-dev):
- `client.list_opportunities(user_id, min_conviction=0.0, page_size=50, page_token="")` is at
  `app/client.py:848-880`.
  - `mtls.secure_channel(ANALYSIS_ENDPOINT, "xstockstrat-analysis")` (:863).
  - `stub.ListOpportunities(…, metadata=_metadata(("x-user-id", user_id)))` (:865-871). There is no
    `timeout=`.
  - The header trio comes via `_metadata()` (:59). It is unchanged, which preserves `@AC-5 @feature-210`.
- `client.get_config_value(key, *, namespace, environment, user_id="")` is at `:1727-1761`. Its `GetConfig`
  call has no deadline (:1749). It stays untouched (design §4).
- `_grpc_error_message(exc, not_found="not found")` is at `app/tools.py:221-232`. It handles NOT_FOUND,
  UNAUTHENTICATED, PERMISSION_DENIED and INVALID_ARGUMENT, then falls back to `details() or str(code)`.
  There is no DEADLINE_EXCEEDED branch.
- The tool `list_opportunities` is at `:1509-1546`:
  - its docstring mentions "a sparkline (recent daily closes; a gap is null)" (:1529);
  - it calls `client.list_opportunities(user_id, min_conviction, page_size, page_token)` (:1543) and raises
    `RuntimeError(_grpc_error_message(e))` (:1545).
- `_extract_policy(key, default, cast)` is at `:2338-2351`. It logs `"extract policy read failed; using safe
  default"` (:2344). Its 4 call sites are at `:2365-2368`, and grep finds no test referencing it.
- `tools.py` imports `json`, `logging` and so on (:57-66), but **not** `asyncio` or `math`. Add them.
  Logger: `log` (`tools.py:93`).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (design §4):
1. **client.py.** Change the signature to `list_opportunities(user_id, min_conviction=0.0, page_size=50,
   page_token="", timeout: float | None = None)` and pass `timeout=timeout` to `stub.ListOpportunities(…)`.
   Leave every other call site alone (rejected alternative: a shared default deadline).
2. **tools.py rename.**
   - Rename `_extract_policy` → `_agent_policy` (definition and the 4 call sites).
   - Generalize the docstring and log line: `"agent policy read failed; using safe default"`. Still no
     key/value is logged (FR-6 of feature 207).
3. **tools.py constant.** Add `_POLICY_READ_TIMEOUT_S = 3.0` with a ≤2-line comment: a fixed invariant that
   bounds the undeadlined `GetConfig`, read at call time so tests can monkeypatch it.
4. **Tool body.**
   - `timeout_s = await asyncio.wait_for(_agent_policy("opportunities.read_timeout_seconds", 40.0, float),
     _POLICY_READ_TIMEOUT_S)`.
   - On `TimeoutError`: `log.warning("agent policy read timed out; using safe default")` and use 40.0.
   - If `not math.isfinite(timeout_s) or timeout_s <= 0`, use 40.0.
   - Pass `timeout=timeout_s`.
   - Map errors with `_grpc_error_message(e, deadline_s=timeout_s)`.
5. **`_grpc_error_message`.** Add a keyword `deadline_s: float | None = None` and a branch: `if code ==
   grpc.StatusCode.DEADLINE_EXCEEDED: return f"upstream did not respond within {deadline_s:g}s (deadline
   exceeded); retry shortly"`. When `deadline_s` is None, drop the "within …" clause. Existing callers are
   unaffected.
6. **Docstring** (design §7 drift).
   - Drop ", a sparkline (recent daily closes; a gap is null)" from the tool docstring (:1529). The server no
     longer fills it (`servicer.py:4645-4647`).
   - Tool name, parameters and return shape are unchanged. The tool count is unchanged.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .
grep -n "_extract_policy" services/xstockstrat-agent/app/tools.py   # expect no output
grep -n "_agent_policy\|_POLICY_READ_TIMEOUT_S\|DEADLINE_EXCEEDED\|timeout=timeout" services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/client.py
grep -n 'metadata=_metadata(("x-user-id", user_id))' services/xstockstrat-agent/app/client.py   # header trio preserved
```

---

### Step 12 — test: agent AC-2, policy fallbacks, and the DEADLINE_EXCEEDED mapper

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_list_opportunities_deadline.py` — create
- `services/xstockstrat-agent/tests/test_tools.py` — modify (the mapper branch)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `tests/conftest.py` sets:
  - `ANALYSIS_ENDPOINT=analysis-test:50056` (:55, :73 via `monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", …)`);
  - dummy PEM `MTLS_CERT/KEY/CA_CERT` (:61-66).

  So a real dial would fail TLS or time out before reaching a test server. Hence the monkeypatch of
  `client.mtls.secure_channel` (`client.py:17` imports `from app import mtls`; `app/mtls.py:37-43`).
- `_rpc_error(code, details="")` builds `grpc.aio.AioRpcError(code, Metadata(), Metadata(), details=…)`
  (`tests/test_tools.py:929-932`).
- pytest uses `asyncio_mode = "auto"` (`pyproject.toml`).
- **Not found:** any in-process `grpc.aio.server` test harness in agent tests (grep `grpc.aio.server|add_insecure_port`
  → none). This step creates the first one, scoped to this file.

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions** (design §6 AC-2):
1. **@AC-2.**
   - Setup:
     - start a `grpc.aio.server()` on `add_insecure_port("127.0.0.1:0")` with a generic handler for
       `xstockstrat.analysis.v1.AnalysisService/ListOpportunities` (via the generated
       `analysis_pb2_grpc.add_AnalysisServiceServicer_to_server`) whose method sets an `asyncio.Event`, then
       awaits forever;
     - `monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", f"127.0.0.1:{port}")`;
     - `monkeypatch.setattr(client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep))`;
     - patch `tools._agent_policy` with an **async** function returning 0.2 (it is awaited under `wait_for`).
   - Invoke the registered `list_opportunities` tool (the same way existing tool tests invoke tools).
   - Assert:
     - a `RuntimeError` whose message contains "deadline", in < 1.5s;
     - the handler-entered event **is set** (reachability);
     - then `await server.stop(0)`.
   - Hang guard: `asyncio.wait_for(…, 10)`. RED today: there is no deadline, so the guard fires.
   - RED discipline (P-06): before Step 11, `_agent_policy` and `_POLICY_READ_TIMEOUT_S` do not exist, so the
     `monkeypatch.setattr` raises `AttributeError`, a structural RED. For the behavioral RED, patch with
     `raising=False`, or run the AC-2 test against today's code with only the server/channel patches, and
     confirm the 10s guard fires.
2. **Policy fallbacks.**
   - A hung `_agent_policy` with `_POLICY_READ_TIMEOUT_S` monkeypatched to 0.1 → the call uses timeout 40
     (capture the `timeout=` passed to a patched `client.list_opportunities`).
   - Policy values 0, -1, `nan` and `inf` → 40 each.
3. **Mapper** (`test_tools.py`, where `_rpc_error` lives).
   - `_grpc_error_message(_rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED, "Deadline Exceeded"), deadline_s=40.0)`
     → contains `within 40s` and `deadline exceeded`.
   - Without `deadline_s` it still names "deadline exceeded".
   - Do **not** import `_rpc_error` into the new file (C-13: no cross-test-module helper import). The new
     file builds its error via the real server.
4. C-13 verdict: the servicer stub and event are scenario one-offs with one consumer, so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_list_opportunities_deadline.py tests/test_tools.py -q
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .
```

---

### Step 13 — docs: key rows, doc-drift fixes, findings, and the context-forge teardown

**Status**: `pending`
**Service**: `docs/`, plus three service `CLAUDE.md` files
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/context-constitution-findings.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence** (main-dev):
- **analysis `CLAUDE.md`:**
  - `:182` (Decide-surface section `:178-191`) says the memo stores "live quote+sparkline … skips
    `GetLatestPrice`/`GetBars`". The code calls only `BatchGetLatestPrice` (`servicer.py:4683`).
  - `:517` describes the `analysis.opportunity.sparkline_bars` row as "read live per read-time enrichment".
    grep finds no reader in `app/`.
  - `:520` gives the `live_enrich_ttl_seconds` default as `10`. The code default is `20`
    (`servicer.py:4653`); migration 028 seeds `10`.
  - Config Keys table: `:451-534`. The `_INTENT_SWEEP_SECONDS` fixed-invariant precedent is at `:63`.
- **marketdata `CLAUDE.md`:** the Config Keys table runs `:48-103`. The `marketdata.stream.*` rows are at
  `:66-71`.
- **agent `CLAUDE.md`:** the Config Keys table starts at `:191`. The `agent.extract.*` rows are at
  `:201-204`.
- **`docs/patterns/config-governance.md`:** `## Per-Feature Registered Keys` is at `:105`, newest first (the
  feature 224 entry is at `:109`). The feature 177 row at `:269` says `live_enrich_ttl_seconds` … `10` …
  "No-seed", but migration 028 seeded it.
- **`docs/context-constitution-findings.md`:** the sections "Documentation that lies" (:13), "Latent bugs"
  (:23) and "Open questions" (:35).
- **`docs/runbooks/mcp-tools.md` § `list_opportunities`** (`:978-1045`): `:1026` documents a `sparkline`
  field, and `:1045` reads "**Errors** — a backend `AioRpcError` surfaces as a `RuntimeError` with the gRPC
  status message."
- `.agents/context-forge.json` `scrubberExtraTargets`: `["README.md", "docs/patterns/ui-ux-governance.md"]`
  (:6). Neither is touched here.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (design §7):
1. **analysis `CLAUDE.md`.**
   - `:182`: the memo skips only `BatchGetLatestPrice`, with no sparkline.
   - `:517`: mark `sparkline_bars` **inert** (no reader).
   - `:520`: the default is `20` in code and seeded `10` by migration 028.
   - Add two rows, `analysis.opportunity.read_db_budget_ms` (int, `20000`, bounds `[1000,20000]`) and
     `analysis.opportunity.live_enrich_timeout_ms` (int, `3000`, bounds `[500,4000]`). Each row states:
     - `value_type` must be `int` (a float reads as the default, F4);
     - unseeded (D2 waiver);
     - ≤ 0 → default.
   - Add a fixed-invariants note (`_READ_DB_BACKSTOP_GRACE_S=2.0`, `_RELEASE_TIMEOUT_S=1.0`,
     `_ROLLBACK_WINDOW_S=1.0`, `_RELEASE_FLOOR_S=0.05`) following the
     `_INTENT_SWEEP_SECONDS` precedent.
   - In § Running Tests, document the `real_pg` marker and the test-only `XSTOCKSTRAT_PG_BIN` override
     (the PostgreSQL bin dir for `local_pg`; not an inter-service connection var).
   - In the Decide-surface section, add the constraint: the `ListOpportunities` read DB phase is strictly
     sequential on one budgeted connection, and kicks fire after release.
2. **marketdata `CLAUDE.md`.** Add a row `marketdata.price.batch_timeout_ms` (int, `2500`, bounds
   `[500,2500]`, unseeded). It is the detached `BatchGetLatestPrice` closure budget; ≤ 0 or no watcher →
   2500.
3. **agent `CLAUDE.md`.** Add a row with the exact key-column string, stored as ns `agent`, key
   `opportunities.read_timeout_seconds` (float, int accepted, `40`, bounds `[30,55]`, unseeded). Note the
   fixed 3s policy-read invariant `_POLICY_READ_TIMEOUT_S`.
4. **`docs/patterns/config-governance.md`.**
   - Fix the `:269` row: seeded `10` by migration 028, with a code default of `20`.
   - Add `### feature 226 — fix-opportunities-read-hangs (xstockstrat-analysis / xstockstrat-marketdata /
     xstockstrat-agent / xstockstrat-config)` above `:109`. List the four keys with type, default and bounds,
     and state the **D2 seeding waiver** (a conscious deviation from feature 184's `analysis.opportunity.*`
     seeding convention).
5. **`docs/context-constitution-findings.md`** (flag only, no fix):
   - the agent `GetConfig` call has no deadline (`services/xstockstrat-agent/app/client.py:1749`), mitigated
     by the 3s wrapper;
   - the durable feature-191 acceptance text still names `BatchGetBars` for the enrichment
     (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:24`);
   - the seeded TTL of 10 is below the 15s poll, so the memo never hits;
   - the G6 residual: on terminate the backend runs until `statement_timeout` (≤ the remaining budget).
6. **`docs/runbooks/mcp-tools.md`** (agent-owner parity with the Step 11 docstring).
   - Remove the `sparkline` bullet (`:1026`).
   - Extend the `:1045` Errors line for `list_opportunities`: a hung analysis read fails after the
     `agent.opportunities.read_timeout_seconds` deadline (default 40s) with "upstream did not respond within
     Ns (deadline exceeded); retry shortly". A saturated store returns "opportunities store unavailable;
     retry".
   - This parity edit goes beyond design §7, which named only `tools.py`. It is required by the agent
     reviewer focus and C-10.
7. **Teardown (root `CLAUDE.md` § Teardown).** This feature changes behavior that three `CLAUDE.md` files
   describe. Run `/context-forge:context-constitution refresh` scoped to the touched files, and fix the
   grounded drift it reports. If the plugin is unavailable, re-read each touched context file against the
   code by hand. Record in the PR body **both** that the plugin was unavailable **and** the reconciliation
   performed.

**Verification**:
```bash
grep -n "read_db_budget_ms\|live_enrich_timeout_ms" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
grep -n "batch_timeout_ms" services/xstockstrat-marketdata/CLAUDE.md docs/patterns/config-governance.md
grep -n "opportunities.read_timeout_seconds" services/xstockstrat-agent/CLAUDE.md docs/patterns/config-governance.md docs/runbooks/mcp-tools.md
grep -n "### feature 226" docs/patterns/config-governance.md
grep -c "sparkline" docs/runbooks/mcp-tools.md   # the list_opportunities bullet is gone (any other mention is reviewed by hand)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 3 — marketdata `BatchGetLatestPrice` (applies to every Go Verification, Steps 3–4)
**Spec said**: `GOWORK=off golangci-lint run --modules-download-mode=mod`
**Actual**: ran `GOWORK=off /tmp/claude-0/gl-v2.14.0/golangci-lint run --modules-download-mode=mod` (golangci-lint v2.14.0).
**Reason**: the sandbox's `/usr/local/bin/golangci-lint` is v2.5.0, which cannot read Go 1.27 export data; v2.14.0 is the CI version.
**Disposition**: CI-equivalent fallback
