# Recon: watchlist-readiness-list-ux (feature 181)

**Created**: 2026-09-06
**From**: product-spec.md (spec-ready)
**Affected services**: xstockstrat-ui (UI + BFF), xstockstrat-analysis (readiness), xstockstrat-portfolio (watchlist read), packages/proto

---

## Objective

Fix the `/insights/watchlists` UX: render rows immediately with a per-row readiness **loading state**
(not blank-until-all), **optionally decorate** readiness onto the read path (kill the client N+1 fan-out),
and **paginate** the bound-pair rows so a long watchlist neither renders nor evaluates all at once —
without an analysis↔portfolio dependency cycle (FR-4). Design must pick the decoration owner.

## Codebase Map

### xstockstrat-ui (consumer surface)
- List fetch: `src/hooks/useWatchlists.ts:31-34` → `insightsPortfolioClient.listWatchlists({ page: { pageSize: 50 } })` — **hardcoded pageSize:50, no page-token UI**. Page: `src/app/insights/watchlists/page.tsx:20`.
- **The N+1 fan-out**: `src/components/insights/WatchlistReadiness.tsx:186-202` — `useQueries` issues one `analysisClient.evaluateReadiness({strategyId, symbols})` per distinct bound strategy; `staleTime: 30_000` (feature 177, `:196-200`). Rows only render once resolved (`:205-219`). Overlay called from `WatchlistDetail.tsx:355-366`.
- BFF: `src/lib/insightsBff.ts:97` `listWatchlists` = plain `forward()`; `:55` `evaluateReadiness` = plain `forward()`. **Both `portfolioClient` and `analysisClient` already imported** (`:10-18`) — an Option-C aggregator has both clients in-hand. `forward()` = requireSession → backendHeaders (x-user-id/scope/trace) → call (`bffShared.ts:60-69`).
- **No two-backend aggregation precedent** anywhere in `src/lib` (no `Promise.all` over two backends) — Option C is net-new (but cycle-free).
- **Pagination precedent (reuse)**: `src/app/trader/positions/page.tsx:47-55,76,508-520` + `src/hooks/usePortfolio.ts:33,46-55` — keyset page-token stack (pageToken + pageStack, `nextPageToken` from `resp.page`). `src/components/ui/data-table.tsx:81-110` offers *in-memory* client pagination (loads all rows first — not server paging).
- **C-17 primitives (FR-7)**: `Skeleton` (`ui/skeleton.tsx:3`), `QueryStateMessages` (`shared/QueryStateMessages.tsx:2`), `EmptyState` (`shared/EmptyState.tsx:7`), `DataTable` (`ui/data-table.tsx:81`).
- **e2e mock homes (fails.md:1281/1317)**: `e2e/helpers/watchlistMock.ts:75-77` (ListWatchlists route), `e2e/mock-backend.ts:351-355,821-835` (in-process listWatchlists + evaluateReadiness). Any new BFF call needs a mock here.

