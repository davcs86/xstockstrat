# Recon: opportunity-universe-unification

**Created**: 2026-08-03
**From**: product-spec.md
**Affected services**: `packages/proto`, `xstockstrat-analysis`, `xstockstrat-portfolio`, `xstockstrat-ui`, `xstockstrat-agent`

---

## Objective

Unify the Decide → Opportunities queue's three symbol-origins (active signals, held positions, watchlist
entries) into one per-user Universe evaluated through a single signal-free readiness kernel (entry **and**
exit rules), with a stable opportunity identity and server-persisted snooze/dismiss/take. Signals become a
universe + independent ranking axis only (Option 2 — retire `signal_weight`/`signal_sources` from the
strategy definition), and watchlists change shape from a bare symbol list into `(symbol, strategy_id)`
bindings.

## Codebase Map

- **`packages/proto`**
  - `portfolio.Watchlist` — `packages/proto/portfolio/v1/portfolio.proto:168` (fields 1–7; `repeated string symbols = 5`; next-free **8**). CRUD reqs: `CreateWatchlistRequest:180` (next-free 4), `UpdateWatchlistRequest:205` (next-free 5), `AddWatchlistSymbolsRequest:220`/`RemoveWatchlistSymbolsRequest:228` (next-free 3).
  - `analysis.Opportunity` — `analysis.proto:437` (fields 1–9; next-free **10**). `OpportunityActionTag:419` (next-free 4), `ConditionState:427`, `SymbolReadiness:460` (next-free 6), `ConditionEval:450`.
  - Deprecation targets: `StrategyDefinition.signal_params = 6` (`analysis.proto:253`, also in `ManageStrategyRequest.update_mask` allowed paths `:289`); `ScreenSymbolsRequest.signal_sources = 3`/`signal_weight = 4` (`:381-382`). `StrategyAnalytics.taken = 6`/`queue_share = 7` (`:472`) — populate only, no edit.
  - RPC message seams for snooze/provenance: `ListOpportunitiesRequest:484` (next-free 3), `EvaluateReadinessRequest:493` (next-free 3).
  - Breaking gate: `packages/proto/buf.yaml` (v1, lint-only) + CI `.github/workflows/ci.yml:86,106` `buf breaking . --against`.
- **`xstockstrat-analysis`** (Python)
  - `ListOpportunities` — `app/handlers/servicer.py:2006`; universe = active signals only (`_drain_active_signals:2070`), held only sets action (`_drain_held_symbols:2096`, `_action_for:2225`); `strategy_id=""`/`passing/total=0/0` hardcoded `:2042-2046`; dedup `best[symbol]:2049`.
  - Readiness kernel `evaluate_conditions_traced` — `app/services/evaluator.py:171`; traces **entry_rule only** (`:202-205`); `signals_map` reserved/unused (`:176-177`). Rollup helpers `_iter_leaves:521`, `_eval_leaf_traced:567`, `_readiness_from_evals:612`, `_conviction_ordinal:589`. Exit-rule trace plug-in point mirrors `:202-206` (exit_rule already loaded at `:158` in `evaluate_with_series`).
  - Signal blend `scoring.py:58` (`technical_weight*(…)+signal_weight*signal_score`); params parsed `servicer.py:319-322` (normalized `:324-328`); backtest QuerySignals gated `servicer.py:813`; blend calls `:903-908`.
  - `EvaluateReadiness:1974`; `GetStrategyAnalytics:2124` (`queue_share=0.0` `:2183`; `taken` from trading `ListOrders` `:2165-2172`).
  - Last migration: `009_strategy_cooldowns.up.sql` → next-free **010**. Pool: `main.py:48` (max 2). Repo pattern: `app/repositories/backtest_runs.py:19`; best-effort write `servicer.py:1449-1472`.
  - Config helpers `app/config/watcher.py:60,68,84` (zero-trap); `analysis.signals.source_weights` read `servicer.py:272-281,1905-1913`.
  - Live loop `app/engine/live_loop.py:146` — pure rule eval, `signals_map=None`.
