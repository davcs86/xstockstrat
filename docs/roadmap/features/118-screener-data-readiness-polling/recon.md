# Recon: screener-data-readiness-polling

**Created**: 2026-08-08
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (certain), `xstockstrat-analysis` (conditional on design), `xstockstrat-marketdata` (read-only fact-finding, no changes expected)

---

## Objective

When a Screener result is `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` (fundamentals-pending or
bars-insufficient — already distinguished by `gap` presence per PR #902), automatically re-check
in the background and update the badges live, covering both `SCREEN_KIND_FUNDAMENTAL` and the
technical kinds, without persisting scan state or building new notification infrastructure.

## Codebase Map

- **`xstockstrat-ui`** (TypeScript/Next.js)
  - Current scan hook: `useScreenSymbols` — `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts:9-16`, a plain `useMutation` (comment: "not a polling query", line 8). No `refetchInterval`.
  - Consumer: `services/xstockstrat-ui/src/app/insights/screener/page.tsx:79` (`const screen = useScreenSymbols()`), invoked via `screen.mutate(...)` at `page.tsx:113` in `runScan()`.
  - Existing pending-badge logic (PR #902, already shipped): `pendingFundamentals` derivation at `page.tsx:152-154` (`results.filter(r => r.status === ScreenResultStatus.INSUFFICIENT_DATA && !r.gap)`); badge branch at `page.tsx:509-522` ("Fundamentals pending" when `!r.gap`, "Insufficient data" when `r.gap` present); banner at `page.tsx:438-446`.
  - `TOP_N` UI-only-constant precedent (not a WatchConfig key, "Floor F-07 unaffected") — `page.tsx:58-60`.
  - Config-read pattern: N/A — this page reads no WatchConfig keys today; all its constants are plain TS.

- **`xstockstrat-analysis`** (Python)
  - Handler: `ScreenSymbols` RPC — `services/xstockstrat-analysis/app/handlers/servicer.py:1876-1928`, wraps `ScreenerEngine.screen()` in `asyncio.wait_for` with a config-driven deadline (`servicer.py:1905`, `analysis.screener.max_duration_seconds`), synchronous request→response, **no `job_id`, no status-polling RPC**.
  - Engine: `services/xstockstrat-analysis/app/services/screener.py:88-162` (`screen()`), symbols `:90`, criteria `:92`, per-symbol loop `:112-123` — no "already resolved" filtering; every call re-evaluates the full symbol+criteria lists passed in.
  - Fundamentals-unavailable bail (PR #902): `screener.py:225-228`. Bars-insufficient bail (parallel, existing): `screener.py:210-219`. Hard-filter fail-closed: `screener.py:418-450`.
  - Config-read pattern: `cfg.get_int("analysis.screener.<key>", <default>)` — 4 existing sites: `screener.py:85,89,156-158`, `servicer.py:1905`.
  - Last migration: not surveyed this pass (no DB changes are planned per product-spec FR-7; `ls services/xstockstrat-analysis/migrations/` must still be run at `/sdd-spec` time if this changes — `durable-observable-backfills` ledger trap).

- **`xstockstrat-marketdata`** (Go) — read-only fact-finding only, no changes expected
  - `GetFundamentalsMulti` — `internal/service/marketdata_service.go:862-922`; gate `:863-865` (`fundamentalsEnabled()` → `FailedPrecondition`, no FMP call, at `:965-969`); TTL cache-hit `:880-883`; daily-cap-exhausted → **serves stale/drops, never errors** `:893-899`; live fetch `:900-912`.
  - `GetBars` — `internal/service/marketdata_service.go:110-173`; unconditional `markWarm(req.Symbol)` at `:112`; first-page-miss live-fallback trigger `:165-166`; `fetchAndCacheBars` `:180-211`, failure branch `:187-193` writes nothing (**no negative cache/tombstone anywhere in `internal/`**).
  - `StartBarIngestPoller` — `:472-496`, iterates `s.warmSymbols` (`:520-527`); `markWarm` — `:378-385`, called by both `GetBars:112` and `GetLatestQuote:355`.

## Patterns to REUSE

- **Terminal-state polling** → reuse the exact `refetchInterval`-as-function-of-current-data shape
  from `useBackfillStatus` — `services/xstockstrat-ui/src/hooks/useBackfills.ts:14-21` (`isTerminal()`
  helper) + `:35-45` (`refetchInterval: (query) => { ...; return isTerminal ? false : 4000; }`). This
  is a `useQuery`, not a `useMutation` — converting/wrapping `useScreenSymbols` similarly (or adding a
  sibling polling hook) is the direct precedent, not a novel pattern.
- **UI-only cadence constant** → reuse the `TOP_N` pattern (`page.tsx:58-60`, explicit comment "not a
  WatchConfig key, Floor F-07 unaffected") if design lands on a client-only constant rather than a
  config key.
- **Existing fundamentals-unavailable test shape** → reuse/extend
  `test_fundamentals_unavailable_yields_insufficient_data` —
  `services/xstockstrat-analysis/tests/test_screener.py:132-161` (`AsyncMock(side_effect=grpc.RpcError())`
  pattern) for a new "resolves on the second call" test via `AsyncMock(side_effect=[grpc.RpcError(),
  SimpleNamespace(fundamentals=[...])])` or two sequential `.screen()` calls with the mock reconfigured
  between them.
- **Test scaffolding to reuse, not rebuild** → `make_cfg`/`bars`/`formula_criterion`/`make_engine`
  helpers (`test_screener.py:15-52`); `TestScreenSymbols._ctx`/`_svc`/`_bars` (`test_analysis_servicer.py:870-902`).
- **E2E per-test mock override** → reuse the `page.route(...)` closure-capture pattern already used in
  `screener.spec.ts` (e.g. `mockScreen()` at `screener.spec.ts:7-23`) for a new test; there is **no**
  existing stateful/call-counted mock response anywhere in `mock-backend.ts` (confirmed absent — see
  Risks below), so a new test needs its own local mutable counter inside a `page.route` handler, not a
  shared `mock-backend.ts` change.
- **Fixture home** → `e2e/fixtures/INVENTORY.md:57` lists Screener results as defined inline in
  `mock-backend.ts`, not centralized — Constitution C-12 only forces centralization on a *second*
  consumer of the same literal; a one-off stateful test-local mock stays inline and compliant.

## Dependencies

- Proto/RPC: `ScreenSymbolsRequest` (`symbols=1..evaluation_window=8`, next free field = **9**),
  `ScreenResult` (`symbol=1..held=11`), `ScreenSymbolsResponse` (`results=1, coverage_gaps=2`) —
  `packages/proto/analysis/v1/analysis.proto:357-403`. **No subset/partial-recheck field exists
  today** — confirmed absent by direct read, not by grep. Whether this feature adds one is the
  central Phase 1 design question (product-spec Open Questions).
- Migration: none planned (product-spec FR-7); `ls services/xstockstrat-analysis/migrations/` must
  be re-run at `/sdd-spec` time if design overturns this (ledger trap, see Risks).
- Config keys: existing `analysis.screener.*` (max_universe_size, max_duration_seconds,
  default_rank_limit, max_concurrent_formula_evals) unaffected; a new
  `analysis.screener.recheck_interval_seconds`-shaped key does **not** exist yet anywhere in code
  or `CLAUDE.md` — confirmed absent, would be new if design chooses config-governed cadence over a
  UI constant (product-spec Open Question).
- Inter-service edges: unaffected — Screener already calls marketdata (`GetBars`,
  `GetFundamentalsMulti`) and indicators (`ComputeIndicator`/`ExecuteFormula`) per-scan; polling
  just increases call *frequency* along existing edges, adds no new edge.
- New env vars / ports: none anticipated.

## Risks / Not-found

- **No visibility-aware polling pattern exists anywhere in `xstockstrat-ui`** (`document.visibilityState`,
  `usePageVisibility`, TanStack `refetchIntervalInBackground` — all confirmed zero-hit across
  `services/xstockstrat-ui/src/`). Product-spec FR-5 assumed one might exist to reuse; it must be
  built from scratch or the design must justify why it's unneeded (e.g. a low-enough cadence +
  hard cap makes it unnecessary).
- **No client-side "stop polling" UI precedent.** The backfills page's cancel button
  (`backfills/page.tsx:59,95,127-129,324-331`) cancels a *server-side* job via RPC — a materially
  different shape from "stop a local poll loop." FR-6's affordance has no existing pattern to copy
  verbatim.
- **No stateful/call-counted mock exists in `e2e/mock-backend.ts`** (grep for `callCount`/`let call`/
  `callsByKey` → zero hits; the `screenSymbols` handler at `mock-backend.ts:709-753` is fully
  stateless/deterministic today). A polling-resolves-over-time e2e test needs a new per-test
  `page.route` closure counter — confirmed no shortcut exists.
- **`GetFundamentalsMulti`'s daily-cap-exhausted behavior degrades silently** (serves
  stale/drops symbols, `marketdata_service.go:893-899`) rather than erroring — unlike the
  single-symbol `resolveFundamentals` sibling, which returns `ResourceExhausted`
  (`:941-946`). A naive full-rescan poll running after quota exhaustion would get back the *same*
  stale/incomplete `criterion_scores` on every poll and could loop until the max-attempts cap
  without ever truly resolving — this is a real corner case FR-4's cap must handle gracefully
  (report "still pending, gave up" rather than implying success).
- **Existing FMP consumer to budget against**: `xstockstrat-analysis`'s fundsignal loop already
  calls `GetFundamentalsMulti` on its own schedule (`analysis.fundsignal.run_interval_hours` default
  24h, `daily_call_budget` default 200 — `fundsignal_loop.py:82-86,257-258`;
  `services/xstockstrat-analysis/CLAUDE.md:177-182`) against the *same* shared 250/day cap. A
  Screener poll design must be sized so it can't starve that budget, especially since a single
  screener scan can already cover up to `analysis.screener.max_universe_size` (100) symbols per
  call.
- **`marketdata.backfill.rate_limit_rps` (200, per CLAUDE.md:64) was not independently re-verified
  in code this pass** — the marketdata recon agent opened `marketdata_service.go` only, not the
  rate-limiter construction site. Flagged so `/sdd-spec` re-confirms if the chosen cadence design
  is sensitive to the exact Alpaca RPS budget (unlikely at UI-poll-interval scale, but noted per
  P-03 rather than silently assumed).
- **Ledger trap (`fix-mcp-screener-correctness`)**: if design touches `coverage_gaps` or any other
  full-result-set diagnostic in `screener.py` again, it must be computed from the full ranked list
  *before* `min_conviction`/`rank_limit` truncation — this exact mistake already happened once.
- **Ledger trap (`durable-observable-backfills`, migration category)**: never assume the next
  migration `NNN` — always `ls` the directory first. Only relevant if design overturns the
  no-DB-changes default (FR-7).
- **Ledger trap (`watchlist-management`, assumption category)**: the pinned `@playwright/test`
  expects a browser build not present in the base image locally; this session already found and
  documented the workaround (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` +
  `CI=true` env vars) — carry forward for `/sdd-execute`'s e2e verification, don't rediscover it.

## Recommended Scope

Advisory only — not binding, input to Phase 1 grilling and `/sdd-spec`:

1. **UI-only, client-poll-against-existing-RPC** (if Phase 1 favors simplicity over quota
   precision): convert/wrap `useScreenSymbols` into a query-capable hook with a terminal-state
   `refetchInterval` (reusing the `useBackfillStatus` shape) that re-issues the *same*
   `ScreenSymbols` request; gate cadence conservatively (much slower than `useBackfills`' 4s,
   given the shared FMP quota risk) and cap total attempts/duration; add visibility gating; add a
   visible "checking… / stop" affordance; extend `screener.spec.ts` + a new stateful
   `page.route` mock for the resolves-over-time case.
2. **Narrower server-side recheck** (if Phase 1 judges full-rescan-on-poll an unacceptable quota
   risk): add a new `ScreenSymbolsRequest` field (next free number: 9) scoping a recheck to
   specific `(symbol, ref_name)` pairs still pending, threading through `screener.py`'s per-symbol
   loop to skip already-resolved criteria; proto + servicer + engine + UI hook changes, more
   surface area but avoids re-spending fundamentals/technical-criteria compute and FMP calls on
   symbols that already succeeded.
3. Either way: a `context.md`-recorded decision on config-key vs. UI-constant for the poll cadence,
   and explicit numbers (not "reasonable defaults") backed by the FMP 250/day and fundsignal-loop
   200/day-budget math above.
