# Debate Register: fix-listpositions-nextpagetoken-skips

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 bound counts this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 6 | 5 | 5 | 6 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Fix at the single site `PortfolioRepo.ListPositions`: cursor = last RETURNED row's (symbol, trading_mode, account_id); SQL `(symbol, trading_mode, account_id) > (...)` with `ORDER BY symbol, trading_mode, account_id LIMIT pageSize+1`; filters stay ANDed before LIMIT. Verified correct by the adversary (lexicographic row compare, NOT NULL columns, unique per user, same collation in compare and ORDER BY) | `portfolio_repo.go:134-198`; `migrations/003_positions_account_id.up.sql:8-10`; `marketdata_repo.go:913-921,954-958`; insights.md:3547 | settled |
| D-2 | 1 | Token encoding = base64url(JSON array of exactly 3 strings); unexported encode/decode beside `ListPositions`. Bare legacy symbol fails decode deterministically | `account_id` free-form TEXT `003:2`; adversary verified `"AAPL"`/`"BRK.B"` rejected | settled |
| D-3 | 1 | `trading_mode` reaches the cursor via `scanPositionRowWithMode` (wrapper keeps `scanPositionRow` signature); no `Position` proto change | `portfolio_repo.go:253-293,297`; callers `:131,:182,:626` + tests `portfolio_repo_test.go:26,33` | settled |
| D-4 | 1 | Malformed/legacy token → `repository.ErrInvalidPageToken` before any query → handler maps to `InvalidArgument` (today every error is `CodeInternal`). Deliberate departure from marketdata "resume page 1": silent restart makes `_drain_held_symbols` re-add `abs(market_value)` (fails.md:3309-3312). Must be recorded in design.md as a deliberate deviation | `portfolio_handler.go:113-116,417-422,447-448`; `servicer.py:6431-6433`; `live_loop.py:582-585` | settled |
| D-5 | 1 | No proto, migration, or config change; enrichment stays once per RPC page (`@AC-1 @feature-178` preserved) | `common.proto:10-18`; `portfolio_service.go:894-915` | settled |
| D-6 | 1 | Out of scope: analysis drain hardening (equal-token guard, cap-hit log, fail-closed) and `WatchlistRepo.ListByUser` (same bug, other session) — design.md names them as follow-up defect reports, not "later" | fails.md:3265, 3309-3312; `watchlist_repo.go:139` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Numeric offset token | `portfolio.positions` mutated continuously (sync delete+upsert, fills): offsets shift between pages → drains double-count/skip (fails.md:3309); O(offset) | locked |
| R-2 | 1 | `(symbol, position_id)` cursor | `position_id` not in `positionColumns` (same scan-wrapper cost); no `(user_id, symbol, position_id)` index → sort per page; arbitrary within-symbol order | locked |
| R-3 | 1 | Accept legacy bare-symbol tokens (`symbol > $n` fallback) | Keeps the buggy path alive behind a sniffing heuristic for a seconds-long deploy window (C-18 YAGNI) | locked |
| R-4 | 1 | Pipe-joined `symbol\|mode\|account` | Assumes symbols never contain `\|` (offline symbols not provably constrained); near-tie, base64(JSON) chosen | locked |
| R-5 | 1 | Malformed token resumes from page 1 (marketdata precedent) | Silent restart re-adds `abs(market_value)` in `_drain_held_symbols` and can loop consumers; reject instead (D-4) | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | **Test-pin blast radius miscounted and not mechanical** (adversary O-A; P-03/C-01/C-18): `FROM portfolio.positions` regex also matches GetPosition/DELETE/realized/fees/Count queries; dropping the page-1 bind makes ListPositions 2/3 args = the old GetPosition count, so unedited pins can silently match the wrong query; shared-count loops (`portfolio_mark_test.go:136`, `offline_account_pnl_test.go:297,478`, `export_test.go:29-31`) must be split. Options: (a) keep page-1 `($n='')` + args, only cursor pages bind 3 values → zero pin edits; (b) single `text[]` cursor arg every page → ~3 exact-pin edits; (c) accept edits but enumerate every site by path:line | yes (approval) | open |
| O-2 | 1 | **Unlisted consumer `/trader/positions`** (adversary O-B; C-14): `page.tsx:54-55,83,548-551`, `usePortfolio.ts:43-52`, `traderBff.ts:81` paginates with `nextPageToken` + `pageStack`; reject policy gives InvalidArgument on Next/Previous with stale in-state tokens across a deploy. product-spec lacked `## Consumer Surface(s)` | no | closed @ 1 (accepted: product-spec amended to name the UI page + agent tool; no code change, straddle error accepted, rendering via `QueryStateMessages` to be confirmed in /sdd-spec) |
| O-3 | 1 | Record the InvalidArgument-vs-resume departure explicitly in design.md (adversary O-C; C-18) | no | closed @ 1 (accepted → D-4, R-5) |
| O-4 | 1 | Document that a drain straddling a deploy fails one cycle (`record_live_loop_drain_failure("held")`, `@AC-16 @feature-294` preserved) and that drains request 1000 but repo clamps >500 to 100, so users with >100 positions hit the bug in production (adversary O-D) | no | closed @ 1 (accepted → Open Risks / design.md) |
| O-5 | 1 | RED proof must assert the exact ordered sequence `[(A,X),(A,Y),(B,X),(C,X)]` with no repeats, not a count (current code returns [A@X, B]) (adversary O-E; P-06/C-15) | no | closed @ 1 (accepted → test plan; keep 7-rows-at-page-size-3) |
| O-6 | 1 | Add a dbtest collation case (`acct_1`,`Acct-1`,`acct-1` in one symbol+mode) and state TEXT-vs-TEXT binding (adversary O-F; minor) | no | closed @ 1 (accepted → test plan) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
