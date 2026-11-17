# Design: fix-listwatchlists-page-token

**Created**: 2026-11-17
**Rounds**: 5 debate rounds + 4 post-cap confirmation passes (full; user overrode the 5-round cap "until design is sound"; termination: approved — pass 4 verdict SOUND)
**Approved by**: user @ 2026-11-17 (with explicit C-14 sign-off, see § Constitution Rules Touched)
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-23, R-1..R-13, O-1..O-16)

---

## Chosen Approach

**Fix (portfolio only).** In `WatchlistRepo.ListByUser` (`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:107-156`), set `nextToken = wls[pageSize-1].WatchlistId`, the last row actually returned, instead of the look-ahead row `wls[pageSize]` (`:139`). The keyset predicate stays exclusive (`watchlist_id > $2::uuid`, `:114`); the bug is a mismatch between token and predicate, and the token side is fixed (D-1; precedent `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:954-958`). The `pageSize+1` look-ahead stays, used only to decide whether another page exists. An exactly-full last page and an empty result therefore both return `""`. Truncation stays before the bindings batch, so the look-ahead row is never read (D-2; feature-178 rule). `watchlist_id` is the primary key (`migrations/007_watchlists.up.sql:6-14`), so the keyset has no ties.

**Test seam.** Route the main page query through the existing mockable `r.db` instead of `r.pool` (`:111`). This is identical in production because `NewWatchlistRepo` sets `db: pool` (`:32-34`) and is the only constructor (D-3). Two comments change, each to at most 2 lines stating the constraint (D-11):
- `:135-136` becomes: "Token must be the last RETURNED id (the next page's WHERE is a strict >); truncate the +1 / lookahead before the bindings batch so the lookahead row is never read."
- `:27-28` becomes one line: "db is the mockable query surface (pool in prod, pgxmock in tests); route every query through it."

**Landing (D-8).** One `**Lands with**` unit, committed once. The reason for the unit is one red-green cycle and one F-08-staged commit: neither a red tree nor an untested seam is ever committed.
- **Step 1, `service`**, `watchlist_repo.go`: seam, fix, comments.
- **Step 2, `test`**: `watchlist_repo_test.go`, `dbtest_helpers_test.go`, and a new `watchlist_list_dbtest_test.go`.
- **Order:** seam → write tests → RED → fix and comments → GREEN → one commit.

**Tests (D-9, D-12–D-14, D-16).**
- **Unit tests** (pgxmock, `repo := &WatchlistRepo{db: mock}`):
  - Main-query regex pins the exclusive `>` and `LIMIT $3`, with `WithArgs("u1","",3)` (no `AnyArg`, R-11).
  - File-local helpers `listPageRows` (the 8 `scanWatchlist` columns) and `expectNoBindings`.
  - `TestListByUser_TokenIsLastReturnedRow`: rows wl-a, wl-b, wl-c at pageSize 2 → token `wl-b`. **RED** on current code: returns `wl-c`.
  - `TestListByUser_ExactlyFullPageHasNoToken`: **guard**, token `""`.
- **dbtest** `TestListByUser_PageTokenTraversal` (`//go:build dbtest`):
  - The parent owns `testPool`, `NewWatchlistRepo` and `testUserID`. It seeds `wl-0..2` once via the new `seedNamedWatchlist`, then `t.Fatalf` unless 3 rows were seeded, and sorts the ids.
  - `seedWatchlist` keeps its signature and delegates to `seedNamedWatchlist` with `"wl-"+userID`.
  - Subtests use only the parent's state through the closure, each with its own shadowed `t`:
    - `AC-1_page_size_1_traversal` (loop capped at len+2): **RED**, returns `[a c]`.
    - `AC-2_page_size_2_token`: **RED**, token `c`.

**Evidence contract (D-10, D-17).** All commands run from `services/xstockstrat-portfolio`.
- **Unit RED/GREEN:** `GOWORK=off go test -race -count=1 -v -run 'TestListByUser_' ./internal/repository/`.
- **dbtest RED/GREEN** run on a real backend: TimescaleDB if one is available. Otherwise an ephemeral plain-PG16 cluster:
  - run as the non-root `postgres` OS user, with the data dir outside the scratchpad;
  - a no-op `public.create_hypertable` shim;
  - the **full** migration chain with `ON_ERROR_STOP=1` (feasibility proven 2026-11-17: all 19 migrations applied).
