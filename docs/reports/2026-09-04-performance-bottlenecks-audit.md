# Performance & Concurrency Bottleneck Audit — 2026-09-04

**Scope**: Whole-platform read-only codebase audit for performance bottlenecks, with an explicit
concern about **concurrency under multi-user load**. Prompted by three observations:

1. The **Opportunities** list (`/insights/opportunities`) is slow — the page shell renders but the
   list is slow to populate.
2. The **Watchlist** stock list (`/insights/watchlists`) has the same symptom — shell renders, list
   lags.
3. **Halted accounts**: a resume RPC exists but (per the report) there is no way to trigger it and
   no indicator that an account is halted until an order placement fails.

Codebase-based audit (read-only; no live session against the deployed DigitalOcean app or staging
MCP). GitHub Issues are disabled on this repo, so per `docs/runbooks/bug-triage.md` this report is
the audit trail. **Nothing here has been fixed** — this document tees up the remediation as SDD
tracks (§6). Individual findings that are confirmed defects may alternatively route through
`/sdd-triage --from-report docs/reports/2026-09-04-performance-bottlenecks-audit.md`.

---

## 0. Root-cause thesis

Both slow-list symptoms **and** the multi-user concurrency concern collapse onto **one
architectural fault line**:

> The Python `xstockstrat-analysis` (and `xstockstrat-indicators`) services perform **serial
> cross-service RPC fan-out and CPU-bound / blocking work directly on a single asyncio event
> loop**, then funnel that fan-out through a **process-global bars-fetch semaphore of 2** and
> **2-connection DB pools**.

Consequences:

- **Lists are slow** because the data path is a *sequential* RPC storm (one round-trip per
  candidate/symbol, and one more per strategy component), not a parallelized batch.
- **It degrades per concurrent user** because the serialization points (event loop, semaphore=2,
  per-process locks) are **process-global**, not per-request. Latency scales with the number of
  active users instead of staying flat — the exact failure mode the multi-user concern predicts.

The DB **pool budget itself is sound** and correctly implemented (sizes match the root
`CLAUDE.md` § Connection Pool Budget; PgBouncer transaction-mode assumptions handled; BFF gRPC
clients are singletons). The problem is **application-level serialization**, not pool
misconfiguration.

---

## 1. Symptom 1 — Opportunities list is slow

**Call chain**: `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:98`
→ `useOpportunities(0)` (`src/hooks/useOpportunities.ts:16`, **`refetchInterval: 15_000`** — polls
every 15s per open tab) → BFF `forward(...)` (`src/lib/insightsBff.ts:54`, no caching/dedup) →
analysis `ListOpportunities` (`services/xstockstrat-analysis/app/handlers/servicer.py:2948`).

