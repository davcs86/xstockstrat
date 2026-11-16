# Recon: fix-listpositions-nextpagetoken-skips

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: ccr-fix-listpositions-nextpagetoken-skips@710384d (origin/main-dev@78ab5ca merged, +1 docs commit; branch kept because the feature dir exists only here)
**Affected services**: xstockstrat-portfolio (fix site); xstockstrat-analysis, xstockstrat-agent (token consumers); xstockstrat-trading (first-page consumer)

---

## Objective

A paginated `ListPositions` traversal must return every position exactly once. Today the page token is the look-ahead row's symbol (that row is skipped) and the keyset is `symbol` only while the table is unique on `(user_id, symbol, trading_mode, account_id)`, so multi-account/mode symbols lose rows at page boundaries.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Bug site: `PortfolioRepo.ListPositions` — `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:134-198`; page-size clamp `:136-138` (`<=0 || >500` → 100); keyset `:161-162` (token bound once, used twice); `ORDER BY symbol ASC LIMIT` `:168-172` (no tiebreaker); token `:192-196` (`positions[pageSize].Symbol`)
  - `positionColumns` `:297` (exported for tests `repository/export_test_helpers.go:4`); `scanPositionRow` `:253-293` scans `trading_mode` into `modeStr` and **discards it** (`Position` proto has no trading_mode field) — a composite cursor cannot read the mode off the last returned `Position`
  - RPC layer: `internal/service/portfolio_service.go:894-915` passes `page_token` through unvalidated, returns `nextToken` verbatim; `enrichPositions` (`:910`) mutates in place after the page is fixed (no reorder/drop); handler pass-through `internal/handler/portfolio_handler.go:109,281`
  - Other repo callers (all ignore next token, cap 500 — pre-existing silent truncation, out of scope): `portfolio_service.go:787, 932 (GetPnL), 1214, 1283`
  - Last migration: `018_watchlist_signal_expiry` (next = 019, only if an index is needed)
  - No config key governs page size
- **`xstockstrat-analysis`** (Python)
  - `live_loop._drain_held` — `app/engine/live_loop.py:563-590` (`_DRAIN_PAGES=50` `:66`, `_DRAIN_PAGE_SIZE=1000` `:67`); set of normalized symbols; best-effort (partial result + `record_live_loop_drain_failure("held")`); no repeated-token guard; cap hit is silent. Callers `live_loop.py:402`, `app/engine/entry_backfill.py:148`
  - `servicer._drain_held_symbols` — `app/handlers/servicer.py:6404-6437` (`_MAX_DRAIN_PAGES=50` `:347`); `dict[str,float]` summing `abs(market_value)` per symbol across rows (a skipped/duplicated row skews held-value ranking); catches only `grpc.RpcError`. Callers `servicer.py:3935, 5367`
  - Both call the raw stub (no wrapper), set no `account_id`/`trading_mode`, treat the token as opaque
- **`xstockstrat-agent`** (Python)
  - `get_positions`/`get_positions_by_account_id` — `app/tools.py:2567-2613`; `client.list_positions` — `app/client.py:2574-2604` single-RPC passthrough; docstrings already say "opaque token"; no code change required (optional "do not parse" note, `docs/runbooks/mcp-tools.md:1630,1652`). `plugins/strat-lab` has no `get_positions` mention → no skill update (CLAUDE.md strat-lab rule not triggered)
- **`xstockstrat-trading`** (Go): `internal/service/trading.go:2235-2238` requests page_size 500, first page only (reconcile consumer)

## Patterns to REUSE

- Composite keyset cursor → copy the marketdata pattern (unexported, so copy not import): row-tuple compare `(period_end, fiscal_period) > ($n,$m)` `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:917`, over-fetch `pageSize+1` `:920`, token from the **last returned row** `out[pageSize-1]` `:956-957`, pipe-joined token, `parseHistCursor` `:999-1011` returns `ok=false` on empty/malformed → resume page 1. Ledger: insights.md:3547 (cursor tuple must be unique per partition; apply filters in SQL before LIMIT; write the uniqueness argument in the PR)
- Cursor tests → template `marketdata_repo_test.go:276-453` (`...CompositeCursorSamePeriodEnd` `:394`, `TestParseHistCursor` `:450`, "cursor is the LAST RETURNED row" `:334`)
- pgxmock repo unit tests → `internal/repository/portfolio_repo_test.go` (`pgxmock.NewPool()` + `NewPortfolioRepoWithDB`)
- Real-backend test → `internal/repository/dbtest_helpers_test.go` (`testPool` `:22-49`, `testUserID` `:52-55`, `PORTFOLIO_DB_TEST_URL`, tag `dbtest`); CI job `portfolio-db-test` `.github/workflows/ci.yml:1016-1065` runs `go test -tags dbtest ./internal/repository/...` — a new file there needs no workflow change. Needs a new `seedPosition` helper and a positions cleanup (current cleanup is watchlist-only, prefix `it-281-`)
- Consumer-side drain hardening (fails.md:3309): a looping consumer should fail closed and reject a token equal to the one it sent — analysis drains currently do neither

## Existing Business Rules (preserve / extend)

