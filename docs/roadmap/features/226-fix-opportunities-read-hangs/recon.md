# Recon: fix-opportunities-read-hangs

**Created**: 2026-10-14
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-analysis, xstockstrat-marketdata
(consumer surface: xstockstrat-ui BFF, which reads only)

---

## Objective

The Decide-queue read (`ListOpportunities`, reached from the agent's `list_opportunities` tool and the UI BFF)
hangs past client timeouts and logs nothing. No hop on the path has a deadline, and marketdata
`BatchGetLatestPrice` discards its errors. The fix must bound the read:
- a stalled price enrichment degrades to unenriched rows;
- a read that cannot complete fails fast with a gRPC status and a log line;
- marketdata logs the errors it currently drops.

## Codebase Map

### `xstockstrat-agent` (Python, MCP)

- **Tool.** `list_opportunities` is at `services/xstockstrat-agent/app/tools.py:1498-1531`. It maps `AioRpcError` through
  `_grpc_error_message` (`tools.py:221-232`). That mapper handles NOT_FOUND, UNAUTHENTICATED, PERMISSION_DENIED and
  INVALID_ARGUMENT, then falls back to `details() or str(code)`. There is no DEADLINE_EXCEEDED case.
- **Client.** `list_opportunities` is at `app/client.py:845-876`: `mtls.secure_channel(ANALYSIS_ENDPOINT, …)` (`:860`), then
  `stub.ListOpportunities(…, metadata=_metadata(("x-user-id", user_id)))` (`:862-867`).
  - No call in `client.py` passes `timeout=`.
  - There is no shared call helper. About 69 call sites each open their own channel (`app/mtls.py:9,37-43`).
- **Config.**
  - `agent.*` keys are read with a one-shot `GetConfig` call through `client.get_config_value` (`client.py:1724-1758`). That call has no deadline either (`:1746`).
  - Reading a policy value with a default: `_extract_policy(key, default, cast)` (`tools.py:2324`).
  - Precedent timeout keys: `agent.extract.connect_timeout_seconds` / `read_timeout_seconds` (`tools.py:2353-2354`; `CLAUDE.md:191-204`).

### `xstockstrat-analysis` (Python, gRPC aio)

- **Handler.** `ListOpportunities` is at `services/xstockstrat-analysis/app/handlers/servicer.py:4178-4320`, with `@owner_scoped` (`:416-426`).
  Its awaits, in order:
  1. `opportunities_repo.read` (`:4210` → `repositories/opportunities.py:191`, `self._db.fetch` `:221`).
  2. When there are no rows, `count_for_user` (`:4229` → `opportunities.py:311`).
  3. When the count is 0, `compute_state_repo.get` (`:4235` → `opportunity_compute_state.py:17`).
  4. On the stale branch, a second `read(include_expired=True)` (`:4264`).
  5. `_enrich_opportunities_live` (`:4303`).
  6. When offset is 0, `available_sources` (`:4308` → `opportunities.py:276`).

  The kicks to recompute and to retry are fire-and-forget (`:4240/:4249/:4262/:4290`, defined at `:4422`). The DB calls have no
  try/except.
- **Enrichment.** `_enrich_opportunities_live` is at `:4322-4389`.
  - The memo TTL comes from `get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 20)` (`:4338`). The memo is a dict (`:553`)
    checked against `time.monotonic()` (`:4356`).
  - It makes one RPC, `self._marketdata.BatchGetLatestPrice(…, metadata=propagation_meta)` (`:4368-4371`), with **no timeout**.
  - On error it hits `except Exception` and logs a warning (`:4376-4377`). Failures are not memoized (`:4383`). The stub is created at `:449`.
- **DB pool.** `app/main.py:53-61` runs `asyncpg.create_pool(min_size=1, max_size=DB_POOL_MAX or 2, statement_cache_size=0|100)`.
  - It sets no `timeout`, `command_timeout` or `statement_timeout`.
  - The read-path repos use implicit `pool.fetch`/`fetchval`/`fetchrow`.
  - The explicit `acquire()` calls are all on write paths (`opportunities.py:80,129`, `strategies.py:69,145`, `readiness_cache.py:49`).
- **Config watcher.** `app/config/watcher.py`: `get_int` (`:99`) and `get_float` (`:128`) fall back to the default when the value is 0. `get_int_present` (`:107`) and
  `get_float_present` (`:136`) keep an explicit 0.
- **Status mapping.** Done inline with `context.abort`. DB-failure precedent: `except Exception` → `log.warning` → `UNAVAILABLE`
  (`servicer.py:5709-5711`). There is no central helper.

### `xstockstrat-marketdata` (Go)

- **`BatchGetLatestPrice`** is at `services/xstockstrat-marketdata/internal/service/marketdata_service.go:730-805`. Its steps:
  1. Singleflight keyed on the sorted symbols, run with the first caller's ctx (`:739-747`).
  2. `trades, _ = ms.GetLatestTradesMulti(…)`; the error is discarded (`:753-754`). A `registry.Get` error is also dropped silently (`:750`).
  3. A sequential per-symbol `GetLatestTrade` fallback that discards each error (`:757-765`).
  4. `prevClose, _ = s.repo.GetPreviousDailyCloseBatch(…)` (`:772-775`).

  The closure always returns a nil error (`:779-781`).
- **Alpaca `do()`.** `internal/alpaca/client.go:83-92` waits on a rate limiter with the request ctx (`:86-89`). It uses a hard-coded
  `http.Client{Timeout: 30s}` (`:76`). Both trade calls use `NewRequestWithContext`, so a ctx deadline bounds them.
- **pgxpool.** `internal/repository/pool.go:15-34` has a max of 2 (`DB_POOL_MAX`) and no acquire timeout.
- **Config.** `cfg.GetInt/GetFloat(key, default)` (`internal/config/config.go:142-184`), re-read on each use (`:833`). Getters
  have **no nil-receiver guard**, and the existing `BatchGetLatestPrice` tests build the service with a nil `cfg`.
- No `context.WithTimeout` is used in any service or handler path.

### `xstockstrat-ui` (consumer)

- The BFF already has a 30s gRPC deadline on ListOpportunities (`services/xstockstrat-ui/acceptance/opportunities-latency-fix.feature`
  @AC-1). Nothing to change; it bounds the budget.

## Patterns to REUSE

- **Deadline that degrades** (the enrichment). Reuse the `asyncio.wait_for` + degrade pattern from
  `app/engine/pnl_pattern_consumer.py:364-388`: deadlines are config ints (`analysis.snapshot.indicator_timeout_ms`), and an
  exception produces a partial result.
- **Deadline that aborts** (a read). Reuse ScreenSymbols: `asyncio.wait_for(..., timeout=cfg)` → `context.abort(DEADLINE_EXCEEDED,
  "... exceeded Ns deadline")` (`servicer.py:3454-3463`, key `analysis.screener.max_duration_seconds`).
- **DB failure becomes UNAVAILABLE.** `servicer.py:5709-5711`.
- **Marketdata error logging.** `GetLatestPrice` (`marketdata_service.go:600,606`) logs both failures with `slog.Warn("<RPC>: <what>
  failed", "symbol", …, "error", err)`. The warm poller logs the aggregate per-symbol fallback once
  (`"failed","fetched","total","sample_error"`, `:875-898`).
- **Agent timeout config.** `_extract_policy` (`tools.py:2324`) plus the `agent.extract.*_timeout_seconds` precedent.
- **Tests.**
  - Analysis fake marketdata: `svc._marketdata.BatchGetLatestPrice = AsyncMock(...)` (`tests/test_live_enrich_memo.py:31-40`).
  - Hang fake: `FakeComposer(hang_indicators=True)` uses `asyncio.sleep` past the deadline (`tests/test_pnl_pattern_consumer.py:158-170`).
  - Real RPC error: `grpc.aio.AioRpcError(code, Metadata(), Metadata(), details)` (`tests/test_unreadable_formula.py:33-36`).
  - Agent `_rpc_error(code, details)` (`tests/test_tools.py:929`).
  - Marketdata `fakeBatchPriceSource` / `fakeLatestTradeOnlySource` (`marketdata_service_test.go:1321-1382`) and the singleflight park
    pattern (`:1017,:1069`).

## Existing Business Rules (preserve / extend)

37 relevant rules: 36 are PRESERVE and 1 is EXTEND. **None is CHANGE.** The full digest is in the scenario-recon handback. The ones that bind design:

- **PRESERVE** `@AC-1 @feature-191` "BFF enforces a 30s gRPC deadline on ListOpportunities" (`services/xstockstrat-ui/acceptance/opportunities-latency-fix.feature`).
  Every analysis-internal bound must sum to well under 30s. Otherwise the UI gets DEADLINE_EXCEEDED instead of degraded rows.
- **EXTEND** `@AC-11 @feature-095` "An unavailable live quote omits the price field rather than fabricating it"
  (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`). A stalled enrichment is a new cause; the contract is unchanged.
- **PRESERVE** `@AC-15 @feature-095` (agent omits live_price, never 0); `@AC-14 @feature-095` and `@AC-7 @feature-199`
  (ranking and composite are the same enriched or unenriched).
- **PRESERVE** `@AC-1/@AC-5 @feature-185` (analysis) and `@AC-3` (UI), `@AC-10` (agent). `data_unavailable` means a compute failure only. A
  timed-out enrichment must **not** set it.
- **PRESERVE** `@AC-6 @feature-185` (a cold read returns an empty page with `computing`, never a synchronous wait); `@AC-7` (bounded
  compute_failed); `@AC-8/@AC-9 @feature-185` (read-time surgical recovery and readiness_cache written only on success).
- **PRESERVE** `@AC-1/@AC-11/@AC-13 @feature-190` (filters, `available_sources` and pagination cover the **whole** queue). A query
  limited to page_size would break these.
- **PRESERVE** `@AC-8/@AC-9 @feature-191` (enrichment makes one batch price RPC; memo TTL ≥ 15s); `@AC-5 @feature-177` (warm reads
  skip enrichment).
- **PRESERVE** `@AC-4 @feature-176` and `@AC-4 @feature-180` (read latency under backtest or materializer load, the pool envelope);
  `@AC-9 @feature-158` (refresh retry semantics).
- **PRESERVE** `@AC-8/@AC-16 @feature-225`. New UNAVAILABLE/DEADLINE statuses must not hide UNAUTHENTICATED/PERMISSION_DENIED.
- **PRESERVE** `@AC-4/@AC-5 @feature-191` (marketdata) and `@AC-3 @feature-178`. Logging must not turn an omitted symbol into an
  RPC error, and must not change the cold-symbol singleflight.
- **PRESERVE** `@AC-5 @feature-210` (platform). Deadlined calls still send the header trio.

## Dependencies

- **Proto/RPC:** none. `ListOpportunitiesResponse` and the error statuses are unchanged.
- **Migration:** none.
- **Config keys (new, names to be decided in design):**
  - an analysis key for the enrichment deadline;
  - an analysis key for the read bound or DB acquire/command bound;
  - an agent gRPC deadline (an `agent.*` key or a constant).
  - Each needs a row in its service `CLAUDE.md` and in the `docs/patterns/config-governance.md` per-feature log.
- **Inter-service edges:** agent → analysis (gRPC), analysis → marketdata (gRPC), marketdata → Alpaca (HTTP) and its DB. All already
  exist.
- **New env vars:** none expected. Any `DB_*TIMEOUT` env var is absent from `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml`,
  so adding one would need all three.

## Risks / Not-found

- **Doc and acceptance drift.** feature-191 @AC-8 says enrichment makes "one BatchGetLatestPrice **and one BatchGetBars**" call, but the code has
  removed the bars/sparkline fetch (analysis recon: enrichment calls only `BatchGetLatestPrice`). The analysis `CLAUDE.md:182` and
  `:457` are stale too: they mention the memo skipping `GetBars`, and give a TTL default of `10` where the code says `20`. Design decides whether 226 fixes these
  docs (it touches this path). Do not assume a bars call exists.
- **Memo after a timeout (open).** If a timeout is memoized as "fresh, no price", prices stay blank for the TTL after recovery. If it is not,
  every poll pays the full deadline again.
- **Pool bounds are service-wide.** asyncpg `timeout` (acquire) and `command_timeout` apply to the whole service: background
  refresh, materializer, backtests, migrations-adjacent work. A global `command_timeout` could abort long queries that are legitimate. A bound
  scoped to the read path is safer.
- **Pool exhaustion on a cold read (open).** @AC-6 @feature-185 promises `computing` for a never-materialized user. When the cold-check query cannot
  get a connection, UNAVAILABLE is the proposed reading. Confirm in design.
- **Singleflight ctx.** marketdata's singleflight runs with the first caller's ctx. A per-caller deadline in analysis does not cancel
  the shared closure. Bounding the fallback inside marketdata (with its own deadline) is what actually stops a 5 × 30s chain.
- **Nil `cfg` in marketdata tests.** Reading a new marketdata key through `s.cfg` needs a nil guard or test changes.
- **Root-cause trigger unconfirmed** (DB saturation vs Alpaca stall). The design must bound both, not bet on one.
- **Not found.** Any existing deadline helper in analysis, indicators or ingest. Any gRPC `timeout=` in analysis or the agent. Any asyncpg
  acquire or command timeout anywhere. Any `marketdata.*timeout*` key. Any test faking a hanging marketdata RPC or a slow DB for
  ListOpportunities. Any DEADLINE_EXCEEDED branch in the agent's error mapper.
- **Ledger.** fails.md has no entry directly on deadlines. The applicable general rules are: "an unexecuted gate is a claim, not a check" (tests
  must actually simulate a hang); and C-16 regression guarding.

## Recommended Scope

1. **marketdata:** log every discarded error in `BatchGetLatestPrice`, using the existing patterns. Bound the per-symbol fallback (a ctx deadline, and/or
   concurrency) so it cannot chain past the analysis enrichment deadline. Tests first: multi-call error, repo error, and hang.
2. **analysis:** a deadline on the `BatchGetLatestPrice` enrichment call (from config) that degrades to unenriched rows and logs; no memo of failures (decide).
3. **analysis:** a bound on the read itself (a whole-handler `wait_for` from config that fits under the BFF's 30s, plus a scoped DB acquire bound)
   → `DEADLINE_EXCEEDED` / `UNAVAILABLE` with a log line. The identity gate runs first.
4. **agent:** a deadline on `ListOpportunities` (the client `timeout=`, under 60s) and a DEADLINE_EXCEEDED case in `_grpc_error_message`.
5. **Docs:** config rows, analysis CLAUDE.md drift (TTL default, removed bars), and the config-governance log.