| # | Sev | Finding | Evidence |
|---|---|---|---|
| 1.1 | **Critical** | **Serial per-candidate fan-out.** `_compute_opportunities` runs `for c in selected:` over up to **100** candidates (`analysis.opportunity.max_universe_size`, default 100), each `await`ing paged `GetBars` + benchmark bars + `evaluate_conditions_traced` — which itself issues one indicator RPC **per component, serially**. Cold load = hundreds of sequential cross-service round-trips on the request's critical path. | `servicer.py:3385-3436` (loop), `:3358` (cap), `:3401/3414/3423`; `app/services/evaluator.py:234-247,261,276` |
| 1.2 | **High** | **Cold compute runs synchronously on the read path**, and empty-universe users never cache. `replace_for_user` delete-then-inserts, so a user whose universe legitimately yields **zero** rows keeps `count_for_user == 0` forever and **re-runs the full synchronous compute on every 15s poll**. | `servicer.py:2975-2981,3085`; `app/repositories/opportunities.py:41-75` |
| 1.3 | **High** | **Warm reads still fan out.** `_enrich_opportunities_live` runs **unconditionally** after every read (cold or fresh): 2 marketdata RPCs (`GetLatestPrice` + `GetBars`) × ~50 page symbols, **every poll, every user** — steady-state load unrelated to cold start. | `servicer.py:3000,3023-3069` |
| 1.4 | **High** | **Process-global semaphore of 2.** `_bars_fetch_sem = asyncio.Semaphore(2)` is one singleton shared across **all users** and **both** compute + enrichment. All marketdata fan-out platform-wide contends for 2 slots → per-user latency grows ~linearly with concurrent active users. (Sized to 2 to protect TimescaleDB per feature 141; that same cap serializes throughput.) | `servicer.py:391-393,3399,3419,3028,3042` |
| 1.5 | Medium | **No SQL pagination** — `read()` returns every matching row, then the servicer slices in Python (`rows[offset:offset+page_size]`); the full queue is transferred + JSON-decoded regardless of page size. | `opportunities.py:77-122`; `servicer.py:2995` |
| 1.6 | Medium | **Ranking `ORDER BY` is a computed expression the index cannot serve** (`(1-$3)*conviction + $3*signal_axis`); the only index is `(user_id, valid_until)`. Postgres sorts every qualifying row in memory each read. | `opportunities.py:114`; `migrations/011_opportunities.up.sql:24` |
| 1.7 | Medium | **Per-request indicator recomputation** — a fresh `StrategyEvaluator` per pass with only per-pass caches; the same `(symbol, strategy, indicator)` is recomputed from scratch on every cold read / stale pass / daily refresh with no cross-pass memoization of deterministic series. | `servicer.py:3372`; `evaluator.py:249-312` |
| 1.8 | Low | Background recompute guards (`_opportunity_recomputing` set, `_opportunity_locks`) are **per-process** — correct at `instance_count:1`, but horizontal scaling would let N replicas each run the heavy compute for the same user. | `servicer.py:3090-3106` |

## 2. Symptom 2 — Watchlist stock list is slow

**Call chain**: `src/app/insights/watchlists/page.tsx` → `useWatchlists` → portfolio
`ListWatchlists` (50052); then per-strategy `EvaluateReadiness`
(`WatchlistReadiness.tsx:193`, `useQueries` one per distinct strategy) → analysis
`EvaluateReadiness` (`servicer.py:2660`) → marketdata `GetBars` + indicators `ComputeIndicator`/
`ExecuteFormula`.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| 2.1 | **Critical** | **Serial per-symbol loop — with neither `gather` nor the semaphore.** `EvaluateReadiness` has the same `for symbol` shape as §1.1, but unlike its opportunity siblings it does **not** parallelize and does **not** bound via `_bars_fetch_sem`. N symbols = N serial `GetBars` + N serial trace passes, holding a gRPC worker the whole time. This is the outlier in the file. | `servicer.py:2702-2721`; contrast `_enrich_opportunities_live` at `:3069` which uses `asyncio.gather` |
| 2.2 | **High** | **Per-component indicator RPCs nested in the loop** — one `ComputeIndicator`/`ExecuteFormula` per component per symbol, awaited serially. Backend calls ≈ `Σ_symbols (1 GetBars + C component RPCs)`, all serialized. | `evaluator.py:234-241,249,261,276` |
| 2.3 | **High** | **Full 400-day OHLCV fetched per symbol to read only the last bar.** `_READINESS_LOOKBACK_DAYS = 400`, page size 1000, ~280 trading bars × full OHLCV marshalled over gRPC per symbol per call, while readiness evaluates only `bars[-1]`. `GetLatestPrice` exists but can't be used because indicators need the window — cost is unavoidable *given the current recompute design* (→ 2.4). | `servicer.py:245,237`; `evaluator.py:244` |
| 2.4 | **High** | **No caching, server- or client-side.** Unlike `ListOpportunities` (lazy compute-on-read + stale-while-revalidate + materialized store), `EvaluateReadiness` is a pure recompute every call, and the client sets **no `staleTime`**, so every mount/refetch re-triggers the full serial fan-out. | `WatchlistReadiness.tsx:193` |
| 2.5 | Medium | **N+1 in portfolio `ListWatchlists`** — after one `SELECT ... FROM portfolio.watchlists`, it loops each watchlist issuing a separate `listBindings(watchlist_id)` query. 1 + N queries (bounded by `portfolio.watchlist.max_per_user = 50`) on a 2-conn pool. Index is fine; this is query-count overhead, collapsible to a `WHERE watchlist_id = ANY(...)` / JOIN. | `internal/repository/watchlist_repo.go:132-139,397` |
| 2.6 | Medium | **2-conn pools amplify the serial fan-out** — readiness fires many serial `GetBars` at marketdata while every user shares marketdata's 2 connections; the serial handler holds its slot longer, compounding contention. | `marketdata/.../pool.go:15`, `portfolio/.../pool.go:15` |
| — | Low | **Indexes are adequate** — `marketdata.ohlcv` PK `(symbol,timeframe,time)` + `idx_ohlcv_symbol_time` serve the readiness query; `watchlist_symbols` PK serves the N+1 subquery. Degradation is serial app-level fan-out + no caching + tiny pools, **not** slow individual queries. | `marketdata/migrations/001:20,31`; `004` (chunk widen) |