No existing `@AC-*` guarantees `ListPositions` pagination, token format or order; feature 353 `@AC-1` is net-new (EXTEND by addition). No CHANGE.
- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-178` one batched quote call, never per-position (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`); `@AC-4` last-close/NONE fallback. Per-page batching vs per-traversal is an ambiguity design must state
- **PRESERVE** `@AC-1 @regression @feature-229 @feature-240` quote deadline (`fix-book-portfolio-page.feature`); `@AC-3 @feature-256` `offline_state_unavailable` degrade (`fix-offline-book-consistency.feature`)
- **PRESERVE** valuation parity across read paths: `fix-after-hours-positions-priced.feature` `@AC-1/6/13/14`; `offline-account-full-pnl.feature` `@AC-12/13/27/29/51`; `offline-account-portfolios.feature` `@AC-7`; `snapshot-offline-positions.feature` `@AC-1..5,11..14,17`
- **PRESERVE** `@AC-16 @feature-294` held-drain failure counter (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`); `@AC-8 @feature-262` per-owner failure isolation; `@AC-6 @feature-191` Phase-0 drains stay concurrent (`opportunities-latency-fix.feature`); `@AC-2 @feature-168`, `@AC-1/3 @feature-193` held set assumed complete
- **PRESERVE** agent `fix-agent-client-deadlines.feature` `@AC-1/5/7/10` (get_positions deadline-bounded, every stub call has a timeout); `mcp-list-correlation-prompts.feature` `@AC-1` (descriptor text); `offline-account-full-pnl.feature` `@AC-17/33` row fields
- Gap: no scenario asserts the analysis drains return the full held set across pages

## Dependencies

- Proto/RPC: `ListPositionsRequest.page` (field 2, `packages/proto/portfolio/v1/portfolio.proto:194-198`) → `common.v1.PageRequest{page_size=1,page_token=2}` / `PageResponse{next_page_token=1,total_count=2}` (`packages/proto/common/v1/common.proto:10-18`). Token is already an opaque `string` → **no proto change**
- Migration: schema `001` (`positions` table, `idx_positions_user`), `002` (`trading_mode TEXT NOT NULL`, `idx_positions_trading_mode (user_id, trading_mode)`), `003` (`account_id TEXT NOT NULL DEFAULT 'alpaca-default'`, `UNIQUE (user_id, symbol, trading_mode, account_id)` `003_positions_account_id.up.sql:8-10`). No `COLLATE` anywhere; the unique btree `(user_id, symbol, trading_mode, account_id)` can serve `ORDER BY symbol, trading_mode, account_id` under `user_id = $1` (observation, unverified plan) → a new migration is probably unnecessary
- Config keys: none
- Inter-service edges: analysis/agent/trading → portfolio `ListPositions` (gRPC); no new edges
- New env vars / ports: none

## Risks / Not-found

- **Break radius is arg-count pins, not signatures**: service tests pin the positions query via pgxmock `anyArgs(3)` (user, token, limit; `service/portfolio_fill_errors_test.go:36`) at ~17 sites and `anyArgs(4)` at ~20 sites, plus exact `WithArgs("u1","alp-1","",501)` at `offline_account_pnl_test.go:530,531,572`. A cursor that changes the arg count/positions touches ~40 sites; keeping the empty-token-bound-once shape on page 1 avoids it (design must choose)
- Position proto has no `trading_mode` and the scan drops it → the cursor needs `trading_mode` selected/scanned separately in the repo
- Legacy bare-symbol tokens from in-flight clients: user deferred the policy to this design
- Same look-ahead-token bug in `WatchlistRepo.ListByUser` (`internal/repository/watchlist_repo.go:107-156`, token `:139`): sibling defect owned by another session — **out of scope** (ledger fails.md:3265, scope-creep trap: do not make this feature a parallel fix site; overlap scan found no in-flight feature owning ListPositions paging; 351 and the sibling report are not in this tree)
- Pre-existing and out of scope: internal callers `portfolio_service.go:787/932/1214/1283` and trading `trading.go:2235` read only the first 500 positions
- Analysis drains: no repeated-token guard, silent 50-page cap, no multi-page test; a fix that makes pages correct does not by itself harden them (design: in or out of scope?)
- `RPC page_size` >500 silently clamps to 100 at the repo (`:136-138`), while the service passes it through unclamped (`:894-915`) — pre-existing, adjacent
- Not found: any existing ListPositions pagination test (unit or dbtest), positions dbtest seeder/cleanup, shared cursor helper, token validation at the service layer, pagination docs in portfolio CLAUDE.md
- Ledger traps: fails.md:3265 (parallel fix sites / over-designing a pagination defect — a 9-round design for a narrow fix), fails.md:3309 (fail-closed consumers, reject equal token, test with a token-ignoring fake), fails.md:2663 (test "not split across boundary" with a non-aligned page size)

## Recommended Scope

1. Portfolio repo: composite cursor over the full unique key + `ORDER BY symbol, trading_mode, account_id`; token from the last returned row; malformed token policy per design
2. `dbtest` test (RED first): multi-account/mode symbol traversed at page_size 1 yields every row exactly once; plus pgxmock unit tests for cursor encode/decode and arg shape
3. Update the ~40 arg-count pins only if the arg shape changes
4. Consumers: analysis drains and agent need no change for correctness; optional hardening (equal-token guard, cap-hit log) and an agent docstring note are design decisions