- **`xstockstrat-portfolio`** (Go)
  - Watchlist storage = **join table**: `migrations/007_watchlists.up.sql:6-21` (`watchlist_symbols (watchlist_id, symbol)` PK, **no strategy_id**). Repo `internal/repository/watchlist_repo.go` (`AddSymbols:167`, `insertSymbolsTx:248`, `RemoveSymbols:187/199`). Service `internal/service/portfolio_service.go:1115-1270` (`normalizeSymbols:1061`, ownership `requireUserID:1087`/`loadOwned:1097`). Handlers `internal/handler/portfolio_handler.go:132-186`.
  - Positions: `migrations/001_portfolio_hypertable.up.sql:7-17` + 003/005/006 — **no strategy_id/order_origin**. `Position` proto `portfolio.proto:43-55` — no strategy field.
  - Last migration: `007_watchlists` → next-free **008**. Pool: `internal/repository/pool.go:16` (default 2, direct). Propagation `internal/middleware/propagation.go:27,39`.
- **`xstockstrat-ui`** (Next.js, post-098)
  - Opportunities: `src/app/insights/opportunities/page.tsx:62` (`useState<Set<string>>` snooze), key fn `:81` (`${symbol}-${source}`), snooze mutator `:117`, card buttons `:344-351`.
  - `WatchlistReadiness.tsx:60` — still transient `useState('')` strategy picker; 098 rollup `rollupReadiness:66`, `inQueue` badge `:109`. `WatchlistDetail.tsx:114` (per-symbol binding editor home). `watchlists/page.tsx:140-148` master-detail.
  - `src/lib/readinessRollup.ts:34` (pure rollup — reuse). Enum maps `src/lib/opportunityShared.tsx:20-51` (C-10(a/d)). Hooks `useOpportunities.ts:14,23,34`, `useWatchlists.ts` (all via `useInvalidatingMutation.ts:13`). StrategyWizard Step-4 signal controls `StrategyWizard.tsx:285-345`.
  - Fixtures: `e2e/fixtures/opportunities.ts` (`OPPORTUNITIES`, `symbolReadiness`), `e2e/helpers/watchlistMock.ts:20` (stateful, already references 097), `INVENTORY.md:21-23,39`.
- **`xstockstrat-agent`** (Python MCP)
  - `manage_strategy` `app/tools.py:442` → `StrategyDefinition` builder `app/client.py:425` (signal_params `:438-442`). `screen_symbols` `app/tools.py:401` → builder `app/client.py:361-369`. Shared `_build_component` `app/client.py:291-309`. `run_backtest` passes **no** signal params.
  - Parity-test template `tests/test_backtest_view.py:157` (`covers_every_proto_field`). Docs to update same-PR: `plugins/strat-lab/skills/backtest/SKILL.md:15-16,36-46`, `docs/runbooks/mcp-tools.md:387-388,464,486`.

## Patterns to REUSE

- Per-candidate readiness → reuse `evaluate_conditions_traced` + its leaf/rollup helpers (`evaluator.py:171,521,567,612,589`); add an **exit_rule** sibling at the `:202-206` plug-in point (additive-sibling pattern, insights 2026-07-08).
- New `opportunity_actions` persistence → reuse the repository + shared-pool + best-effort-write pattern (`backtest_runs.py:19`; `servicer.py:1449-1472`, no new pool → F-06).
- Config read for a re-purposed ranking weight → reuse `self._cfg.get_str/get_float` + JSON clamp (`servicer.py:272-281`).
- UI readiness display with real passing/total → reuse `readinessRollup.ts:34` (098) rather than re-derive; per-symbol binding editor slots into `WatchlistDetail.tsx:114`; snooze/binding mutations via `useInvalidatingMutation.ts:13`.
- Deprecate-don't-delete → follow the `ingest.proto:31` `timeframe`/`timeframe_enum` precedent (retain field number, add sibling; never `reserved`).
- Guard every changed dict→proto builder with a `covers_every_proto_field` parity test copied from `tests/test_backtest_view.py:157` (closes the RC-1 drift trap for `StrategyDefinition`/`ScreenSymbolsRequest`/`StrategyComponent`).
- Watchlist ownership from header → reuse `requireUserID`/`loadOwned` (`portfolio_service.go:1087,1097`); e2e via `watchlistMock.ts` + `ctxWithUser`.