## 3. Multi-user concurrency — the real scaling wall

Beyond the two symptom paths, the following process-global serialization points determine how the
platform behaves under simultaneous users.

| # | Sev | Service | Finding | Evidence |
|---|---|---|---|---|
| 3.1 | **Critical** | indicators | **Blocking `subprocess.run` on the asyncio event loop.** The `async` `ExecuteFormula` handler calls `sandbox.execute_formula`, which runs a **synchronous** `subprocess.run(..., timeout=timeout_ms/1000)` with **no** `run_in_executor`/`to_thread`. The service processes exactly **one formula at a time**; one slow/looping user formula stalls every other user's `ExecuteFormula` **and** `ComputeIndicator` for up to `indicators.sandbox.timeout_ms=5000`ms. The documented `indicators.sandbox.max_concurrent` is "documented, not yet enforced" — and moot while the loop is pinned to 1. | `app/handlers/servicer.py:139`; `app/services/sandbox.py:188` |
| 3.2 | **High** | analysis | **CPU-bound compute on the event loop.** `RunBacktest` + simulators run pure-Python per-bar loops directly in the async handler (no executor). While a backtest / `ScreenSymbols` / cold `ListOpportunities` compute runs, the single loop cannot service the live evaluation loop, `GetStrategyAnalytics`, or any other user's RPC. One user's multi-symbol backtest freezes decide-surface reads + live alerting for **all** users. | `servicer.py:537,1191,1222,1481,1523,1611`; `app/engine/live_loop.py` |
| 3.3 | **High** | analysis | **Per-user compute lock doesn't contain the blast radius.** `_opportunity_lock(user_id)` correctly serializes per-user, but a cold read computes **synchronously on the shared loop under that lock** — so it blocks all users, not just the lock holder (compounds 3.2). | `servicer.py:3073,424` |
| 3.4 | **High** | portfolio | **N+1 sequential `GetLatestQuote` per position** on every hot read (`ListPositions`, `GetPortfolio`, `GetPnL`, `ListPortfolios`). marketdata already batches quotes *internally* (`MultiSymbolSource`/`GetLatestQuotesMulti`, Alpaca REST, used by its own warm poller) but exposes **no batch quote gRPC RPC** — only singular `GetLatestQuote` on `marketdata.proto`. So the fix requires **adding an additive batch-quote RPC** to marketdata (see Track C), not merely adopting an existing one. Latency grows linearly with position count × concurrency; each cold quote can trigger a live Alpaca call (→ 3.7). | `internal/service/portfolio_service.go:325-339,522,692,731,1038`; `packages/proto/marketdata/v1/marketdata.proto` (only `GetLatestQuote`); internal helper `internal/source/source.go`, `internal/alpaca/client.go` |
| 3.5 | Medium | ledger | **All platform event appends serialize through one DB connection** (`DB_POOL_MAX=1`); `AppendEvent` holds that connection for a full `BEGIN`/claim-insert/`COMMIT`. Deliberate budget decision (streams correctly decoupled onto a dedicated LISTEN conn via `EventNotifier`), but append throughput is capped at one connection's transaction rate under write bursts. | `src/index.ts:43`; `src/grpc/ledgerServiceImpl.ts:74` |
| 3.6 | Medium | config | **Broadcast does sequential per-subscriber DB queries** — `broadcastToSubscribers` iterates subscribers awaiting `snapshotForSubscriber` one at a time; per-user subscribers each hit `resolveOverlayValues` → `pool.query` on `max=2`. A `SetConfig` with many per-user WatchConfig subscribers = N serialized round-trips before broadcast completes. Writes only (infrequent), bounded impact. | `src/grpc/configServiceImpl.ts:207-221,180-185` |
| 3.7 | Low | marketdata | **No single-flight on cold-symbol live fallback.** The stale-refetch guard covers only already-known `(symbol,timeframe)`; a first-ever symbol has no guard and there is no `singleflight`/errgroup in the service. Concurrent first requests for the same cold symbol each fire an independent live Alpaca fetch — thundering herd, amplified by 3.4. | `internal/service/marketdata_service.go:49` |
| 3.8 | Low | identity | bcrypt cost-10 runs async (non-blocking to the JS loop) but occupies one of the **default 4** libuv threads; a burst of >4 simultaneous logins queues (`UV_THREADPOOL_SIZE` untuned). Auth path only. | `src/grpc/identityServiceImpl.ts:86,658,716` |
| 3.9 | Medium | agent | Fresh gRPC channel created + torn down **per backend call** (≈50 sites) — a full TCP+HTTP/2+settings handshake per MCP tool invocation. Documented invariant (AGENT-1, "ephemeral per-call channels"); flagged as a multi-user scalability tradeoff (connection churn), not a defect. | `app/client.py` (per-call `grpc.aio.insecure_channel`); `app/auth.py:35,67` |