- **Valid evidence:** per-subtest `--- FAIL` / `--- PASS` lines. Any SKIP invalidates the run.
- **GREEN of record:** CI `portfolio-db-test`, plus a local `go test -tags dbtest -list …`.
- **Regression:**
  - `go test ./...`
  - `go vet -tags dbtest ./...`
  - `golangci-lint run` (lints dbtest files via `.golangci.yml:26-29`)
  - the full repository dbtest package on the harness
- **Deviation fallback:** only if neither database can start (P-03).
- **PR body and context.md must disclose:**
  - unit RED was captured post-seam / pre-fix;
  - dbtest RED ran on the unmodified query path;
  - the harness fidelity delta (`portfolio.snapshots` is not a hypertable; watchlist DDL is verbatim);
  - the mixed-fleet note;
  - consumer impact.

**Requirements (D-21–D-23).** FR-1 and FR-2 (product-spec.md) describe the fully rolled-out fix. FR-1 is limited to lists that exist throughout the traversal.

**Consumer surfaces (C-14; D-5, D-18–D-20).** No code changes outside portfolio.
- **Agent MCP `list_watchlists`** (`services/xstockstrat-agent/app/tools.py:2153-2166`, `app/client.py:416-432`) is the user-reachable surface. It is a single passthrough, reached by the fix with no code change. Its docstring "Pagination is stable across pages." (`:2155`) becomes true once the rollout completes. It gets no step, under the user sign-off below.
- **UI** (`services/xstockstrat-ui/src/hooks/useWatchlists.ts:33`) makes a single call of 50 rows and never follows the token, so it is unaffected.
- **Analysis drains** (`services/xstockstrat-analysis/app/engine/live_loop.py:592-623`, `services/xstockstrat-analysis/app/handlers/servicer.py:5995-6027`) send 1000, which the repo clamps to 100. They stay single-page while `watchlist.max_per_user` is 50. If an owner ever has more than 100 lists, the drains now return every list instead of dropping one per page.
- **Post-merge dev smoke (D-19):** agent `list_watchlists` with `limit` below the list count, run after rollout. It goes on the launch checklist and is not a step.

**Not changed (D-6, D-7).**
- No proto comment and no PORTFOLIO-* constitution entry. The durable home is this feature's `@AC-*`, promoted at launch.
- No mixed-fleet shim. During rollout, an old token sent to a new server skips one list once (the same loss as today). A new token sent to an old server resumes correctly.
- No proto, migration or config change.

## Rejected Alternatives

- `R-1` Pure `pageAndToken` helper with no seam: a single-caller unit (C-18) that leaves the SQL, args and bindings call untested offline.
- `R-2` Token = look-ahead row with an inclusive `>=` predicate (the QueryBars convention): contradicts the operator constraint and changes where a cached token resumes.
- `R-3` Drop the look-ahead: an exactly-full last page would return a token followed by a spurious empty page.
- `R-4` dbtest-only proof: violates the operator constraint, and the dbtest skips outside CI.
- `R-5` Commit a reusable PG16+shim harness: speculative scope, and a second test-DB recipe that would drift from CI.
- `R-6` Partial migration chain: misses `008` (`strategy_id`), so RED would fail for the wrong reason.
- `R-7` Install TimescaleDB locally: not available here. It stays first choice wherever it is available.
- `R-8` Push a red commit to get a CI RED: F-05, and CI is PR-only.
- `R-9` Add `-v` to the CI dbtest job: out of scope; `ok` plus `-list` is enough.
- `R-10` Dedicated agent code/test step: ceremony for a passthrough, and mocked agent tests cannot prove token semantics.
- `R-11` `pgxmock.AnyArg()` for LIMIT: drops the `pageSize+1` pin, and an execute-time choice risks an unlogged step edit (F-09).
- `R-12` `docs` runbook step as the agent's C-14 step: fails `spec-template.md:107-108` and `impl-spec-criteria.md:31`; its "exactly once" wording was inaccurate.
- `R-13` Verification sub-bullet in Step 2: not an agent step, and it would cross surfaces inside a Lands-with unit.

## Open Risks

