# Recon: fix-listwatchlists-page-token

**Created**: 2026-11-17
**From**: product-spec.md (Track C bug; defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`)
**Tree**: ccr-fix-listwatchlists-page-token@d7043c6 ≡ origin/ccr-fix-listwatchlists-page-token (merged origin/main-dev@ccbe424)
**Affected services**: xstockstrat-portfolio (fix site); xstockstrat-analysis, xstockstrat-agent, xstockstrat-ui (consumers — behavior-change check only)

---

## Objective

`WatchlistRepo.ListByUser` emits the look-ahead row's `watchlist_id` as `next_page_token` while the next
page filters `watchlist_id > token` (exclusive), so one watchlist is silently skipped at every page
boundary. Make the token the last row actually returned, keep response shape and token format (a
`watchlist_id` UUID string) unchanged, and prove a full page-size-1 traversal returns every list exactly
once against a real database.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Fix site: `WatchlistRepo.ListByUser` — `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:107-156`
    - clamp (repo only): `if pageSize <= 0 || pageSize > 500 { pageSize = 100 }` — `:108-110`
    - query via **`r.pool`** (concrete `*pgxpool.Pool`): `WHERE user_id = $1 AND ($2 = '' OR watchlist_id > $2::uuid) ORDER BY watchlist_id ASC LIMIT $3`, args `pageSize+1` — `:111-116`
    - look-ahead + truncation (**bug**): `if len(wls) > pageSize { nextToken = wls[pageSize].WatchlistId; wls = wls[:pageSize] }` — `:137-141`
    - bindings batch-loaded for returned IDs only via `r.bindingsByWatchlist` (through mockable `r.db`) — `:143-154` (feature 178 comment `:134-136`)
  - Repo struct: `pool *pgxpool.Pool` + `db queryRower` (mockable surface, "pool in prod, pgxmock in tests") — `watchlist_repo.go:24-29`; `NewWatchlistRepo` sets both — `:32-34`
  - Service: `PortfolioService.ListWatchlists` — `internal/service/portfolio_service.go:2246-2265` (page_size/page_token from `req.GetPage()`; `Page: &commonv1.PageResponse{NextPageToken: next}` `:2263`; repo error → `connect.CodeInternal` `:2259`)
  - Store interface `ListByUser` — `portfolio_service.go:1990`; sole call `:2257`; fake ignores paging, returns `""` — `internal/service/watchlist_service_test.go:146-154`
  - Handler: `internal/handler/portfolio_handler.go:182-183` (connect) / `:339-340` (gRPC adapter)
  - Last migration: `018_watchlist_signal_expiry.up.sql`. No migration needed.
  - Config: `watchlist.max_per_user` default **50** (`services/xstockstrat-portfolio/CLAUDE.md:73`; read `portfolio_service.go:2135`). Page size is not config-driven.
  - Keyset uniqueness: `watchlist_id UUID PRIMARY KEY` — `migrations/007_watchlists.up.sql:6-14`; sort key = PK, so no ties.
- **`xstockstrat-analysis`** (Python) — consumer
  - `_drain_watchlist` — `app/engine/live_loop.py:592-623`: page_size `_DRAIN_PAGE_SIZE = 1000` (`:67`), ≤ `_DRAIN_PAGES = 50` (`:66`), `if not page_token: break` (`:620-622`), page error → logs + `record_live_loop_drain_failure` + returns partial (`:611-614`); collects symbol set. Callers `live_loop.py:403`, `entry_backfill.py:149`.
  - `_drain_watchlist_bindings` — `app/handlers/servicer.py:5995-6027`: page_size `_BAR_PAGE_SIZE = 1000` (`:298`), ≤ `_MAX_DRAIN_PAGES = 50` (`:347`), breaks on empty token, `grpc.RpcError` → partial. Callers `servicer.py:5368` (`_compute_opportunities`), `:6109` (readiness materializer).
  - **Both send 1000, which the repo clamp turns into 100** (`watchlist_repo.go:108-110`), so the effective drain page is 100.
- **`xstockstrat-agent`** (Python) — consumer surface (C-14)
  - MCP tool `list_watchlists` — `app/tools.py:2153-2164`; docstring "Pagination is stable across pages." — `:2155`; pure passthrough of `limit`→`page_size`, `page_token`, returns `next_page_token` unchanged.
  - Client — `app/client.py:416-432`, single RPC, no loop/clamp.
- **`xstockstrat-ui`** (Next.js) — consumer surface
  - `useWatchlists` — `src/hooks/useWatchlists.ts:33`: single `listWatchlists({ page: { pageSize: 50 } })`, never follows `nextPageToken`. BFF passthrough `src/lib/insightsBff.ts:138`.

## Patterns to REUSE

- Keyset cursor = **last row returned**, strict `>`, look-ahead only to decide "more?" → marketdata precedent `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:716-766,808-820` (insights.md:3547).
- dbtest harness → `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go`: `testPool(t)` (`:22-49`, `PORTFOLIO_DB_TEST_URL`, Fatal under `CI=true`, `lock_timeout=500ms` `:35`, cleanup deletes `it-281-%` users `:42-47`), `testUserID(t)` (`:52-55`), `seedWatchlist(t, pool, userID, systemManaged)` (`:57-68`, fixed name `"wl-"+userID`).
- CI job → `.github/workflows/ci.yml:1016-1065` `portfolio-db-test`: `go test -tags dbtest -race -count=1 ./internal/repository/...` (GOWORK=off, migrations applied).
- Unit mocking → `pgxmock/v4` (`go.mod:9`), pattern `internal/repository/watchlist_repo_test.go:16-23` (`repo := &WatchlistRepo{db: mock}`) — only reaches code that reads through `r.db`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2 @feature-178` "Watchlist bindings resolve in one query" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature:21-26`) — one ANY-array bindings query over the returned page; per-row payload unchanged.
- **PRESERVE** `@AC-1 @feature-148` "list_watchlists returns only the caller's own lists, paginated" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature:13-18`) — shape + string `next_page_token` unchanged.
- **PRESERVE** `@AC-2 @feature-180` "The materialized universe is derived from actual watchlist bindings, owner-scoped" (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature:12-18`).
- **PRESERVE** `@AC-6 @feature-191` "Phase 0 drains execute concurrently" (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:5-10`).
- **PRESERVE (indirect)** `@AC-2`, `@AC-3 @feature-168` (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature:22-24,31-33`) — universe from the watchlist drain.
- **PRESERVE** `@AC-6 @feature-167` "UI patches only the changed row without refetching the whole list" (`services/xstockstrat-ui/acceptance/watchlist-single-strategy-update.feature:8-14`).
- **EXTEND** — no existing `@AC-*` states ListWatchlists page-token semantics; this feature's `@AC-1`/`@AC-2` add it (promote to the portfolio suite at launch, C-16). **No CHANGE-class rule.**

## Dependencies

- Proto/RPC: none changed. `ListWatchlistsRequest{ PageRequest page = 1 }` / `ListWatchlistsResponse{ repeated Watchlist watchlists = 1; PageResponse page = 2 }` — `packages/proto/portfolio/v1/portfolio.proto:302-308`; `PageRequest{page_size=1,page_token=2}`, `PageResponse{next_page_token=1,total_count=2}` — `packages/proto/common/v1/common.proto:10-18` (no semantic comments).
- Migration: none.
- Config keys: none.
- Inter-service edges: unchanged (analysis → portfolio, agent → portfolio, ui → portfolio).
- New env vars / ports: none.

## Risks / Not-found

- **No test of `ListByUser`/`ListWatchlists` at any layer** — the fix's tests are the first.
- **A DB-free unit test is impossible as written**: the main query reads through `r.pool`, not `r.db` (`watchlist_repo.go:111`). A unit test needs either the query moved to `r.db` (in-file refactor, enables pgxmock) or the token selection extracted to a pure function.
- `seedWatchlist` cannot seed >1 non-system list per user (fixed name hits `watchlists_user_name_not_system_uidx`, `migrations/011_watchlist_system_managed_source.up.sql:20-22`; system lists limited to one per user, `:26-28`) → a named-seed variant is required.
- Malformed `page_token`: no validation; `$2::uuid` cast error → wrapped as `list watchlists: …` or returned bare from `rows.Err()` (`:131`) → INTERNAL. Not verified whether the error surfaces at Query or iteration. Pre-existing; out of scope unless the design touches it.
- **Mixed-fleet / in-flight tokens**: an old (look-ahead) token held by a client across the deploy, sent to the fixed server, resumes *after* the look-ahead row — that row is skipped once. A new (last-returned) token sent to an old server resumes correctly. Analysis drains complete in one cycle, so only an in-flight drain at deploy time is exposed.
- **Real-world exposure is low today**: `watchlist.max_per_user` = 50 < every consumer's effective page (UI 50, analysis 100 after clamp, agent default 100), so default-configured owners never cross a boundary; the loss shows for small explicit `limit` (agent), or if the cap is raised above 50/100.
- Twin `ListPositions` has the same shape (`internal/repository/portfolio_repo.go:161-163,193-194`, `symbol > token`, `positions[pageSize].Symbol`) — **out of scope** (owned by another session).
- Ledger traps: fails.md:3309 (server side gets its own test that follows the token to the last page; consumers fail closed on page error / same token — analysis drains don't, pre-existing), fails.md:2786 (fakes cannot prove pagination — real backend required).
- No PORTFOLIO-* constitution entry or proto comment on paging semantics.

## Recommended Scope

1. `test` (dbtest, RED): named-seed helper variant + full traversal at page_size 1 over ≥3 lists → every list once, last token empty; plus a page_size 2 check that the token equals the last returned id. Fails on current code.
2. `test` (unit, RED): token-selection logic without DB (shape depends on the design's unit-test seam decision).
3. `service` (GREEN): one-index fix in `ListByUser` (plus whatever minimal seam step 2 needs).
4. `docs`: agent docstring `tools.py:2155` — decide keep/reword; optional context-constitution/proto comment on token semantics (design decides).