**Verified NOT problems** (ruled out): DB pool sizes match the documented budget across all
services; PgBouncer transaction-mode assumptions correctly handled (`QueryExecModeExec` /
`statement_cache_size=0`; no LISTEN/NOTIFY on pooled conns); UI BFF gRPC clients are module-level
singletons (`connectClients.ts:31-40`); in-memory mutexes guard only short map/slice mutations,
never held across a DB query or external call.

## 4. Halted accounts — premise is partly outdated; residual gap is UI-only

Features **169** (resume-halted-account, launched 2026-09-02) and **102** (halt indicator + source)
already landed. Current reality:

| Capability | State | Evidence |
|---|---|---|
| Resume RPC (`ResumeAccount`, admin-only, idempotent) | ✅ Implemented | `packages/proto/trading/v1/trading.proto:43`; `internal/handler/trading.go:321`; `internal/service/trading.go:2748` |
| Agent **trigger** (`manage_account` `resume` op) | ✅ Implemented | `xstockstrat-agent/app/tools.py:1664`; `app/client.py:2000` |
| Agent **indicator** (`list_accounts.halted`) | ✅ Implemented | `app/client.py:1730` |
| UI **indicator** on positions page | ✅ Implemented | `src/app/trader/positions/page.tsx:352-371` |
| **UI trigger** (Resume button + BFF route) | ❌ **Missing** | no `resumeAccount` in `traderBff.ts:51-55`; no resume hook/button under `src/components/trader` or `src/lib` |
| Halt indicator on **account-management** surfaces | ❌ **Missing** | `AccountsModule`/`AccountSelector`/`accountShared` render only `credentialStatus` |

**Performance note**: the per-order halt check `isAccountHalted` is a cheap **in-memory map lookup
under a mutex** (`trading.go:2431-2434`), boot-hydrated — *not* an expensive DB/broker round-trip.
So "discover halt only when an order fails" is a **UX gap, not a perf cost**: the same halt state
(`BrokerAccount.halted/halted_at/halt_reason/halt_source`, proto fields 9–12) is already returned by
`ListBrokerAccounts` and can be surfaced proactively — the agent and the positions page already do.

**Halt SET paths** (for completeness): `haltAccount()` (`trading.go:2463`) is called by
bracket-protection flatten failure (`flattenAndHalt`, `:2583`, `HALT_SOURCE_BRACKET_PROTECTION`)
and reconciliation mismatch (`emitReconciliationFinding`, `:1702`, `HALT_SOURCE_RECONCILIATION`).
Only `ResumeAccountSvc` clears it.

