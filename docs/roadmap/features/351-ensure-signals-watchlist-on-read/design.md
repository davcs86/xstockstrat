# Design: ensure-signals-watchlist-on-read

**Created**: 2026-11-16
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-11-16T20:49:25Z
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

`PortfolioService.ListWatchlists` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:2246-2265`) idempotently ensures the caller's single system-managed "Signals" watchlist on first-page calls, reusing the existing store method `EnsureSystemManaged` (`portfolio_service.go:2005`, impl `internal/repository/watchlist_repo.go:65-84`) and the existing constant `signalWatchlistDefaultName` (`portfolio_service.go:1982`). Rests on D-1..D-12.

**Control flow (D-1, D-2, D-3, D-8):**
1. `requireUserID` first, unchanged (`portfolio_service.go:2143-2149`; empty identity → `InvalidArgument "missing user identity"`, no store call — AC-8).
2. `ListByUser(ctx, userID, pageSize, pageToken)` as today; an error returns `CodeInternal` and the ensure never runs (`:2257-2259`).
3. Only when `pageToken == ""` **and** no row on the loaded page has `system_managed = true` (`slices.ContainsFunc(wls, (*portfoliov1.Watchlist).GetSystemManaged)`), call one private helper `ensureSignalListOnFirstPage(ctx, userID, pageSize, wls, next)` that never returns an error:
   - `EnsureSystemManaged(ctx, userID, signalWatchlistDefaultName)`; on error WARN with the original error (only when `ctx.Err() == nil`) and return the original page — fail-open, operator-confirmed (D-10), same pattern as `refuseUnservable` (`portfolio_service.go:568-581`).
   - **Skip the re-list** when the ensured row provably belongs to a later page: `next != "" && len(wls) > 0 && ensured.GetWatchlistId() > wls[len(wls)-1].GetWatchlistId()` (D-2). The comparison uses ids, never the token value, so it survives the token fix; Go string order equals Postgres uuid order because pgx renders canonical lowercase text (`watchlist_repo.go:585-596`; proven by the D-9(b)/D-12(a) dbtest).
   - Otherwise re-list exactly once with the same arguments; a re-list error WARNs and returns the original page.
4. Continuation pages (non-empty token) never ensure (FR-3). Steady state — Signals already on page 1 — costs the same 2 round trips as today; the recurring small-`page_size` path (Signals past page 1) costs about 6 and is bounded by D-2.

**Nothing else changes (D-4, D-8):** no new store method, interface, handler, proto, config key, migration or UI code; no ledger event on creation (`EnsureSignalWatchlist` emits none; no consumer of `portfolio.watchlist.created`); no telemetry counter (WARN-only is the in-service pattern). Concurrency needs no transaction: the partial unique index `watchlists_user_system_uidx` (`migrations/011_watchlist_system_managed_source.up.sql:26-28`) is the `ON CONFLICT` target shared with the agent's `EnsureSignalWatchlist`, so concurrent calls yield exactly one system list per user.

**Consumer surfaces (C-14):**
- **Agent** `list_watchlists` — text only (FR-7, AC-9): reword "(read-only)" at `services/xstockstrat-agent/app/tools.py:33` and the tool docstring `:2153-2161` and `docs/runbooks/mcp-tools.md:1380-1396`, keeping the `### \`list_watchlists\`` heading (guard `tests/test_tools_endpoint.py:141-144`) and the sentence "Pagination is stable across pages" (D-6). No contract change, no tool-count change.
- **UI** `/insights` watchlists — **no code change (operator decision)**; effects accepted and recorded in Open Risks.
- **Analysis** (`live_loop.py:592-623`, `servicer.py:5995-6027`) — unchanged callers; an empty list adds no symbols or bindings.

**Cap (D-7, FR-8, AC-10):** `CountByUser` counts every row (`watchlist_repo.go:438-441`), so the system list takes one manual slot (49 manual at the default cap of 50). No code change.

**Token defect split out (D-6, R-5):** the `ListByUser` look-ahead token bug (`watchlist_repo.go:138-141`) and its `ListPositions` twin (`portfolio_repo.go:162,193-194`) are separate defects (`docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`, `…-listpositions-…`), owned by separate sessions. 351's final integration PR waits for the `ListByUser` fix (D-10, D-11).