## Dependencies

- Proto/RPC: `portfolio.Watchlist` (+CRUD reqs) gain a `(symbol, strategy_id)` binding (next-free field 8 / req next-frees 3–5); `analysis.Opportunity` gains stable-key + provenance (next-free 10); snooze/dismiss surface on `ListOpportunitiesRequest` (next-free 3) or a new RPC; deprecate `signal_params=6`, `signal_sources=3`, `signal_weight=4`.
- Migration: portfolio **008** (`watchlist_symbols` strategy binding); analysis **010** (`opportunity_actions`). Both reuse existing pools — no new pool (F-06).
- Config keys: likely `analysis.opportunity.snooze_default_hours` + opportunity valid-window key (new); `analysis.signals.source_weights` re-purposed (existing) from strategy-score input → queue ranking-axis weight.
- Inter-service edges: analysis → ingest `QuerySignals`, analysis → portfolio `ListPositions`/`ListWatchlists`, analysis → trading `ListOrders` — all **already wired**; no new synchronous cycle. UI → analysis/portfolio BFF (existing).
- New env vars / ports: none.

## Risks / Not-found

- **Universe readiness is net-new, not a rewire.** `ListOpportunities` has no per-candidate strategy pairing today; running readiness per candidate adds a per-symbol bar-fetch loop (`EvaluateReadiness:1996-2002`) that does **not** scale free under pool-max-2 — a large Universe needs batching/caps. (Adversary focus.)
- **No exit_rule trace path exists** — exit/REDUCE readiness for held positions is an added build item (plug-in at `evaluator.py:202-206`).
- **Position→strategy attribution exists nowhere in portfolio** (no column, no proto field; positions come from ledger `order.filled` keyed by user+account). The open fork can only resolve via trading/ledger or "unattributed until user picks" — not portfolio. `queue_share` denominator depends on this.
- **`queue_share=0.0` is a hardcoded stub** needing a real numerator/denominator source.
- **No watchlist MCP tool** — the binding change has no agent consumer (scope reducer), but the three unguarded builders (`client.py:425,361,291`) are the RC-1 silent-drop trap; retiring `signal_params`/`signal_sources` there needs the parity test.
- **Agent forwards no `x-user-id`/`x-trace-id`** on these outbound calls (`client.py:29-30`) — only `x-access-scope` on writes (C-03 nuance; pre-existing).
- `fails.md` traps carried: 056/060 "shipped producer, forgot shared consumer"; 2026-07-21 C-10(a/d) proto-enum → exhaustive-TS-`Record`; 2026-08-02 RC-1 builder drift + strat-lab/mcp-tools same-PR parity.
- Rebase-only UI overlap with 098 (code-completed): `WatchlistReadiness.tsx`, `watchlists/page.tsx`, `readinessRollup.ts` — reuse, don't rebuild. 099 (`watchlist-live-quotes`) idea/backlog.

## Recommended Scope

Advisory step boundaries (backend → surface, sequenced; input to grilling / `/sdd-spec`):
1. **Proto** — Watchlist `(symbol, strategy_id)` binding; `Opportunity` stable-key + provenance; snooze/dismiss surface; deprecate `signal_params`/`signal_sources`/`signal_weight`. Run `buf breaking`.
2. **portfolio mig 008 + repo/service/handlers** — strategy-bound watchlist symbols (+ tests, C-13).
3. **analysis mig 010 `opportunity_actions` + repo** — persisted snooze/dismiss/take.
4. **analysis readiness kernel** — add exit_rule trace sibling; unify `ListOpportunities` universe (signals ∪ positions ∪ watchlist bindings) through readiness, with per-symbol batching/caps; real `queue_share`.
5. **analysis scoring** — retire signal blend from strategy score; move signal axis to queue composition.
6. **agent** — retire `signal_params`/`signal_sources` from builders + add `covers_every_proto_field` parity tests; update strat-lab skill + mcp-tools.md (same PR).
7. **UI** — server-persisted snooze on Opportunities; per-symbol strategy binding editor in `WatchlistDetail`; remove StrategyWizard Step-4 signal controls; enum-map updates; e2e via existing fixtures.