**Residual gap** = exactly what feature 169 declared out of scope (`product-spec.md:37,52`: "UI for
resuming accounts … may add a 'Resume' button in a follow-up"). Two items: (a) a browser-side
Resume trigger, and (b) the halt badge belongs beside the account-management controls where an
operator acts, not only on the positions page.

**Minor correctness note** (not perf): the RPC enforces **admin-only** (`RequireAdminScope`,
`trading.go:2749`) whereas feature 169 FR-5 specified **operator or admin** — a scope discrepancy
already flagged obliquely in `docs/context-constitution-findings.md`.

## 5. Priority ranking (by blast radius under multi-user load)

1. **§3.1** indicators event-loop-blocking `subprocess.run` — pins the whole formula/indicator
   surface to concurrency 1; every strategy evaluation depends on it.
2. **§1.1 / §2.1** serial per-symbol/per-candidate fan-out in analysis — the direct cause of both
   slow lists.
3. **§3.2 / §3.3** CPU-bound backtest/screener/opportunity compute on the analysis loop — one
   user's heavy job freezes the service for all.
4. **§1.4** process-global `_bars_fetch_sem = 2` — the throughput choke that makes (2) scale with
   user count.
5. **§2.4 / §1.2 / §1.3** missing/incomplete caching + poll discipline (empty-universe recompute,
   unconditional warm enrichment, no client `staleTime`).
6. **§3.4 / §2.5** portfolio/marketdata N+1 (batchable via a **new** additive marketdata batch-quote RPC + `ANY`-array binding query).
7. **§3.7** marketdata cold-symbol single-flight; **§4** UI resume trigger + halt surfacing;
   **§1.5–1.7, §3.5–3.9** remaining medium/low items.

## 6. Recommended remediation — SDD tracks

Each track below is capability/behavior work and therefore enters through the SDD pipeline
(`/sdd-story <slug>` → `/sdd-design <slug> quick`) per the root `CLAUDE.md` mandatory entry point —
**not** a direct code change. Confirmed-defect sub-items (e.g. §1.2 empty-universe recompute) may
alternatively route via `/sdd-triage` as bug fixes.

### Track A — Analysis fan-out parallelization + event-loop offload *(highest leverage)*
Addresses §1.1, §2.1, §2.2, §3.1, §3.2, §3.3, §1.4. Parallelize the serial per-symbol / per-
candidate / per-component loops with `asyncio.gather` under a **bounded** semaphore (reuse/rename
`analysis.opportunity.max_concurrent_bars_fetches`, and extend it to `EvaluateReadiness` which
currently bypasses it); offload CPU-bound compute (backtest simulators, opportunity compute) and the
indicators sandbox `subprocess.run` off the event loop via `asyncio.to_thread` / a bounded executor.
**Design forks to resolve in `/sdd-design`**: semaphore sizing vs. the TimescaleDB shared-memory
limit that motivated =2 (feature 141); executor pool sizing vs. the 2-conn DB budget; whether to
enforce `indicators.sandbox.max_concurrent` at the same time.

### Track B — Caching + poll discipline
Addresses §2.4, §1.2, §1.3, §1.7. Materialize/cache readiness the way Opportunities already is;
cache the empty-universe result (stop the every-15s recompute); make warm-poll live enrichment
conditional rather than unconditional; add a client `staleTime` to the readiness `useQueries`.

### Track C — Portfolio/marketdata N+1 batching
Addresses §3.4, §2.5, §3.7. Add an **additive batch-quote gRPC RPC** to marketdata (wrapping the
existing internal `MultiSymbolSource`/`GetLatestQuotesMulti` Alpaca-REST helper — thin server work,
but a real proto addition + approval gate) and switch `enrichPositions` to it; collapse
`ListWatchlists` `listBindings` into one `ANY`-array query; add `singleflight` to marketdata cold-
symbol live fallback.

### Track D — UI resume button + halt surfacing
Addresses §4. Add a `resumeAccount` BFF route + Resume control, surface the halt indicator beside the
account-management controls, and (separately) reconcile the admin-only vs. operator-or-admin scope
discrepancy against feature 169 FR-5.

---

*This report is read-only analysis. No service code, proto, migration, or context file was modified
in producing it.*
