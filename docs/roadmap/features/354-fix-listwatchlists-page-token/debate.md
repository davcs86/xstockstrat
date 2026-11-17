# Debate Register: fix-listwatchlists-page-token

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-design | 7 | 4 | 1 | 9 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Fix: `nextToken = wls[pageSize-1].WatchlistId` (last RETURNED row); predicate stays exclusive `watchlist_id > $2::uuid`. Token and predicate must agree — the bug is their mismatch. | `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:114,139`; precedent `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:954-958` (`last := out[pageSize-1]`) | settled |
| D-2 | 1 | Keep the `pageSize+1` look-ahead, used only to decide "more?" — exactly-full last page and empty result yield token `""` with no extra page; truncation stays before the bindings batch (feature-178). | `watchlist_repo.go:108-110,116,134-141,164-165` | settled |
| D-3 | 1 | Unit-test seam: route the main page query through the existing mockable `r.db` instead of `r.pool`. Prod-identical (`NewWatchlistRepo` sets `db: pool`, sole constructor). | `watchlist_repo.go:24-29,32-34,111`; `PortfolioRepo` same pattern `portfolio_repo.go:22-34` | settled |
| D-4 | 1 | dbtest seeding: add `seedNamedWatchlist(t, pool, userID, name string, systemManaged bool) string`; `seedWatchlist` becomes a one-line delegate passing `"wl-"+userID` (signature unchanged, no duplicated INSERT). | `internal/repository/dbtest_helpers_test.go:57-68`; `migrations/011_watchlist_system_managed_source.up.sql:20-22` | settled |
| D-5 | 1 | Consumers: no code change in analysis, agent, UI. Agent docstring "Pagination is stable across pages." (`tools.py:2155`) was false and becomes true → unchanged. | recon.md Codebase Map (analysis `live_loop.py:592-623`, `servicer.py:5995-6027`; agent `tools.py:2153-2164`; UI `useWatchlists.ts:33`) | settled |
| D-6 | 1 | No proto comment and no PORTFOLIO-* constitution entry; durable home of the token semantic = this feature's `@AC-*` promoted to the portfolio suite at launch (C-16) + regression tests. | C-18 YAGNI; recon.md § Existing Business Rules (EXTEND) | settled |
| D-7 | 1 | No mixed-fleet compatibility shim: both token kinds are bare UUIDs; old→new skips the old look-ahead row once (same loss as today), new→old resumes correctly. | recon.md § Risks (mixed fleet) | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Extract a pure `pageAndToken(wls, pageSize)` helper, no seam change | Single-caller new unit (C-18 YAGNI); leaves SQL args / LIMIT / bindings call untested offline; may diverge from the ListPositions twin's shape | locked |
| R-2 | 1 | Keep token = look-ahead row and make the predicate inclusive `>=` (the `QueryBars` convention, `marketdata_repo.go:130,145-149`) | Contradicts the binding operator constraint (token = `wls[pageSize-1]`); changes which row a cached old token resumes at | locked |
| R-3 | 1 | Drop the look-ahead; emit a token whenever `len(wls)==pageSize` | Exactly-full last page returns a non-empty token + an extra empty page — consumer-visible behaviour change (agent surfaces a spurious token) | locked |
| R-4 | 1 | dbtest-only proof, no unit test | Violates the operator constraint; dbtest skips outside CI without a DB, leaving non-CI runs with nothing that executes | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Three-step landing (seam refactor alone → RED commit → GREEN) breaks the TDD gate: the refactor step adds no characterization test (`tdd-gate.md:55-58`) and a committed red step trips F-05. Must be one code-bearing unit or test+service paired with `**Lands with**` (C-08): seam → tests → RED (assertion failure) → fix → GREEN. | yes | open |
| O-2 | 1 | dbtest `t.Skip`s without `PORTFOLIO_DB_TEST_URL` outside CI (`dbtest_helpers_test.go:25-30`); RED/GREEN must be captured where it actually runs (local migrated Postgres or `portfolio-db-test` CI) with `-v` showing `--- FAIL`/`--- PASS`, never `SKIP` (P-06; fails.md:2786). | yes | open |
| O-3 | 1 | Subtest cleanup hazard: `testPool` registers a delete of all `it-281-%` rows (`dbtest_helpers_test.go:42-47`); a subtest calling `testPool` would wipe the shared fixture. Parent must own pool + seed once (or seed per subtest) and assert `len(seeded)==3`. | yes | open |
| O-4 | 1 | Added comment makes the `:135-136` block 3 lines and restates the SQL — breaks CLAUDE.md How-to-Act #5 (cap 2 lines, constraints only). Rewrite the block to ≤2 lines carrying the "token = last returned id" constraint, or drop it. | yes | open |
| O-5 | 1 | Precedent citation `marketdata_repo.go:716-766,808-820` (from insights.md:3548) has drifted; correct is `:954-958` (C-01/F-04). Also note the inclusive `QueryBars` variant (`:130,145-149`) is correct in its own right — do not "harmonize" it. | no | open |
| O-6 | 1 | Proposer's "unverified pgxmock time.Time / nullable columns" assumption: `description` and `default_strategy_id` are `TEXT NOT NULL DEFAULT ''` (`migrations/007_watchlists.up.sql:10`, `015_watchlist_default_strategy.up.sql:8`), scanned into `string`. | no | closed @ 1 (verified by orchestrator; assumption replaced by the column types) |
| O-7 | 1 | RED honesty: unit Case B and the dbtest exactly-full subtest PASS on current code — label them regression guards; only dbtest AC-1, AC-2 and unit Case A are the RED assertions (`tdd-gate.md:35-38`). | no | open |
| O-8 | 1 | C-15: `acceptance.feature` lacks `@FR-N` tags and `product-spec.md` has no `FR-N` IDs — fix the story artifacts before `/sdd-spec`. | no | open |
| O-9 | 1 | Optional cross-user isolation check (second user's list never appears). Cheap but proves only "never leaked"; `user_id = $1` unchanged. Include or explicitly waive under C-18. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