- [ ] The pgxmock main-query regex is whitespace-sensitive within a line, so a reformat of the SQL breaks the unit tests for an unrelated reason. Accepted, because it guards R-2. **Step 2:** if RED shows "could not match actual sql", fix the regex, not the RED.
- [ ] Local dbtest evidence may come from PG16 plus the shim rather than TimescaleDB (fidelity delta: `portfolio.snapshots` only). **Step 1+2 PR:** disclose it; CI `portfolio-db-test` is the GREEN of record.
- [ ] Mixed-fleet window (D-7): one list can be skipped once during rollout. **Launch:** run the dev smoke only after rollout completes (D-19).
- [ ] The analysis drains still don't fail closed or reject a repeated token (fails.md:3312). This existed before this fix and is out of scope; the fix keeps tokens strictly increasing. **Owner:** a separate defect, if wanted.
- [ ] `/sdd-review impl-spec` will flag the agent surface at `impl-spec-criteria.md:31`. **`/sdd-spec`:** the Execution Summary and the Deviation Log row must cite the C-14 override, not a deferral.

## Constitution Rules Touched

- `C-01`/`F-04`: honored. Every citation was checked against the code (recon plus 4 confirmation passes). D-21–D-23 correct drifted citations.
- `C-08`: honored. A `service`+`test` pair in one Lands-with unit (D-8).
- `C-13`: honored. pgxmock rows are SQL-shape scenario one-offs (D-16); no `internal/testdata/` addition.
- **`C-14`: overridden by explicit user sign-off (2026-11-17), recorded verbatim:**
  > "C-14 override, user sign-off: the agent MCP tool list_watchlists (services/xstockstrat-agent/app/tools.py:2153-2166, client.py:416-432) gets no implementation step of its own in feature 354. It is a single passthrough call with no agent-side token logic: page_token and next_page_token go straight through. The portfolio fix reaches it with no code change, and its 'Pagination is stable across pages' docstring becomes true unedited once the portfolio rollout completes. During the mixed-version rollout an old-to-new token hop can skip one list once, which is the same loss as today. The surface is named in the product spec's Consumer Surface(s) section. Its passthrough contract stays guarded by agent @AC-1 @feature-148, which does not check token meaning. A post-merge dev smoke test will exercise it after rollout; it is not offered as satisfying C-14. This is an override, not a deferral; there is no follow-up feature."
- `C-15`: honored. FR-1/FR-2 were added; `@AC-1 @FR-1 @FR-2` and `@AC-2 @FR-2`.
- `C-16`: honored. 7 PRESERVE rules and 1 EXTEND, no CHANGE (see below).
- `C-18`: honored. Minimum change (one index plus a documented seam); YAGNI rejections R-1, R-5, R-10, R-12.
- `P-03`: honored. RED post-seam disclosure (O-11); the deviation fallback only when no database can start.
- `P-06`: honored. Real-backend dbtest RED plus unit RED, both assertion failures, with the evidence contract in D-10/D-17.
- `F-01`: honored. No migration.
- `F-05`: honored. No red commit; one-unit landing.
- `F-08`: honored. Staging is the union of the unit's Files.
- `F-09`: honored. An execute-time mock mismatch goes to the Deviation Log.

## Business Rules Touched (C-16)

- PRESERVE `@AC-2 @feature-178` "Watchlist bindings resolve in one query" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`): not regressed. Truncation stays before the single ANY-array batch, and the unit mocks pin `WithArgs([]string{a,b})`.
- PRESERVE `@AC-1 @feature-148` "list_watchlists returns only the caller's own lists, paginated" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`): shape and string token unchanged; `user_id = $1` untouched.
- PRESERVE `@AC-2 @feature-180` (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`): owner-scoped drain unchanged, and now lossless.
- PRESERVE `@AC-6 @feature-191` (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature`): drain loop unchanged.
- PRESERVE `@AC-2`, `@AC-3 @feature-168` (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`): indirect; the universe only gets more complete.
- PRESERVE `@AC-6 @feature-167` (`services/xstockstrat-ui/acceptance/watchlist-single-strategy-update.feature`): UI untouched.
- EXTEND: new `@AC-1`/`@AC-2` (this feature) state the ListWatchlists page-token guarantee. They are promoted to the portfolio suite at launch.