### xstockstrat-analysis (readiness — candidate decoration owner)
- Proto `packages/proto/analysis/v1/analysis.proto`: `AnalysisService` block `:12-53` (`EvaluateReadiness` at `:37`, last RPC `GetAttribution` `:52` — additive RPC goes here). `EvaluateReadinessRequest{strategy_id=1,symbols=2,rule=3}` `:635-643` (next field 4); `EvaluateReadinessResponse{readiness=1,computed_at=2}` `:644-649` (next field 3); `SymbolReadiness{...conditions=5}` `:595-601` (next field 6).
- Handler `EvaluateReadiness` `servicer.py:2727` — single strategy_id + repeated symbols, owner-scoped via `get_by_owner_and_id` (uniform PERMISSION_DENIED), FAST-gate → SLOW `compute_readiness_row` → `upsert_many`.
- **Batch template (reuse)**: `_materialize_readiness_for_owner(owner, live_by_id)` `servicer.py:3845` — drains bindings, groups symbols per strategy (`:3852-3855`), runs `compute_readiness_row` + `upsert_many` per strategy. This is the "readiness for a watchlist" batch minus a synchronous response projection.
- Shared compute (feature 180): `app/services/readiness.py` `compute_readiness_row`/`is_readiness_row_fresh`/`readiness_valid_until`; cache `app/repositories/readiness_cache.py` `read_many`/`upsert_many` (PK `(user_id,strategy_id,rule,symbol)`).
- Owner-scoped binding drain: `_drain_watchlist_bindings(propagation_meta)` `servicer.py:3738` → `(symbol, strategy_id)` from `ListWatchlists`.
- **analysis→portfolio edge already exists** (no new edge): `PortfolioServiceStub` `servicer.py:388-390`, `PORTFOLIO_ENDPOINT` `main.py:33`.
- Pagination proto precedent: `ListOpportunitiesRequest{page=1,...}` / `Response{...,page=2}` `analysis.proto:619-626` (user_id from `x-user-id` header, not the body). **Proto-SHAPE reference only — `ListOpportunities` is OFFSET-paginated** (`servicer.py:3148-3155`, `page_token` = int offset). The **keyset** precedent (feature 181 uses keyset, Obj 7) is **`ListPositions`** (`portfolio_repo.go:155-166`, `WHERE ($N='' OR symbol > $N) ORDER BY symbol ASC LIMIT`; client stack `usePortfolio.ts:46-56`); 181's composite `(symbol, strategy_id)` cursor is a net-new lexicographic extension of it.
- **No agent hand-projection** of `SymbolReadiness`/`EvaluateReadiness` (grep of `xstockstrat-agent` → only a `ConditionEval` test fixture) — fails.md:1151 parity risk does NOT apply.

### xstockstrat-portfolio (watchlist read)
- `ListWatchlists` proto `portfolio.proto:271-277` — `PageRequest`/`PageResponse` at **watchlist granularity**. `Watchlist.bindings=8` (`:229-246`, next field 11); `WatchlistBinding{symbol=1,strategy_id=2,source=3}` (`:220-226`).
- Handler `portfolio_service.go:1443-1462`; repo `watchlist_repo.go:147-153,162-171` returns a watchlist's **bindings whole** (no LIMIT/offset on bindings). **Per-bound-pair pagination does not exist** — the FR-3 gap.
- **No analysis client/stub** (`authz.go:20` `analysis-fundsignal` is an *inbound* allow-list entry only). Watchlist read path is DB-only (no outbound gRPC).

## Patterns to REUSE (anti-duplication)
- Keyset page-token pagination: `trader/positions/page.tsx` + `usePortfolio.ts` (client), portfolio `ListWatchlists` page (backend already supports it end-to-end).
- Analysis batch readiness: `_materialize_readiness_for_owner` (grouping + loop) + shared `readiness.py` compute + `readiness_cache.read_many`/`upsert_many` (feature 180) — do NOT re-implement the compute.
- Header-owner convention: `ListOpportunities` (user_id from `x-user-id`, `PageRequest`/`PageResponse`).
- C-17 state primitives (Skeleton/QueryStateMessages/EmptyState/DataTable) for FR-7.
- BFF `forward`/`backendHeaders` (`bffShared.ts`) + the e2e mock homes for any new BFF call.

