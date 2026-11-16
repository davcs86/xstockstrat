# Debate Register: ensure-signals-watchlist-on-read

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 7 | 5 | 8 | 8 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | `ListWatchlists` lists first (`ListByUser`, as today, `CodeInternal` on error); only when `page_token == ""` **and** the loaded page has no `system_managed` row does it call the existing `EnsureSystemManaged(ctx, userID, signalWatchlistDefaultName)` and then re-list with the same args. Continuation pages never ensure. `requireUserID` stays first (AC-8). No new store method; connect handler and gRPC adapter unchanged. | `portfolio_service.go:2246-2265`, `:2211`, `:2005`; `portfolio_handler.go:182-188,339-345` | settled |
| D-2 | 1 | Skip the re-list when the ensured row provably belongs to a later page: `next != "" && ensured.WatchlistId > lastReturnedID` (string compare equals Postgres uuid byte order — pgx scans canonical lowercase hyphenated text). Cuts the recurring small-`page_size` path from ~8 to ~6 round trips. Adopted from O-5; supersedes the proposer's R-e rejection rationale (which was factually wrong). | `watchlist_repo.go:65-104,585-596` | settled |
| D-3 | 1 | Fail-open: ensure error → `slog.WarnContext(ctx, "ListWatchlists: ensure system watchlist failed; returning existing lists", "error", err)` with the original error, return the step-2 page; ensure ok + re-list error → WARN and return the original page. No WARN when `ctx.Err() != nil` (cancelled request ≠ degraded store). No telemetry counter (WARN-only is the in-service pattern). | `portfolio_service.go:578-580` (`refuseUnservable`) | settled |
| D-4 | 1 | Concurrency needs no transaction: the partial unique index `watchlists_user_system_uidx` is the `ON CONFLICT` target, shared with the agent's `EnsureSignalWatchlist`; exactly one system list per user under READ COMMITTED + PgBouncer transaction mode. | `migrations/011_…up.sql:26-28`, `watchlist_repo.go:68-79` | settled |
| D-5 | 1 | Test plan refinements: unit tests via `newSvc`/`ctxWithUser`/`fakeWatchlistStore` with test-only hooks (`ensureErr`, `ensureCalls`, `relistErr`, keyset-honoring `ListByUser` returning a last-row token); a **real-backend dbtest** for the token traversal (page_size 1 over 3 rows = 3 unique) and 5 concurrent `EnsureSystemManaged` = 1 row (AC-2 against the real index), using a **new named-seed helper variant** (existing `seedWatchlist` fixes the name `"wl-"+userID` and would violate `watchlists_user_name_not_system_uidx`; do not change its signature — four feature-281 dbtests call it) and a widened `lock_timeout` (helper sets 500 ms); AC-2's RPC-level clause covered by composition (sequential "repeat 5× same id" unit case + dbtest concurrency); AC-4 captures the WARN with the existing slog-buffer precedent (`portfolio_quote_deadline_test.go`, `portfolio_telemetry_test.go`). The keyset-honoring fake must not be the only proof of the paging fix (fails.md 257 / 2783-2786). | `dbtest_helpers_test.go:35,57-63`; `watchlist_service_test.go:32-48,146,246-257` | settled |
| D-6 | 1 | **Operator (gate, round 1): the `ListByUser` token bug is split out as its own defect, not bundled.** `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md` filed (status `open`) and a fix session launched. Consequences for this design: AC-7 is relaxed to "exactly one system list afterwards, none created on a repeat call" (a complete small-`page_size` traversal is owned by the defect); D-5's real-backend traversal case ("page_size 1 over 3 rows = 3 unique") is **withdrawn from this feature** — the dbtest keeps only the concurrent-ensure case; the agent docstring sentence "Pagination is stable across pages" (O-8) is left unchanged and stays inaccurate until the defect lands; no repository change in this feature. | `watchlist_repo.go:138-141`; `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md` | settled |
| D-7 | 1 | **Operator (gate, round 1): accept 49 manual lists.** The system list counts toward `watchlist.max_per_user` (`CountByUser` counts every row); no code change; error text still reads "watchlist limit reached: <max>" and the user sees max lists including Signals. Spec corrected (FR-8, AC-10, Out of Scope, Open Questions). | `watchlist_repo.go:438-441`; `portfolio_service.go:2186-2192` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Always ensure before listing on every first page | ~6 round trips + a write attempt on every analysis drain and UI load for nothing in the steady state (Signals already on page 1) | locked |
| R-2 | 1 | Ensure, then merge/append the ensured row onto page 1 | Breaks `page_size`; the row reappears on a later page when its uuid is past the token (duplicate) | locked |
| R-3 | 1 | `ORDER BY system_managed DESC, watchlist_id` with a compound opaque token (guarantees Signals on page 1) | Technically viable (token is opaque, no proto change) but excluded by the spec's Out of Scope ("pagination order") and changes every caller's token format; would also remove the UI's 51st-list loss without UI code — recorded as the road not taken | locked |
| R-4 | 1 | New "ensure-only / existence-check" store method run before listing | Interface + `WatchlistRepo` + `fakeWatchlistStore` change; +1 round trip and a write attempt in the common case (steady state today is 2); wins only for users with more lists than `page_size`. D-1+D-2 is the better default | locked |
| R-5 | 1 | Bundle the `ListByUser` `next_page_token` fix (and a new FR-8 token contract) into this feature | Operator chose to split it to a separate defect/fix session (D-6); keeps this feature's diff to the ensure and avoids silently widening the analysis symbol universe under a feature about a watchlist row | locked |
| R-6 | 1 | `CountByUser … AND NOT system_managed` to keep the manual cap at 50 | Operator chose to accept 49 (D-7): a one-line change, but a user at 50 manual + Signals would hold 51 lists and one would fall off the UI's unpaginated page of 50, and the UI is out of scope | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | **Scope of the token fix.** `watchlist_repo.go:138-141` sets `nextToken = wls[pageSize].WatchlistId` (the look-ahead row) while the next page filters `watchlist_id > token` (`:114`), so the row at every page boundary is skipped today (a<b<c, page_size 1 → a, c). AC-7 and agent feature-148 @AC-1 (`limit 1`) cannot pass without it, but the product spec's Out of Scope excludes "pagination order" and any agent-tool behavior change, and no FR covers the token contract; analysis owners with >100 lists would also see their symbol universe grow (`live_loop.py:601-622`, `servicer.py:6006-6026`). P-03/P-04/C-15. Orchestrator-verified. | yes | closed @ round 1 (user: split to a separate defect, D-6/R-5) |
| O-2 | 1 | **Cap interaction.** `CreateWatchlist` rejects at `count >= max` (`portfolio_service.go:2186-2192`) and `CountByUser` counts every row (`watchlist_repo.go:438-441`), so once Signals exists every user's manual cap drops 50 → 49; the spec says the system list is "not counted" (`product-spec.md` Out of Scope + Open Questions) — false in effect. With ensure-on-read this hits (nearly) every user, not an edge. Orchestrator-verified. P-03. | yes | closed @ round 1 (user: accept 49 manual, D-7/R-6) |
| O-3 | 1 | **Twin defect.** `ListPositions` has the identical look-ahead token bug (`portfolio_repo.go:162,194`) and keysets on `symbol` alone for a table unique on `(user_id, symbol, trading_mode, account_id)`. Out of scope to fix; must be filed under `docs/reports/` (with `.status` sidecar) and named in `design.md` (C-10, P-03). Orchestrator-verified. | no | closed @ round 1 (user: file report; `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md` filed, fix session launched) |
| O-4 | 1 | Test plan dependency: `seedWatchlist` fixed-name helper, `lock_timeout=500ms`, AC-2 RPC clause uncovered by a mutex-less fake, AC-4 slog precedent | yes (impl-spec) | closed @ round 1 (adopted into D-5) |
| O-5 | 1 | Cost figures understated (8 round trips, not ~7), re-list provably useless on the recurring path, "page 1 whenever page_size ≥ list count" not a platform invariant (`max_per_user` can be set per user, e.g. 200) | no | closed @ round 1 (adopted: D-2; claim corrected to "page_size ≥ count including Signals") |
| O-6 | 1 | C-16 caveat: `@AC-2 @feature-178` "bindings resolve in one query" — the ensure path adds `GetByID`→`listBindings` queries | no | closed @ round 1 (design.md classifies PRESERVE-by-intent, extra queries bounded O(1) per call, once per user) |
| O-7 | 1 | Fail-open WARN volume under persistent failure / cancelled contexts | no | closed @ round 1 (adopted: D-3, no WARN on `ctx.Err() != nil`) |
| O-8 | 1 | Agent docstring already claims "Pagination is stable across pages" (`tools.py:2155`) — false until the token fix | no | closed @ round 1 (FR-7 docstring edit keeps the sentence; it becomes true via the token fix if O-1 is bundled) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
