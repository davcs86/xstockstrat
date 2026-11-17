# Debate Register: fix-listwatchlists-page-token

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-design | 7 | 4 | 1 | 9 | 0 | yes |
| 2 | 2026-11-17 | /sdd-design | 5 | 5 | 11 | 3 | 0 | yes |

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
| D-8 | 2 | Landing = one `**Lands with**` unit: Step 1 `service` (`watchlist_repo.go`: seam (a) `:111` r.pool→r.db, fix (b) `:139`, comment (c) `:134-136`, field comment `:27-28`) + Step 2 `test` (`watchlist_repo_test.go`, `dbtest_helpers_test.go`, new `watchlist_list_dbtest_test.go`). Order: (a) → write tests → RED → (b)+(c) → GREEN → one commit. Stated reason for the unit: one red-green cycle and one F-08-staged commit, so neither a red tree nor an untested seam is ever committed (not "Step 2 cannot pass without Step 1"). | `tdd-gate.md:17-18,35-38`; `step-constraints.md` §C; F-05, F-08 | settled |
| D-9 | 2 | Tests: unit `TestListByUser_TokenIsLastReturnedRow` (Case A, pageSize 2, rows a,b,c → token b; **RED**: got c), unit `TestListByUser_ExactlyFullPageHasNoToken` (Case B, **guard**), dbtest `TestListByUser_PageTokenTraversal/AC-1_page_size_1_traversal` (**RED**: got [a c]) and `/AC-2_page_size_2_token` (**RED**: token c). Unit mocks pin the bindings batch to `WithArgs([]string{a,b})` (feature-178). No separate dbtest exactly-full subtest (AC-1's last page is exactly full). Parent test owns `testPool`/`NewWatchlistRepo`/`testUserID`, seeds 3 lists once via `seedNamedWatchlist`, `t.Fatalf` unless 3 seeded, sorts ids; subtests use closure only, never `testPool`; AC-1 loop capped at len+2. | `dbtest_helpers_test.go:22-68`; `watchlist_repo_test.go:16-34`; `watchlist_repo.go:585-590` | settled |
| D-10 | 2 | RED/GREEN evidence contract (cwd `services/xstockstrat-portfolio`): (i) unit RED+GREEN `GOWORK=off go test -race -count=1 -v -run 'TestListByUser_' ./internal/repository/`; (ii) dbtest RED+GREEN on a migrated TimescaleDB if available, otherwise an **ephemeral** plain-PG16 harness: `initdb`/`pg_ctl` run as the non-root `postgres` OS user (session runs as root) with data dir outside the scratchpad, no-op `public.create_hypertable(regclass, name, interval DEFAULT NULL, boolean DEFAULT false)` shim, then the **full** `migrations/*.up.sql` chain in order with `ON_ERROR_STOP=1`; run `PORTFOLIO_DB_TEST_URL=… GOWORK=off go test -tags dbtest -race -count=1 -v -run 'TestListByUser_PageTokenTraversal' ./internal/repository/`; evidence = per-subtest `--- FAIL`/`--- PASS`; any SKIP or "PORTFOLIO_DB_TEST_URL unset" invalidates; record the fidelity delta ("PG16 + no-op create_hypertable shim; only `portfolio.snapshots` is not a hypertable; watchlist DDL verbatim"); (iii) GREEN of record also from CI `portfolio-db-test` (TimescaleDB) + local `go test -tags dbtest -list 'TestListByUser_PageTokenTraversal' ./internal/repository/`; (iv) deviation fallback (P-03, unit Case A as RED stand-in) only if neither DB can start. Unit RED is captured post-seam (a), pre-fix (b); dbtest RED on the unmodified query path — state this in the PR body and context.md. | Orchestrator smoke 2026-11-17: PG16 + shim applied all 19 portfolio migrations, `watchlist_symbols.strategy_id,source` present; `migrations/001_portfolio_hypertable.up.sql:35-40` is the only TimescaleDB call (`010` mentions it only in a comment); `008_*.up.sql` adds `strategy_id` (needed by the bindings query); `ci.yml:1017-1065` | settled |
| D-11 | 2 | Comments (≤2 lines, constraint-only): replace `watchlist_repo.go:135-136` with "// Token must be the last RETURNED id (the next page's WHERE is a strict >); truncate the +1" / "// lookahead before the bindings batch so the lookahead row is never read." (history pointer "(feature 178)" dropped, How-to-Act #5); and trim the `db` field comment `:27-28` to one constraint line covering both queries, e.g. "// db is the mockable query surface (pool in prod, pgxmock in tests); route every query through it." | `watchlist_repo.go:24-29,134-136`; root CLAUDE.md How to Act #5 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Extract a pure `pageAndToken(wls, pageSize)` helper, no seam change | Single-caller new unit (C-18 YAGNI); leaves SQL args / LIMIT / bindings call untested offline; may diverge from the ListPositions twin's shape | locked |
| R-2 | 1 | Keep token = look-ahead row and make the predicate inclusive `>=` (the `QueryBars` convention, `marketdata_repo.go:130,145-149`) | Contradicts the binding operator constraint (token = `wls[pageSize-1]`); changes which row a cached old token resumes at | locked |
| R-3 | 1 | Drop the look-ahead; emit a token whenever `len(wls)==pageSize` | Exactly-full last page returns a non-empty token + an extra empty page — consumer-visible behaviour change (agent surfaces a spurious token) | locked |
| R-4 | 1 | dbtest-only proof, no unit test | Violates the operator constraint; dbtest skips outside CI without a DB, leaving non-CI runs with nothing that executes | locked |
| R-5 | 2 | Commit a reusable PG16 + shim harness (script / Make target) for local dbtests | Speculative scope (How-to-Act #2/#3, C-18); a second test-DB recipe that drifts from the TimescaleDB CI job — keep the harness ephemeral, evidence-only | locked |
| R-6 | 2 | Partial migration chain (only the watchlist migrations, skip 001) | Hand-picked subset misses `008` (`strategy_id`) → RED for the wrong reason (column missing), GREEN unattainable; rots as new migrations land | locked |
| R-7 | 2 | Install the TimescaleDB extension package locally | Best fidelity, but no package in this container (feasibility only) — first choice wherever it IS available (folded into D-10 (ii)) | locked |
| R-8 | 2 | Push a red commit to a scratch PR to obtain CI RED | F-05 (no red commit); CI runs only on PRs / pushes to main-dev/main (`ci.yml:3-8`) | locked |
| R-9 | 2 | Add `-v` to the `portfolio-db-test` CI job | Out of scope for this bug; `ok` + `-list` is adequate secondary evidence | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Three-step landing (seam refactor alone → RED commit → GREEN) breaks the TDD gate: the refactor step adds no characterization test (`tdd-gate.md:55-58`) and a committed red step trips F-05. Must be one code-bearing unit or test+service paired with `**Lands with**` (C-08): seam → tests → RED (assertion failure) → fix → GREEN. | yes | closed @ 2 (D-8: one Lands-with unit, seam inside it, no red commit) |
| O-2 | 1 | dbtest `t.Skip`s without `PORTFOLIO_DB_TEST_URL` outside CI (`dbtest_helpers_test.go:25-30`); RED/GREEN must be captured where it actually runs (local migrated Postgres or `portfolio-db-test` CI) with `-v` showing `--- FAIL`/`--- PASS`, never `SKIP` (P-06; fails.md:2786). | yes | closed @ 2 (D-10: real-backend RED/GREEN via TimescaleDB or ephemeral PG16+shim full chain — feasibility proven by orchestrator smoke; deviation only as last resort) |
| O-3 | 1 | Subtest cleanup hazard: `testPool` registers a delete of all `it-281-%` rows (`dbtest_helpers_test.go:42-47`); a subtest calling `testPool` would wipe the shared fixture. Parent must own pool + seed once (or seed per subtest) and assert `len(seeded)==3`. | yes | closed @ 2 (D-9: parent owns pool + seed, closure-only subtests, len==3 asserted) |
| O-4 | 1 | Added comment makes the `:135-136` block 3 lines and restates the SQL — breaks CLAUDE.md How-to-Act #5 (cap 2 lines, constraints only). Rewrite the block to ≤2 lines carrying the "token = last returned id" constraint, or drop it. | yes | closed @ 2 (D-11: exact 2-line constraint comment) |
| O-5 | 1 | Precedent citation `marketdata_repo.go:716-766,808-820` (from insights.md:3548) has drifted; correct is `:954-958` (C-01/F-04). Also note the inclusive `QueryBars` variant (`:130,145-149`) is correct in its own right — do not "harmonize" it. | no | closed @ 2 (precedent `marketdata_repo.go:954-958` in D-1; QueryBars inclusive variant guarded by R-2) |
| O-6 | 1 | Proposer's "unverified pgxmock time.Time / nullable columns" assumption: `description` and `default_strategy_id` are `TEXT NOT NULL DEFAULT ''` (`migrations/007_watchlists.up.sql:10`, `015_watchlist_default_strategy.up.sql:8`), scanned into `string`. | no | closed @ 1 (verified by orchestrator; assumption replaced by the column types) |
| O-7 | 1 | RED honesty: unit Case B and the dbtest exactly-full subtest PASS on current code — label them regression guards; only dbtest AC-1, AC-2 and unit Case A are the RED assertions (`tdd-gate.md:35-38`). | no | closed @ 2 (D-9 labels RED vs guard; dbtest exactly-full subtest dropped) |
| O-8 | 1 | C-15: `acceptance.feature` lacks `@FR-N` tags and `product-spec.md` has no `FR-N` IDs — fix the story artifacts before `/sdd-spec`. | no | closed @ 2 (FR-1/FR-2 text + `@FR-*` tags agreed; applied to product-spec.md/acceptance.feature at design completion) |
| O-9 | 1 | Optional cross-user isolation check (second user's list never appears). Cheap but proves only "never leaked"; `user_id = $1` unchanged. Include or explicitly waive under C-18. | no | closed @ 2 (declined under C-18: `user_id = $1` untouched `watchlist_repo.go:114`; owner scoping guarded by PRESERVE `@AC-1 @feature-148`) |

| O-10 | 2 | Lands-with reason was wrong ("Step 2 cannot pass without Step 1"); `step-constraints.md` §C says plain service→test pairing is not a unit by itself — state the true reason or drop it (P-03). | no | closed @ 2 (D-8 restates the reason) |
| O-11 | 2 | Unit RED runs on a partly implemented tree (seam applied first) vs `tdd-gate.md:35` "pre-implementation tree" — justified (nil `pool` otherwise) but must be stated (P-06 honesty). | no | closed @ 2 (D-10 disclosure in PR body + context.md) |
| O-12 | 2 | `db` field comment `watchlist_repo.go:27-28` goes stale once the page query also reads through `db` (How-to-Act #5, C-18). | no | closed @ 2 (D-11 trims it) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
