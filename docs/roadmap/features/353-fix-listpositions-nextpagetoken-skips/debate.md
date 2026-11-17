# Debate Register: fix-listpositions-nextpagetoken-skips

**State**: approved
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 bound counts this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 6 | 5 | 5 | 6 | 0 | yes |
| 2 | 2026-11-16 | /sdd-design | 2 | 3 | 6 | 5 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Fix at the single site `PortfolioRepo.ListPositions`: cursor = last RETURNED row's (symbol, trading_mode, account_id); SQL `(symbol, trading_mode, account_id) > (...)` with `ORDER BY symbol, trading_mode, account_id LIMIT pageSize+1`; filters stay ANDed before LIMIT. Verified correct by the adversary (lexicographic row compare, NOT NULL columns, unique per user, same collation in compare and ORDER BY) | `portfolio_repo.go:134-198`; `migrations/003_positions_account_id.up.sql:8-10`; `marketdata_repo.go:913-921,954-958`; insights.md:3547 | settled |
| D-2 | 1 | Token encoding = base64url(JSON array of exactly 3 strings); unexported encode/decode beside `ListPositions`. Bare legacy symbol fails decode deterministically | `account_id` free-form TEXT `003:2`; adversary verified `"AAPL"`/`"BRK.B"` rejected | settled |
| D-3 | 1 | `trading_mode` reaches the cursor via `scanPositionRowWithMode` (wrapper keeps `scanPositionRow` signature); no `Position` proto change | `portfolio_repo.go:253-293,297`; callers `:131,:182,:626` + tests `portfolio_repo_test.go:26,33` | settled |
| D-4 | 1 | Malformed/legacy token → `repository.ErrInvalidPageToken` before any query → handler maps to `InvalidArgument` (today every error is `CodeInternal`). Deliberate departure from marketdata "resume page 1": silent restart makes `_drain_held_symbols` re-add `abs(market_value)` (fails.md:3309-3312). Must be recorded in design.md as a deliberate deviation | `portfolio_handler.go:113-116,417-422,447-448`; `servicer.py:6431-6433`; `live_loop.py:582-585` | settled |
| D-5 | 1 | No proto, migration, or config change; enrichment stays once per RPC page (`@AC-1 @feature-178` preserved) | `common.proto:10-18`; `portfolio_service.go:894-915` | settled |
| D-7 | 2 | **Arg shape (resolves O-1) = option (b):** one `text[]` cursor arg on EVERY page in the token's current slot; SQL `AND (cardinality($c::text[]) = 0 OR (symbol, trading_mode, account_id) > (($c::text[])[1], ($c::text[])[2], ($c::text[])[3]))` with explicit `::text[]` on every use; page 1 binds a NON-nil `[]string{}`. Every ListPositions pin keeps its arg count; only `offline_account_pnl_test.go:530,531,572` change (`""` → `[]string{}`). `[]string` → text[] under Exec mode is already in prod (`portfolio_repo.go:507`, marketdata `:410,420,494`) | `pool.go:29-32`; `portfolio_fill_errors_test.go:36-42` | settled |
| D-8 | 2 | **Test-plan conditions (A-1, A-3, A-4):** traversal dbtests run as subtests over two repos — default pool and a pool with `DefaultQueryExecMode = pgx.QueryExecModeExec` (fails.md:1977-2001, mandatory not optional); seed an `account_id` with `,` `"` `{` `}` `\` space and literal `NULL`; page-1 pgxmock test uses a `pgxmock.Argument` matcher (`[]string`, non-nil, len 0) and regex-pins `cardinality\(\$\d+::text\[\]\)` and `\(\$\d+::text\[\]\)\[1\]`; reuse `testUserID`/`dbtestUserPrefix` and extend the existing cleanup (no second prefix); plus RED sequence test (7 rows, page sizes 3 and 1, exact ordered sequence) and collation oracle test | `dbtest_helpers_test.go:18,22-55`; fails.md:1977-2001 | settled |
| D-6 | 1 | Out of scope: analysis drain hardening (equal-token guard, cap-hit log, fail-closed) and `WatchlistRepo.ListByUser` (same bug, other session) — design.md names them as follow-up defect reports, not "later" | fails.md:3265, 3309-3312; `watchlist_repo.go:139` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Numeric offset token | `portfolio.positions` mutated continuously (sync delete+upsert, fills): offsets shift between pages → drains double-count/skip (fails.md:3309); O(offset) | locked |
| R-2 | 1 | `(symbol, position_id)` cursor | `position_id` not in `positionColumns` (same scan-wrapper cost); no `(user_id, symbol, position_id)` index → sort per page; arbitrary within-symbol order | locked |
| R-3 | 1 | Accept legacy bare-symbol tokens (`symbol > $n` fallback) | Keeps the buggy path alive behind a sniffing heuristic for a seconds-long deploy window (C-18 YAGNI) | locked |
| R-4 | 1 | Pipe-joined `symbol\|mode\|account` | Assumes symbols never contain `\|` (offline symbols not provably constrained); near-tie, base64(JSON) chosen | locked |
| R-6 | 2 | Option (a): keep dead `($n='')` bind on page 1 + 3 extra args only on cursor pages | Two SQL shapes, production SQL bent to test pins, cursor-page shape untested (C-18); adversary withdrew its round-1 preference | locked |
| R-7 | 2 | Option (c): 3 separate cursor args every page | Every ListPositions pin 3→5 / 4→6 (~37 sites) + loop splits | locked |
| R-8 | 2 | Option (d): one `text` arg holding JSON parsed with `NULLIF($n,'')::jsonb->>i` | jsonb parse inside the predicate, strictly worse than (b) | locked |
| R-5 | 1 | Malformed token resumes from page 1 (marketdata precedent) | Silent restart re-adds `abs(market_value)` in `_drain_held_symbols` and can loop consumers; reject instead (D-4) | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | **Test-pin blast radius miscounted and not mechanical** (adversary O-A; P-03/C-01/C-18): `FROM portfolio.positions` regex also matches GetPosition/DELETE/realized/fees/Count queries; dropping the page-1 bind makes ListPositions 2/3 args = the old GetPosition count, so unedited pins can silently match the wrong query; shared-count loops (`portfolio_mark_test.go:136`, `offline_account_pnl_test.go:297,478`, `export_test.go:29-31`) must be split. Options: (a) keep page-1 `($n='')` + args, only cursor pages bind 3 values → zero pin edits; (b) single `text[]` cursor arg every page → ~3 exact-pin edits; (c) accept edits but enumerate every site by path:line | yes (approval) | closed @ 2 (resolved by D-7: option (b)) |
| O-2 | 1 | **Unlisted consumer `/trader/positions`** (adversary O-B; C-14): `page.tsx:54-55,83,548-551`, `usePortfolio.ts:43-52`, `traderBff.ts:81` paginates with `nextPageToken` + `pageStack`; reject policy gives InvalidArgument on Next/Previous with stale in-state tokens across a deploy. product-spec lacked `## Consumer Surface(s)` | no | closed @ 1 (accepted: product-spec amended to name the UI page + agent tool; no code change, straddle error accepted, rendering via `QueryStateMessages` to be confirmed in /sdd-spec) |
| O-3 | 1 | Record the InvalidArgument-vs-resume departure explicitly in design.md (adversary O-C; C-18) | no | closed @ 1 (accepted → D-4, R-5) |
| O-4 | 1 | Document that a drain straddling a deploy fails one cycle (`record_live_loop_drain_failure("held")`, `@AC-16 @feature-294` preserved) and that drains request 1000 but repo clamps >500 to 100, so users with >100 positions hit the bug in production (adversary O-D) | no | closed @ 1 (accepted → Open Risks / design.md) |
| O-5 | 1 | RED proof must assert the exact ordered sequence `[(A,X),(A,Y),(B,X),(C,X)]` with no repeats, not a count (current code returns [A@X, B]) (adversary O-E; P-06/C-15) | no | closed @ 1 (accepted → test plan; keep 7-rows-at-page-size-3) |
| O-6 | 1 | Add a dbtest collation case (`acct_1`,`Acct-1`,`acct-1` in one symbol+mode) and state TEXT-vs-TEXT binding (adversary O-F; minor) | no | closed @ 1 (accepted → test plan) |
| O-7 | 2 | Exec-mode dbtest must be REQUIRED; real divergence is client-side text-array encoding (not the cast) — fails.md:1977-2001 (A-1; P-03) | yes (approval condition) | closed @ 2 (accepted → D-8) |
| O-8 | 2 | Index claim overstated: cursor-bounded index seek only under a custom plan; generic plan (direct/dev, after 5 executions) keeps the OR as a Filter → O(user rows) per page; negligible at ≤500/user — record in Open Risks (A-2; C-01) | no | closed @ 2 (accepted → design.md Open Risks) |
| O-9 | 2 | Don't rely on pgxmock DeepEqual for nil vs `[]string{}` (unverified, no module cache) (A-3) | no | closed @ 2 (accepted → D-8 matcher) |
| O-10 | 2 | Reuse `testUserID`/`dbtestUserPrefix` + extend existing cleanup (A-4; C-18 DRY) | no | closed @ 2 (accepted → D-8) |
| O-11 | 2 | Name internal-caller truncation (`portfolio_service.go:787,932,1214,1283` read first 500, discard token) as a follow-up defect beside D-6 items (A-5) | no | closed @ 2 (accepted → design.md follow-ups) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