## Existing Business Rules (C-16 — the design-adversary's regression guard)
- **PRESERVE** `@AC-1` "repeat readiness call within the window skips the fan-out" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`, @feature-177) — the FAST serve FR-6 reuses; warm visible-page pairs must still serve FAST.
- **PRESERVE** `@AC-2` "a new bar busts the readiness cache" (same suite, @feature-177) — `bar_epoch` bust / FAST==SLOW; 181 is read-shape-only, must not regress.
- **PRESERVE** `@AC-3` "remount within staleTime does not refetch" (`services/xstockstrat-ui/acceptance/readiness-caching-poll-discipline.feature`, @feature-177) — the 30s `useQueries` cadence on the exact block 181 rewrites; do not regress.
- **PRESERVE** `@AC-6` "UI patches only the changed row without refetching the whole list" (`services/xstockstrat-ui/acceptance/watchlist-single-strategy-update.feature`, @feature-167, tested at 200 symbols) — pagination/read-shape must not force a full `listWatchlists` refetch or invalidate `['watchlists']`. **Risk of becoming CHANGE if the design re-keys the cache** (needs sign-off).
- **EXTEND** `@AC-4` "every state icon is paired with text, never icon-only" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`, @feature-155) — the new `loading`/`unknown`-error states (FR-1/FR-5) join the firing/watching/quiet set and must obey the same icon+text + C-17 a11y rule.
- **PRESERVE** the @feature-155 cue set (firing/watching cues, in-queue marker, firing-row jump / non-firing no-jump) and @feature-127 provenance badge + @feature-127 system-managed delete affordance (`platform.feature`) — all must survive the per-row + pagination re-render.

## Dependencies & cycle facts
- analysis → portfolio: **exists** (ListWatchlists). portfolio → analysis: **does not exist** and must not be added (FR-4). ⇒ decoration on the **portfolio** `Watchlist` response is the cycle (rejected); decoration on **analysis** or the **BFF** is cycle-free.

## The decoration-owner options (grounded)
- **Option A — new additive `AnalysisService` RPC** (`EvaluateWatchlistReadiness`): takes a page of `(symbol, strategy_id)` pairs (or `watchlist_id` + `PageRequest`) → per-pair readiness, reusing `_materialize_readiness_for_owner`'s grouping + shared compute + cache; analysis can read portfolio itself (existing edge) if it takes `watchlist_id`. Additive proto (1-owner gate); no agent parity risk. UI issues **one** RPC per page.
- **Option B — optional readiness field on a response**: on portfolio's `Watchlist` = **cycle (rejected)**; on an analysis message = collapses into Option A (a new/extended analysis message). So B is not a distinct viable owner.
- **Option C — BFF aggregation** (`xstockstrat-ui`): the insights BFF calls `ListWatchlists` (page) + `EvaluateReadiness` (per distinct strategy on the visible page) and merges into one decorated response; no proto change, both clients already colocated. Net-new BFF pattern (no `Promise.all` precedent); still N backend `EvaluateReadiness` calls but server-side/parallel and page-bounded; progressive (stream) vs one-shot is a sub-choice.

## Risks / open threads
- **R1 (C-16):** feature-167 single-row cache patch (@AC-6) could regress if pagination re-keys the `['watchlists']` cache — design must keep the targeted patch or get CHANGE sign-off.
- **R2:** Option C is a net-new two-backend BFF aggregation (more UI tests + e2e mocks); it does not reduce the *number* of backend readiness calls, only moves/parallelizes them server-side.
- **R3:** feature 180's FAST/`bar_epoch` guarantees are NOT yet promoted to a durable suite — the durable C-16 guard is feature 177's analysis suite; flag 180 promotion at spec/launch.
- **R4 (FR-3):** per-bound-pair pagination does not exist today — decide the page boundary: portfolio adds within-watchlist binding paging (additive), vs. the BFF/analysis RPC pages the pairs, vs. UI slices a bounded set. Watchlist-granularity paging (existing) does not solve a single huge watchlist.
- **R5:** preserve the @feature-155 cue set, @feature-127 provenance + system-managed affordances, and owner-scoping (no durable @AC — documented in service CLAUDE.md) across the re-render.

## Recommended scope
Resolve A-vs-C (B is not viable) + the pagination-boundary sub-decision + progressive-vs-one-shot in the debate; keep the change read-shape + presentation only (no readiness-semantics change), reuse 180's compute and 177's cadence.
