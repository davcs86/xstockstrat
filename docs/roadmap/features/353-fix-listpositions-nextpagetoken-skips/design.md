# Design: fix-listpositions-nextpagetoken-skips

**Created**: 2026-11-16
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-11-16 (design gate, round 2)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Fix in one place — `PortfolioRepo.ListPositions` (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:134-198`) — plus one handler error mapping. Portfolio only; no proto (`common.proto:10-18` token is an opaque string), no migration, no config (D-5).

- **Cursor (D-1, D-2):** the token is built from the last RETURNED row (never the look-ahead row), over the full unique key `(symbol, trading_mode, account_id)` (`migrations/003_positions_account_id.up.sql:8-10`; `user_id` is always an equality filter). Encoding: base64url of a JSON array of exactly three strings, via unexported encode/decode next to `ListPositions`. `trading_mode` is not on the `Position` proto and `scanPositionRow` discards it (`:253-293`), so a `scanPositionRowWithMode` carries it and `scanPositionRow` stays a one-line wrapper (D-3).
- **SQL (D-1, D-7):** filters (mode, account, symbol, side) stay ANDed before `LIMIT`; add `AND (cardinality($c::text[]) = 0 OR (symbol, trading_mode, account_id) > (($c::text[])[1], ($c::text[])[2], ($c::text[])[3]))`, `ORDER BY symbol, trading_mode, account_id LIMIT pageSize+1`. `$c` is ONE `text[]` argument on every page in the token's current slot (explicit `::text[]` on every use); page 1 binds a non-nil `[]string{}`. Every `ListPositions` pin therefore keeps its arg count (`anyArgs(3)/(4)` untouched, shared-count loops untouched). Exactly three exact pins change: `services/xstockstrat-portfolio/internal/service/offline_account_pnl_test.go:530,531,572` (`""` → `[]string{}`).
- **Bad token (D-4):** decode failure returns `repository.ErrInvalidPageToken` before any query; the handler (`portfolio_handler.go:113-116`, today every error is `CodeInternal`) maps it to `InvalidArgument` through a `classifyListPositionsError` beside `classifyGetPositionError` (`:415-422`). **Deliberate deviation from the marketdata precedent** ("malformed token resumes page 1", `marketdata_repo.go:999-1011`, insights.md:3547): a silent restart makes `servicer._drain_held_symbols` re-add `abs(market_value)` (`servicer.py:6431-6433`, the fails.md:3309-3312 failure). Do not "fix" this back to resume-from-page-1 (R-5).
- **Consumers (C-14):** no code change. `/trader/positions` (`xstockstrat-ui/src/app/trader/positions/page.tsx:54-55,548-551`) stops skipping rows on Next; agent `get_positions` is an opaque passthrough; analysis drains treat the token as opaque (`live_loop.py:563-590`, `servicer.py:6404-6437`); enrichment still runs once per RPC page (`portfolio_service.go:894-915`). Production impact is real: drains request 1000 but the repo clamps >500 to 100 (`portfolio_repo.go:136-138`), so any user with >100 positions is affected today.
- **Tests (P-06 red-before-green, D-8):** new `internal/repository/` dbtest (`dbtest` tag; `portfolio-db-test` CI job `ci.yml:1016-1065`, no workflow change): seed 7 rows with `qty` 1..7 as identity — AAPL/LIVE/a, AAPL/PAPER/a, AAPL/PAPER/b, AAPL/PAPER/c, MSFT/LIVE/a, MSFT/PAPER/a, NVDA/PAPER/a — and traverse at page sizes 3 and 1, asserting the exact ordered sequence `[1..7]` with no repeats, page shapes `[3,3,1]` and an empty last token (RED on current code: page 1 `LIMIT 4` returns 3 of 4 AAPL rows, token `"AAPL"`, page 2 returns `[MSFT,MSFT,NVDA]`). Run as subtests over the default pool AND a pool with `DefaultQueryExecMode = pgx.QueryExecModeExec` (fails.md:1977-2001: production binds in Exec mode via `DB_PGBOUNCER`, `pool.go:29-32`). Seed one `account_id` containing `,` `"` `{` `}` `\`, a space and literal `NULL`. Collation test: `acct_1`, `Acct-1`, `acct-1` in one symbol/mode compared with an oracle `ORDER BY` query. Reuse `testUserID`/`dbtestUserPrefix` and extend the existing cleanup with a positions delete (`dbtest_helpers_test.go:18,22-55`). pgxmock unit tests: page 1 binds a non-nil empty `[]string` (matcher, not DeepEqual) and the SQL is regex-pinned for `cardinality\(\$\d+::text\[\]\)` and `\(\$\d+::text\[\]\)\[1\]`; cursor page binds the 3 decoded values; next token = last returned row; malformed tokens issue no query. Codec table test (round-trip with `| " , { \` and empty elements; reject `"AAPL"`, `"BRK.B"`, bad base64, wrong length, non-string elements, object). Handler classifier test (incl. wrapped error).

## Rejected Alternatives

- `R-1` Numeric offset token — rejected: positions mutate continuously (sync delete+upsert, fills), so offsets shift between pages and drains double-count/skip; O(offset).
- `R-2` `(symbol, position_id)` cursor — rejected: `position_id` not in `positionColumns`, no matching index (sort per page), arbitrary within-symbol order.
- `R-3` Accept legacy bare-symbol tokens — rejected: keeps the buggy path alive behind a sniffing heuristic for a seconds-long deploy window (C-18).
- `R-4` Pipe-joined `symbol|mode|account` — rejected: assumes symbols never contain `|`; base64(JSON) is escape-safe.
- `R-5` Malformed token resumes page 1 — rejected: duplicated-sum failure in `_drain_held_symbols` (see Chosen Approach).
- `R-6` Option (a): keep dead `($n='')` bind on page 1, 3 extra args only on cursor pages — rejected: two SQL shapes, SQL bent to test pins, cursor shape untested (C-18).
- `R-7` Option (c): 3 cursor args on every page — rejected: every pin 3→5 / 4→6 (~37 sites) plus loop splits.
- `R-8` Option (d): one text arg holding JSON parsed via `NULLIF($n,'')::jsonb->>i` — rejected: jsonb parse inside the predicate, strictly worse than (b).

## Open Risks

- [ ] **Exec-mode text-array encoding** is the PgBouncer-only risk (client-side quoting of `, " { \`/`NULL` elements; `[]string` binds already exist in prod at `portfolio_repo.go:507`) — covered by the mandatory Exec-mode dbtest subtests and special-character row (D-8); target: test step.
- [ ] **Plan shape**: the cursor-bounded index seek holds only under a custom plan (prod Exec mode); under a cached generic plan (direct/dev, after 5 executions) the OR stays a Filter and each page is O(user's rows) on the unique index — negligible at ≤500 positions per user; not claimed as index-bounded.
- [ ] **Deploy straddle**: a drain or a browser holding an old bare-symbol token during rollout gets `InvalidArgument` once — `live_loop._drain_held` returns a partial set and increments `record_live_loop_drain_failure("held")` for one cycle (`@AC-16 @feature-294` preserved), `servicer._drain_held_symbols` logs and returns partial; `/trader/positions` recovers on reload or filter change (`page.tsx:59-62`); confirm the page renders the error through `QueryStateMessages` (target: spec step).
- [ ] **pgxmock nil-vs-empty** equality is unverified — hence the matcher in the page-1 test (D-8).
- [ ] **Follow-up defect reports (not "later"; file via `/sdd-qa defect` after this lands)**: (1) analysis position-drain hardening — equal-token guard, fail-closed, cap-hit log/metric, multi-page test (fails.md:3309-3312); (2) `WatchlistRepo.ListByUser` look-ahead token (`watchlist_repo.go:139`; sibling report owned by another session); (3) internal portfolio callers read only the first 500 positions and discard the token (`portfolio_service.go:787,932,1214,1283`; trading `trading.go:2235`).

## Constitution Rules Touched

- `C-01` — honored by: every path cited from recon/adversary-verified reads; the unverified pgxmock/pgx encoding claims are named as risks, not asserted.
- `C-08`/`C-15`/`P-06` — honored by: paired test steps cover `@AC-1`; RED sequence test fails on current code before the fix.
- `C-10` — honored by: single repo site; `ListPositionsByAccount` is unpaginated; parity paths keep arg counts.
- `C-13` — honored by: tests reuse the existing dbtest helpers; a positions seeder is added only because none exists (first consumer inline until a second appears).
- `C-14` — honored by: consumer surfaces named in product-spec (`/trader/positions`, agent `get_positions`); neither needs code.
- `C-16` — honored by: all recon rules PRESERVE; `@AC-1 @feature-178` batching unchanged (enrichment once per RPC page); `@AC-16 @feature-294` preserved.
- `C-18` — honored by: one repo site, minimal wrapper, no consumer scope creep (fails.md:3265); recorded trade-offs R-6..R-8.
- `F-01` (no migration), `F-06` (no pool change), `F-07` (no config) — honored; no Floor breach flagged in either round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @FR-4 @feature-178` (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`) — not regressed: enrichment still one batched call per RPC page.
- PRESERVE `@AC-3 @FR-4 @feature-256` (`fix-offline-book-consistency.feature`), `@AC-1 @feature-229` (`fix-book-portfolio-page.feature`) — degrade paths untouched (post-page enrichment).
- PRESERVE `@AC-16 @FR-5 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`) — failed drain still counted.
- PRESERVE valuation-parity and provenance rules (`fix-after-hours-positions-priced`, `offline-account-full-pnl`, `offline-account-portfolios`, `snapshot-offline-positions`) — row content and enrichment unchanged.
- EXTEND — feature 353 `@AC-1` adds the first pagination guarantee; no existing rule altered.