**Tests (D-5, D-9, D-12):**
- Unit (`internal/service/watchlist_service_test.go`): `fakeWatchlistStore` hooks `ensureErr`, `ensureCalls`, `listCalls`, `listErrAt` (1 = first list fails, 2 = re-list fails) and a sorted / `id > token` / clamped `ListByUser` over **uuid-shaped ids**; **no 351 test asserts or follows a returned `next_page_token`**; WARN captured with the existing `recordWarns` buffer handler (`portfolio_quote_deadline_test.go:33-70`). AC-1, 2 (sequential), 4, 6, 7 fail before the change; AC-3, 5 (asserts `ensureCalls == 0`), 8 are characterization tests with a **recorded mutation-red** in `context.md` (drop the `pageToken == ""` condition → AC-3 fails; move the ensure before `requireUserID` → AC-8 fails); AC-10 is a pure characterization test; AC-9 is checked at review plus the agent guard test.
- dbtest (`internal/repository/watchlist_ensure_dbtest_test.go`, `//go:build dbtest`, via a `testPoolWithLockTimeout(t, timeout)` refactor of `dbtest_helpers_test.go:22-49` with `testPool` keeping `"500ms"`): (a) 5 concurrent `EnsureSystemManaged` → same id, exactly 1 system row; (b) ordering check — seed manual rows with explicit non-ascending ids (`ffffffff-ffff-4fff-bfff-fffffffffffe` first, then `00000000-0000-4000-8000-000000000001`, `…0002`), ensure, one `ListByUser(ctx, uid, 100, "")`, assert ids strictly ascending under Go `<`.

**Build order (D-11) — steps 1-3 proceed in parallel with the token-fix session; 4-5 wait:**
1. portfolio service + unit tests (paired, C-08).
2. portfolio dbtest.
3. agent docs (FR-7).
4. **Landing gate — fails if any check fails**: rebase on `origin/main-dev`; (i) `watchlist_repo.go` no longer contains `wls[pageSize].WatchlistId`; (ii) the fix's real-backend traversal dbtest exists and passes (`-tags dbtest`); (iii) the defect report's `.status` is `resolved` or the fix commit is an ancestor of `origin/main-dev`; drop 351's seeding/lock-timeout code where it duplicates the fix's helper and run `dry-reviewer`; record the output in `context.md`.
5. Integration PR: promote `@AC-*` into `services/xstockstrat-portfolio/acceptance/` (C-16), the signed agent `@AC-1 @feature-148` extension (must not say a `limit 1` caller "sees" Signals), and the merge-order row (below).

**Merge-order row** (written in the step-5 PR; `docs/roadmap/features/merge-order.md` Blocking Dependencies): `| ensure-signals-watchlist-on-read (351) | <fix-slug> (<NNN>) | **Hard — merge order only; <fix-slug> need not be launched.** 351's first-page ensure adds a system row for every user, creating page boundaries where ListByUser's look-ahead token (watchlist_repo.go:139) drops the boundary row (agent limit-1 traversals; owners ≥100 rows). Gate verified by 351 step 4 (context.md). | No |`; Resolved = Yes only once the fix is merged to main-dev.

## Rejected Alternatives

- `R-1` Always ensure before listing on every first page — rejected because it adds ~6 round trips and a write attempt to every analysis drain and UI load for nothing in the steady state.
- `R-2` Ensure, then merge/append the ensured row onto page 1 — rejected because it breaks `page_size` and the row reappears on a later page when its uuid is past the token (duplicate).
- `R-3` `ORDER BY system_managed DESC, watchlist_id` with a compound opaque token (guarantees Signals on page 1) — rejected because the spec's Out of Scope excludes a pagination-order change and it alters every caller's token format; recorded as the road not taken (it would also remove the UI's 51st-list loss without UI code).
- `R-4` A new "ensure-only / existence-check" store method before listing — rejected because it changes the store interface and both implementations and adds a round trip plus a write attempt in the common case; D-1+D-2 is the better default and R-4 stays the remedy if write load on this read ever shows.
- `R-5` Bundle the `ListByUser` `next_page_token` fix into this feature — rejected by the operator (D-6): split to a separate defect/session, keeping this diff to the ensure and avoiding a silent analysis-universe change under a watchlist-row feature.
- `R-6` `CountByUser … AND NOT system_managed` to keep the manual cap at 50 — rejected by the operator (D-7): accept 49 manual; the one-line change would let a user at 50 manual + Signals hold 51 lists and one would fall off the UI's unpaginated page of 50, and the UI is out of scope.

## Open Risks

- [ ] **Token defect landing order (O-9, O-12).** Until `ListByUser`'s token is fixed, the system list creates a new page boundary: an analysis owner at exactly 100 manual lists drops one list's bindings from the live-loop universe each cycle, and an agent 1-list user with `list_watchlists limit 1` loses a row in a small-page traversal; Signals itself can be the dropped look-ahead row on page 2. Removed by the D-10/D-11 landing gate — to be addressed at **step 4**.
- [ ] **The critical-path fix session is idle.** Observed 2026-11-16: the `ListWatchlists` token-fix session sits at `/sdd-triage`'s feature-number gate waiting on the operator; no fix slug exists yet. If it stays stuck, 351 is code-complete but unmergeable. A waiver would need a `REOPEN D-10(a)` (P-2, declined at approval) naming `@AC-2 @FR-2 @feature-180` and agent `@AC-1 @feature-148` — to be addressed at **step 4**.
- [ ] **Cap is effectively 49 manual lists (D-7/R-6).** A legacy user already at 50 manual lists gets 51 rows on first list (the ensure bypasses the cap); the UI's `pageSize: 50` (`useWatchlists.ts:33`) then hides one — to be addressed only if the operator revisits R-6.
- [ ] **UI behavior changes without code (operator-accepted).** `/insights/watchlists` auto-selects Signals for a user with no other list (`page.tsx:41-55`); the "No watchlists yet" empty state becomes unreachable (`page.tsx:136`); the screener "Add top N" picker lists Signals and can write MANUAL entries into the system list (`screener/page.tsx:545,168-171`; the prune touches only `source = 2`, `signal_expiry_backfill.go:84,95,110,119`).
- [ ] **"Read-only" wording.** `list_watchlists` text is updated (FR-7); `list_opportunities` can indirectly trigger the ensure through analysis's stale-read recompute (`servicer.py:4713-4714,4933-4961,6008`) and its "read-only" wording is left unchanged because in this repo "read-only" already means no admin scope / no domain-object mutation (the tool already writes `analysis.opportunities`, `servicer.py:4923-4929`; `mcp-tools.md:484,1055,1144`). `get_watchlist` stays truly read-only.
- [ ] **Users never reached by any caller keep no Signals list** until their first touch (never opens the three UI pages, never calls `list_watchlists`/`list_opportunities`, no live strategy or opportunity rows). Operator option, not a design change: a zero-code interim remedy exists on Homelab staging — `ingest_signal(direction="watchlist")` at low conviction then remove the symbol (the emptied list stays), or `EnsureSignalWatchlist` over mTLS; side effects: a stored signal row and an alert if conviction ≥ `agent.signal.alert_threshold` (0.6).
- [ ] **Deployment reachability.** Homelab staging deploys from `main-dev` only when `vars.HOMELAB_STAGING_ENABLED == 'true'` (`.github/workflows/deploy-dev.yml:6,42,57`); the variable's value is not in the repo. If unset, the fix reaches Homelab only through a manual `homelab-images.yml` dispatch.
- [ ] **Write-on-read operational notes.** (a) The read path can now wait behind a lock that blocks writes but not reads (e.g. a non-`CONCURRENTLY` index build on `portfolio.watchlists` while old instances serve; analysis drains set no gRPC deadline, `live_loop.py:603-610`, `servicer.py:6008-6015`; the pool is 2 connections, `pool.go:15`) — **a future `portfolio.watchlists` index migration must use `CREATE INDEX CONCURRENTLY`**. (b) A read-only/degraded DB makes every first-page call for a user without Signals log one WARN (SQLSTATE 25006, no lock wait); users with Signals on page 1 never reach the ensure. (c) Without a counter the write load of the recurring small-page path is invisible apart from `rpc.server.duration` — R-4 is the remedy if it ever shows.
- [ ] **Non-UUID owners.** The ensure targets whatever owner id analysis holds; `watchlists.user_id` is `TEXT NOT NULL` with no FK (`migrations/007_watchlists.up.sql:8`), so a legacy-username owner gets an orphan empty list that cannot surface to a real user and adds no symbols (fails.md census rule).
- [ ] **Rollback is harmless:** created empty system lists persist, stay visible and undeletable, count toward the cap, and are reused by a later `EnsureSignalWatchlist`; no down migration exists or is needed.
- [ ] **Corrections of record:** the earlier note that `max_per_user` "can be set per user" is wrong on this read path (`wlCfg.GetInt` has no user dimension, `portfolio_service.go:2134-2136`, `internal/config/watchcore.go:352-373,393-403`); the middleware cite is `internal/middleware/propagation.go:27-33`; analysis loops drain owners one at a time but the `ListOpportunities` stale-read kick runs one task per distinct user concurrently (no herd — different users never contend on `watchlists_user_system_uidx`).
- [ ] **Twin defects filed, not fixed here:** `ListByUser` and `ListPositions` token skips (`docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`, `…-listpositions-page-token-skips-boundary-row-defect.md`); the agent docstring "Pagination is stable across pages" (`tools.py:2155`) stays inaccurate until the `ListByUser` fix lands.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every symbol and path above comes from discovery digests or code reads in this session; unfound items stayed in recon's `## Not found`.
- `C-03` — honored by: no new outbound call; the ensure uses the same `userID` as `ListByUser` (`requireUserID`); callers already forward the user's own `x-user-id`.
- `C-08` / `P-06` — honored by: step 1 pairs the service change with its unit tests (red-before-green for AC-1, 2, 4, 6, 7; recorded mutation-red for the characterization tests AC-3, 5, 8).
- `C-10(c)` — honored by: the ensured row is `system_managed = true`, so the `FAILED_PRECONDITION` delete guard (`portfolio_service.go:2421-2423`) and AC-6 protect it.
- `C-11` — honored by: `/sdd-story` → full-mode `/sdd-design` (4 rounds, operator gates recorded) before any implementation.
- `C-13` — honored by: test data stays inline per C-13 (one consumer each); no fixture home created.
- `C-14` — honored by: Agent (text) and UI (accepted, no code change) named in the product spec; analysis callers listed; the operator's no-UI-change decision is recorded in `context.md`.
- `C-15` / `C-16` — honored by: AC-1..AC-10 trace to unit/dbtest/doc checks (D-9); scenarios are promoted into the per-service suites at integration (step 5); existing rules classified below, no CHANGE.
- `C-18` — honored by: the least mechanism that keeps the hot paths cheap (reuse `EnsureSystemManaged`, no new store method, no counter, no ledger event); the helper extraction keeps `ListWatchlists` thin; trade-offs recorded in the register.
- `P-01`..`P-05` — honored by: single-orchestrator writes, mediated proposer/adversary exchanges, no silent deviation (spec amendments for FR-8/AC-7/AC-10 recorded), operator gates and `context.md` checkpoints at every round.
- `F-01` — honored by: no migration. `F-02`/`F-03` — honored by: all changes via the ccr branch / PR. `F-06` — honored by: no new pool or connection (one pooled pgx call at a time, pool max unchanged). `F-07` — honored by: no config value added or hardcoded (`"Signals"` is the existing constant). `F-11` — honored by: no Floor breach was flagged in any round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-6 @FR-2 @FR-7 @feature-127` "EnsureSignalWatchlist is idempotent and coexists with a same-named manual list" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — not regressed by: the ensure reuses `EnsureSystemManaged` (flag-based, race-safe index).
- PRESERVE `@AC-1 @AC-2 @AC-3 @AC-7 @feature-127` (`docs/sdd/business-rules/platform.feature`) — not regressed by: the ensure creates an empty system-managed list only; the delete guard applies.
- PRESERVE `@AC-6 @FR-3 @feature-148`, `@AC-4 @FR-3 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) and `@AC-4 @FR-3 @feature-127` (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`) — not regressed by: delete stays `FAILED_PRECONDITION`; create semantics unchanged; fail-open precedent followed.
- EXTEND `@AC-1 @FR-1 @FR-5 @feature-148` "list_watchlists returns only the caller's own lists, paginated" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — new case added: a user with no Signals list gets one on first-page calls; RPC args, response shape and caller-only scope unchanged; promoted at integration with a signed note and wording that does not say a `limit 1` caller "sees" Signals.
- PRESERVE-by-intent `@AC-2 @FR-2 @FR-4 @feature-178` (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`) — not regressed by: the page's bindings still load in one query; the ensure path adds a bounded O(1) set of statements (`INSERT`/`SELECT`/`GetByID`→`listBindings`) at most once per call and in practice once per user, never per list.
- PRESERVE `@AC-2 @FR-2 @feature-167` (portfolio) and `@AC-6 @FR-5 @feature-167` (ui) — not regressed by: `system_managed` is never modified; the UI adds no refetch/invalidation.
- PRESERVE `@AC-8 @FR-10 @feature-127` (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — not regressed by: an empty system list renders no provenance badges.
- PRESERVE `@AC-18 @AC-4 @AC-5 @feature-281` (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`) — not regressed by: an empty list has no expiry rows and the prune never deletes it.
- PRESERVE `@AC-2 @FR-2 @feature-180` (analysis `watchlist-readiness-precompute.feature`), `@AC-6 @FR-4 @feature-191` (`opportunities-latency-fix.feature`), `@AC-1 @AC-3 @feature-154` (`fundsignal-watchlist-universe.feature`) — not regressed by: an empty list adds no symbols or bindings; the drain-at-100-lists exposure is removed by the D-10/D-11 landing gate, not by code.
- No CHANGE. Unguarded today (new scenarios in this feature's `acceptance.feature`): the per-user cap interaction (AC-10) and the one-system-list-per-user creation on a small `page_size` (AC-7).
