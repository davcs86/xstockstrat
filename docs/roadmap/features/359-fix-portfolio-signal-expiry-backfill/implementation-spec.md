# Implementation Spec: fix-portfolio-signal-expiry-backfill

**Status**: `pending`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/359-fix-portfolio-signal-expiry-backfill/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-portfolio-signal-expiry-backfill`
**Tree**: `feature/fix-portfolio-signal-expiry-backfill@7418bc8b` (6 commits behind `origin/main-dev@9a685196`, with no diff under `services/xstockstrat-portfolio`, `docs/runbooks` or `.github`). Every `path:line` below was re-grepped at this tree.

---

## Execution Summary

This spec follows design.md's Chosen Approach exactly. The work is in two red→green cycles, then docs.

1. **Lock fix (Steps 1–2).** Step 1 wraps each APPLY candidate in one short READ COMMITTED transaction through the single-caller helper `applyBackfillRow`. The transaction locks the parent `portfolio.watchlists` row first, then runs the unchanged seed or mark INSERT (D-1, D-2, D-3, D-7). Step 2 adds the two deterministic forced-interleave dbtests, which use strict equality (D-8, D-9). /sdd-execute writes Step 2's tests first and captures RED on the current tree, then applies Step 1 and captures GREEN.
2. **FR-3 mark grace (Steps 3–4, one atomic unit).** Step 3 changes `backfillMarkSQL` to write `now() + backfillMarkGrace`, where the constant is `interval '72 hours'` (D-11, D-12). This breaks the current next-tick removal assertion in `TestBackfill_StrictUntrackedRemoval`, so Step 4 rewrites that test's tail and the two steps land as one commit (D-13).
3. **Docs (Steps 5–7).** Step 5 updates the runbook and its index row. Step 6 makes the durable acceptance CHANGE (281 @AC-16) and the @AC-17 retitle in one `@feature-359` commit. Step 7 adds the lock-order invariant and grace note next to PORTFOLIO-18, plus the portfolio CLAUDE.md bullet (D-10, D-14).

Nothing changes in proto, migrations (portfolio or config), config keys, env vars, ports or services.

**Consumer surface (C-14):** the product spec marks this as `None — internal/platform-only`. That is a decision, not an omission. No UI segment or Agent tool step is required. The only operator-visible surface is the `backfill-signal-expiry` CLI and its runbook (Step 5).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` (mark + concurrent signal: absent or tracked by the live signal; no prune now or after 3 days) | Step 2 (`TestBackfill_MarkIngestInterleavingRescued`) |
| `@AC-2` (seed + concurrent signal: tracked by the new signal, never by the owner's expired one) | Step 2 (`TestBackfill_SeedIngestInterleavingRescued`) |
| `@AC-3` (untracked mark gets a 3-day grace before pruning) | Step 4 (rewritten `TestBackfill_StrictUntrackedRemoval`, tagged AC-16+AC-3) |

### Must-not-weaken guards (C-08; design O-11, D-6)

These tests may **not** be edited, skipped, loosened or deleted by any step. If one fails at execute, it escalates to the debate register. It is never relaxed in place.

- `TestBackfill_IngestRaceNeverLeavesEntryRemovable` (`signal_expiry_backfill_dbtest_test.go:443`): stays byte-identical (operator decision 2026-11-17).
- `TestBackfill_MarkIngestInterleavingRescued` and `TestBackfill_SeedIngestInterleavingRescued` (added in Step 2): the same status as `:443`. After FR-3, `:443` can no longer see a lock-fix regression, because a mark that lost the race is now `now()+72h` rather than due. These two strict-equality tests are the only guard on @AC-1/@AC-2.
- `TestBackfill_IngestInterleavingSkipsChanged` (`:349`) and `TestBackfill_MarkedEntryRescued` (`:252-295`, 281 @AC-17): must still pass, with no edits.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (C-08). Step 2 only references symbols that already exist (`backfillReport` `:63`, `backfillApply` `:83`, `seedWatchSignal` `:24`, `cleanupIngest` `:40`, `testPool` `dbtest_helpers_test.go:22`, `NewWatchlistRepo`, `mustPrune`, `assertSource`, `expiryRow`, `dbNow`, `provenanceIntent`, `addBinding`). So its RED is a behavior failure, not a compile failure, and Steps 1 and 2 need no `**Lands with**`. Each passes its own Verification on a tree holding only the earlier steps. Step 1 alone keeps every existing test green.
- Steps 3+4 land together. Step 3 changes the mark's `valid_until` from `now()` to `now() + interval '72 hours'`, and the current tail of `TestBackfill_StrictUntrackedRemoval` (`signal_expiry_backfill_dbtest_test.go:243-249`) asserts that the mark is pruned on the next tick. Step 3 therefore cannot pass its own dbtest Verification without Step 4's rewrite (step-constraints §C: the step cannot pass its own Verification without the other member). Both steps are on one consumer surface (backend), they are adjacent, and the unit size is 2.
- Step 3 requires Step 1. The grace must ship on top of the lock fix: after FR-3, `:443` is blind to the race, so the Step 2 guards must already be in the tree.
- Step 5 requires Step 3. The runbook describes the per-row locked transaction (Step 1) and the 72h grace (Step 3).
- Step 6 requires Step 4. The durable @AC-16 CHANGE must match the asserted behavior. The @AC-16 CHANGE and the @AC-17 retitle are one commit (D-14).
- Step 7 requires Steps 1 and 3. It documents the invariant those steps create.
- Merge order: no row is needed. Recon found that feature 354 overlaps only `watchlist_repo.go:107-141` and `dbtest_helpers_test.go`. This spec edits neither file, and 354 is already merged to `main-dev` (#1566).
- Execute order (TDD): Step 1 is numbered first, but /sdd-execute writes Step 2's tests first and captures RED on the pre-Step-1 tree. It then applies Step 1 and captures GREEN. Running Step 1 first loses the real RED.
- Textual overlap with `352-delisted-symbol-handling` (`implementation-ready` on `origin/main-dev`; impl-spec review 2026-11-17, WARN only). 352 also edits three files this spec touches:
  - the PORTFOLIO-18 row of `services/xstockstrat-portfolio/docs/context-constitution.md` (Step 7 here);
  - `services/xstockstrat-portfolio/CLAUDE.md`, on lines other than `:98`;
  - the `docs/runbooks/CLAUDE.md` index table, where 352 inserts a new row and Step 5 here edits the backfill row.

  Whichever feature lands second rebases these doc edits. No merge-order row is required.

---

### Step 1 — service: serialize each APPLY row on the parent watchlist row lock

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go` — modify

**Reviewers**: xstockstrat-portfolio service owner — concurrent write safety

**Codebase Evidence**:
- APPLY loop: `signal_expiry_backfill.go:157-183`. Line `:167` is `tag, err := pool.Exec(ctx, stmt, c.watchlistID, c.symbol)`. The ABORTED path is `:168-172`. The outcome switch is `:173-181`, with `tag.RowsAffected() == 0` mapped to `"changed since REPORT"` at `:174-176`.
- Statements: `backfillSeedSQL` `:101-112`, `backfillMarkSQL` `:114-121`. Both use INSERT … SELECT … `NOT EXISTS` … `ON CONFLICT DO NOTHING`. Neither locks `portfolio.watchlists` (the join at `:104`/`:118` is a plain read).
- Comments to correct: `:99-100` ("The APPLY statements recompute the class from ingest at statement time; zero rows inserted means / the binding left the class REPORT named (or gained an expiry row) and is counted as changed.") and `:123-124` ("APPLY inserts one / autocommit row at a time").
- Package transaction idiom: `readBackfillState` `:203` `pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})`, then `:207` `defer func() { _ = tx.Rollback(ctx) }()`. The same idiom is at `signal_expiry_repo.go:62-66` and `watchlist_repo.go:301-305`.
- Lock form: `signal_expiry_repo.go:70` `SELECT user_id FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE SKIP LOCKED`. APPLY reuses it **without** `SKIP LOCKED`, because it must wait.
- Serialization contract: `watchlist_repo.go:545-546` (`applyExpiryIntentTx`: the caller holds the parent row lock). `AddSymbols` `:300-320` takes it first through `touchWatchlistTx` `:502-505` (`UPDATE portfolio.watchlists SET updated_at = now() WHERE watchlist_id = $1 RETURNING updated_at`).
- `pgconn` import precedent: `internal/repository/portfolio_repo.go:13` `"github.com/jackc/pgx/v5/pgconn"`. `pgx/v5 v5.9.2` (`go.mod:8`). `pgx.ReadCommitted` is a pgx v5 `TxIsoLevel` constant. It was not grepped (no module cache in this sandbox), so the compile in Verification confirms it.
- Callers of the changed loop: `RunBackfill` is called only by `cmd/server/backfill.go` and `signal_expiry_backfill_dbtest_test.go` (grep `RunBackfill\|backfillApply\|mustApply` across the service). Its signature does not change, so there are no call-site edits.
- Pooling: the CLI requires the pooled `:25061` URL (`cmd/server/backfill.go:31`). A short explicit transaction is compatible with transaction pooling (recon.md:114).

**TDD**: `red-green required`. The RED/GREEN pair is Step 2. Write Step 2's tests first, capture RED on this tree, then apply this step.

**Covers**: —

**Instructions**:
1. Add `"github.com/jackc/pgx/v5/pgconn"` to the import block (`:3-13`).
2. Next to `backfillMarkSQL` (after `:121`), add `const backfillLockSQL = `SELECT 1 FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE``. Use a separate statement with no `SKIP LOCKED` (D-2). Do **not** use the CTE form (R-1) or a `touchWatchlistTx`-style UPDATE (R-4).
3. Add the single-caller helper `func applyBackfillRow(ctx context.Context, pool *pgxpool.Pool, stmt, watchlistID, symbol string) (pgconn.CommandTag, error)` (D-7):
   - `tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})`. On error, return `pgconn.CommandTag{}, err`.
   - `defer func() { _ = tx.Rollback(ctx) }()`
   - `tx.Exec(ctx, backfillLockSQL, watchlistID)`. On error, return it.
   - `tag, err := tx.Exec(ctx, stmt, watchlistID, symbol)`. On error, return it.
   - `tx.Commit(ctx)`. On error, return `pgconn.CommandTag{}, err`. Otherwise return `tag, nil`.

   Do not add a `lock_timeout` (R-6, YAGNI), a retry, a new outcome or a counter.
4. Replace only `:167` with `tag, err := applyBackfillRow(ctx, pool, stmt, c.watchlistID, c.symbol)`. Lines `:168-183` stay byte-identical (D-3). Begin, lock, insert and commit errors all take the existing ABORTED path, and 0 rows (including a deleted watchlist) stays "changed since REPORT".
5. Comments, 2-line cap (D-10):
   - Replace `:99-100` with one merged 2-line comment. It keeps the zero-rows rule and states the new constraint, for example: `// APPLY runs each statement after locking the parent watchlist row, so its class is recomputed after any` / `// concurrent add commits; zero rows inserted means the binding left REPORT's class and is counted as changed.`
   - At `:123-124`, change "APPLY inserts one autocommit row at a time" to "APPLY writes one short locked tx per row". Keep the rest of the sentence.
6. Do **not** touch `backfillSeedSQL`, `backfillMarkSQL` (that is Step 3), `watchlist_repo.go`, or any test file.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go build ./... && GOWORK=off go vet -tags dbtest ./internal/repository/...
GOWORK=off golangci-lint run --modules-download-mode=mod
# existing backfill + add-path + prune dbtests stay green (needs the migrated test DB, as in CI job portfolio-db-test):
PORTFOLIO_DB_TEST_URL=<migrated test DB URL> GOWORK=off go test -tags dbtest -race -count=1 -run 'TestBackfill_|TestAddPath_|TestPrune_' ./internal/repository/...
grep -n 'pool.Exec(ctx, stmt' internal/repository/signal_expiry_backfill.go   # expect no match
grep -n 'FOR NO KEY UPDATE' internal/repository/signal_expiry_backfill.go       # expect backfillLockSQL only
```
All of the above must pass. `:443` and `:349` must stay green. If `:443` reports 55P03 under `-race`, that is the accepted 500ms lock_timeout residual: investigate the runner and never edit the test (design Open Risk).

---

### Step 2 — test: deterministic forced-interleave tests for the mark and seed race (@AC-1, @AC-2)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go` — modify (append the helper and two tests after `TestBackfill_IngestInterleavingSkipsChanged`, which ends before `:441`; do not touch `:443-503`)

**Reviewers**: xstockstrat-portfolio service owner — concurrent write safety

**Codebase Evidence**:
- Technique precedent: `TestBackfill_IngestInterleavingSkipsChanged` `:349-439`.
  - `applyPool` with no lock_timeout: `:351-356` `pgxpool.New(context.Background(), os.Getenv("PORTFOLIO_DB_TEST_URL"))` + `t.Cleanup(applyPool.Close)`.
  - Side tx holding an uncommitted expiry row: `:365-386`.
  - APPLY in a goroutine: `:390-395`.
  - `pg_stat_activity` poll: `:397-418` (`wait_event_type = 'Lock' AND query LIKE '%INSERT INTO portfolio.watchlist_signal_expiry%' AND pid <> pg_backend_pid()`, 10s deadline, 20ms sleep).
- Pools: `testPool(t, opts ...func(*pgxpool.Config))` `dbtest_helpers_test.go:22`. The default `lock_timeout` is `500ms` (`:35`). The override precedent is `watchlist_ensure_dbtest_test.go:20` `testPool(t, func(c *pgxpool.Config) { c.ConnConfig.RuntimeParams["lock_timeout"] = "5s" })`.
- Helpers: `seedWatchSignal` `:24` (offset relative to DB `now()`, calls `cleanupIngest`), `cleanupIngest` `:40`, `offset` `:49`, `backfillReport` `:63` (returns `backfillTotals`), `backfillApply` `:83`, `seedWatchlist` `dbtest_helpers_test.go:75`, `seedBinding` `:93`, `expiryRow` `:139`, `dbNow` `signal_expiry_prune_dbtest_test.go:37`, `mustPrune` `:47`, `pgCode` `:66`, `addBinding` `watchlist_signal_expiry_add_dbtest_test.go:21`, `provenanceIntent` `:31`, `assertSource` `:61`, `ptrVal` `:69`.
- Class type: `backfillClass` with `classSeed` / `classUntracked` (`signal_expiry_backfill.go:37-42`). Test and code are in the same `repository` package.
- Gate target: `touchWatchlistTx` SQL starts `UPDATE portfolio.watchlists SET updated_at = now()` (`watchlist_repo.go:505`). `AddSymbols` runs it first (`:307`).
- Rescue contract: `mergeSignalExpirySQL` `watchlist_repo.go:293-296`. When `signal_id IS NULL`, `valid_until := $3` and `signal_id := $4`. Otherwise `GREATEST(valid_until,$3)`, and `signal_id := $4` when `$3 >= valid_until`. Both a mark and an expired seed therefore end at exactly `(sigID, until)` once rescued.
- Live-signal insert shape: `:374-378` (`INSERT INTO ingest.newsletter_signals (user_id, source, symbol, direction, valid_from, valid_until) VALUES ($1, 'mcp_client', 'META', 'watchlist', now(), now() + interval '30 days') RETURNING id, valid_until`).

**Lands with**: — (references only existing symbols; see Step Dependencies)

**TDD**: `red-green required`. **RED** runs on the tree before Step 1: in the forced interleave, `AddSymbols` completes without blocking (branch `"addDone"`), its update-only merge hits 0 rows, and the side-tx rollback then lets the mark (or the expired seed) commit. The strict-equality assertion therefore fails (`signal_id` is NULL, or the old seed id). **GREEN** runs after Step 1: `AddSymbols` blocks on the parent row lock (branch `"blocked"`) and rescues the committed row.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Add the helper `func runForcedInterleave(t *testing.T, class backfillClass, priorSignalAge time.Duration) (sigID int64, until time.Time, branch string)`. This signature is pinned (O-9, C-18). It takes no function-valued parameters, and all assertions except setup/gate `t.Fatalf`s stay in the test bodies. Use the symbol `"META"`. The helper does the following, in order:
   1. `pool := testPool(t)`. `addPool := testPool(t, func(c *pgxpool.Config) { c.ConnConfig.RuntimeParams["lock_timeout"] = "10s" })`. Create `applyPool` exactly as at `:351-356`, with no lock_timeout (D-8, O-1).
   2. `userID := testUserID(t)`, `cleanupIngest(t, pool, userID)`, `wlID := seedWatchlist(t, pool, userID, true)`, `seedBinding(t, pool, wlID, "META", "", int16(srcSignal))`.
   3. If `priorSignalAge > 0`, seed the owner's older, already-expired signal with `seedWatchSignal(t, pool, userID, "META", offset(fmt.Sprintf("-%d seconds", int64(priorSignalAge/time.Second))))`.
   4. `rep, tot := backfillReport(t, pool, "SEED")`. `t.Fatalf` unless `rep.Report` has a line containing `"\t"+wlID+"\tMETA\t"` whose prefix matches `class`: `UNTRACKED` for `classUntracked`, and `SEED` with a trailing `\tY` (seed_expired) for `classSeed`. This realizes the Given "a backfill REPORT that classifies that binding as …".
   5. Open the side tx on `pool`. Insert an uncommitted `portfolio.watchlist_signal_expiry` row for `(wlID, 'META')` with any placeholder values (for example `now() - interval '1 day', NULL`). Use `defer side.Rollback(ctx) //nolint:errcheck`. The row only parks APPLY's `ON CONFLICT` on the primary key.
   6. Start `backfillApply(applyPool, "SEED", tot.untracked, tot.seedExpired)` in a goroutine with a buffered `done` channel, as at `:390-395`.
   7. Poll `pg_stat_activity` exactly as at `:397-418` until APPLY's INSERT is a Lock waiter. Fail if `done` fires first or after 10s. APPLY's statement snapshot now predates the signal.
   8. On `pool`, insert and commit the live signal with the `:374-378` shape (user `userID`, symbol `'META'`) and scan `sigID, until`.
   9. Start `NewWatchlistRepo(addPool).AddSymbols(ctx, wlID, []*portfoliov1.WatchlistBinding{addBinding("META", srcSignal)}, provenanceIntent("META", sigID, until))` in a goroutine with a buffered `addDone` channel carrying the error.
   10. Two-branch gate (D-8), 10s deadline, 20ms poll. `branch = "addDone"` if `addDone` fires first (keep its error). `branch = "blocked"` if `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE portfolio.watchlists SET updated_at%' AND pid <> pg_backend_pid()` is > 0.
   11. `side.Rollback(ctx)`. Wait for APPLY's outcome and `t.Fatalf` on its error, including `pgCode`. Wait for the add error, if not already received, and `t.Fatalf` on it.
   12. Return `sigID, until, branch`.
2. Add `TestBackfill_MarkIngestInterleavingRescued` with the comment `// AC-1: a signal committed while APPLY's mark is in flight leaves the entry tracked by it, never marked.` The test body:
   1. `sigID, until, branch := runForcedInterleave(t, classUntracked, 0)`.
   2. Assert in this order (D-9; R-5 forbids any relaxation):
      1. `rec, ok := expiryRow(...)`, with `ok`, `rec.SignalID != nil && *rec.SignalID == sigID` and `rec.ValidUntil.Equal(until)`. `until` must be after `dbNow`. This is @AC-1's "tracked by the live signal". "Absent" is acceptable per @AC-1, but this interleave always parks a row, so assert the tracked form.
      2. `mustPrune(t, NewWatchlistRepo(pool), wlID)` is empty (prune now).
      3. Age-free 3-day check: assert `until.After(dbNow(t, pool).Add(72*time.Hour))`. The expiry row is the live signal's 30-day `valid_until`, so a tick after 3 days removes nothing (@AC-1's "after 3 days" clause). Never backdate the live signal's row for this.
      4. `assertSource(t, pool, wlID, "META", srcSignal)`.
      5. Last, `branch == "blocked"`.
3. Add `TestBackfill_SeedIngestInterleavingRescued` with the comment `// AC-2: a signal committed while APPLY seeds from the owner's expired signal leaves the entry tracked by the new one.` It calls `runForcedInterleave(t, classSeed, 48*time.Hour)` and makes the same ordered assertions as the AC-1 test, minus the 3-day clause, which is not in @AC-2. The equality check also rules out the owner's older signal id (the seed id differs from `sigID`).
4. C-13 verdict: the `'META'` literal and the signal-insert SQL stay inline. They are single-file test literals, and the existing `:374-378` copy is in the same file. Do not create a new fixture home, and do not edit `dbtest_helpers_test.go` (feature 354 overlap).
5. Do **not** edit `:443-503` (byte-identical, D-6), `:349-439`, or `:252-295`.

**Verification**:
```bash
cd services/xstockstrat-portfolio
# RED (tree before Step 1) then GREEN (after Step 1):
PORTFOLIO_DB_TEST_URL=<migrated test DB URL> GOWORK=off go test -tags dbtest -race -count=1 -run 'TestBackfill_(Mark|Seed)IngestInterleavingRescued' ./internal/repository/...
# full backfill/add/prune suite incl. the frozen :443 and :349 guards:
PORTFOLIO_DB_TEST_URL=<migrated test DB URL> GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/...
# coverage gate (C-08) + lint:
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
GOWORK=off golangci-lint run --modules-download-mode=mod
git diff origin/feature/fix-portfolio-signal-expiry-backfill -- internal/repository/signal_expiry_backfill_dbtest_test.go | grep -c '^[-+].*IngestRaceNeverLeavesEntryRemovable'   # expect 0
```
New logic is in an excluded package (`repository/`), so no coverage threshold applies to it. The total must stay ≥ 40%, and the dbtest integration run is the behavioral verification. Prove both branches at execute (design Open Risk): RED shows `branch="addDone"` and the equality failure, and GREEN shows `branch="blocked"`. Prove also that the speculative-insert wait appears as `wait_event_type='Lock'` and that `insertBindingsTx` does not wait on the existing binding. Any divergence escalates to the register and is never relaxed in place.

---

### Step 3 — service: FR-3 72h grace on backfill untracked marks

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go` — modify

**Reviewers**: xstockstrat-portfolio service owner — concurrent write safety

**Codebase Evidence**:
- `backfillMarkSQL` `:114-121`. The select list at `:116` is `SELECT s.watchlist_id, s.symbol, now(), NULL`.
- Concatenation precedent: `ownWatchlistSignals` (`:61`) is concatenated into SQL at `:107`, `:111` and `:120` (`… FROM ` + ownWatchlistSignals + ` …`).
- `backfillSeedSQL` `:101-112` must stay byte-identical, because seeds keep the owner's `valid_until` (FR-3).
- No config client in the CLI: `cmd/server/backfill.go:20-61` builds only a `pgxpool` from `DATABASE_URL` (`:30-36`). The product spec's Fix Scope says "No config key changes". `docs/patterns/config-governance.md:7` scopes the hardcoding ban to env-specific values. D-12 records the F-07 reasoning.
- Prune comparator uses DB `now()` (`signal_expiry_repo.go:38`, `:151`), so a mark is due only once `now() >= valid_until`.
- Existing assertion this breaks: `TestBackfill_StrictUntrackedRemoval` `signal_expiry_backfill_dbtest_test.go:243-249` (`assertPruned(t, mustPrune(t, repo, wlID), …)` immediately after APPLY). It is rewritten in Step 4.
- Other tests that mark and then prune still hold under the grace:
  - `TestBackfill_MarkedEntryRescued` `:252-295`: its merge overwrites a NULL-signal row's `valid_until` with `$3` (`watchlist_repo.go:294`), so the "past renewal" case is still due.
  - `TestBackfill_Idempotent` `:320-344` reads `marked.ValidUntil` back.
  - The `:349` and `:443` tests assert only "never due while live".

**Lands with**: `Step 4`

**TDD**: `red-green required`. RED/GREEN is Step 4's rewritten test.

**Covers**: —

**Instructions**:
1. Above `backfillMarkSQL`, add `const backfillMarkGrace = `interval '72 hours'``. Use a ≤2-line constraint comment, for example `// Operator-fixed (feature 359, same in every environment, not a config key): a mark is due 72h after` / `// its APPLY tx, so a live signal added in that window rescues it. Seeds keep the owner's valid_until.` Use `'72 hours'`, not `'3 days'` (DST) and not a `$3` bind parameter (R-8).
2. Change `:116` to `SELECT s.watchlist_id, s.symbol, now() + ` + backfillMarkGrace + `, NULL`. `now()` is the start of the per-row transaction from Step 1, so the grace is anchored to that row's APPLY write.
3. Do not touch `backfillSeedSQL`, `watchlist_repo.go`, or any config or migration file. There is no `SetConfig` bound and no seed migration (R-7).

**Verification**: Run as one unit with Step 4. Use Step 4's Verification plus:
```bash
cd services/xstockstrat-portfolio
grep -n "backfillMarkGrace" internal/repository/signal_expiry_backfill.go   # const + one use in backfillMarkSQL
grep -rn "backfill_mark_grace\|mark_grace" ../xstockstrat-config/migrations internal/config 2>/dev/null   # expect no match (no config key)
```

---

### Step 4 — test: rewrite the StrictUntrackedRemoval tail for the 3-day grace (@AC-3; CHANGE of 281 @AC-16)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go` — modify (`:216-250` only)

**Reviewers**: xstockstrat-portfolio service owner — concurrent write safety

**Codebase Evidence**:
- `TestBackfill_StrictUntrackedRemoval` is at `:217-250`, with the comment `:216` `// AC-16: no own rows ⇒ marked (even with a live legacy row); the next tick removes it with nil SignalID.`
  - `:218-236` holds the setup, REPORT and refusal half (kept).
  - `:238-249` holds the APPLY and next-tick removal tail (rewritten).
- Helpers: `dbNow` `signal_expiry_prune_dbtest_test.go:37`, `dueRow` `:96` (fails if there is no row), `mustPrune` `:47`, `assertPruned` `:74` (compares `UserID, WatchlistID, Symbol, StrategyID, SignalID, ValidUntil`), `assertBindingGone` `:89`, `assertSource` `watchlist_signal_expiry_add_dbtest_test.go:61`. `PrunedEntry` is at `signal_expiry_repo.go:14-18`.
- Event kind: `SignalID == nil` routes to `portfolio.watchlist.signal_entry_removed_untracked` (`internal/service/signal_prune.go:59-70`), and the payload is guarded by `TestSignalPrune_UntrackedEventPayload` (`internal/service/signal_prune_test.go:102`). So `SignalID nil` in `assertPruned` proves @AC-3's event kind.
- Tautology trap avoided (`docs/roadmap/ledger/fails.md` 2026-08-26 ui-auth-improvements): the bound is checked against the value the DB wrote, with a literal `72*time.Hour`. It is not constant-versus-constant.

**Lands with**: `Step 3`

**TDD**: `red-green required`. RED is on the tree after Steps 1–2 and before Step 3: `rec.ValidUntil ≈ now()` fails the `[t0+72h, t1+72h]` bound, and the immediate prune removes PLTR. GREEN is after Step 3.

**Covers**: `AC-3`

**Instructions**:
1. Change the comment at `:216` to `// AC-16+AC-3: no own rows ⇒ marked with a 72h grace (even with a live legacy row); pruned only after it.` (one line).
2. Keep `:217-236` byte-identical.
3. Replace `:238-249` with the following (D-13):
   1. `t0 := dbNow(t, pool)`, then the existing `backfillApply(pool, legacy, tot.untracked, tot.seedExpired)` with its `err`/`Marked` check, then `t1 := dbNow(t, pool)`.
   2. `rec := dueRow(t, pool, wlID, "PLTR")`. Assert `rec.SignalID == nil`, `!rec.ValidUntil.Before(t0.Add(72*time.Hour))` and `!rec.ValidUntil.After(t1.Add(72*time.Hour))`.
   3. `if got := mustPrune(t, repo, wlID); len(got) != 0 { t.Fatalf(...) }` and `assertSource(t, pool, wlID, "PLTR", srcSignal)`. This is "a prune tick run within those 3 days removes nothing".
   4. Backdate past the boundary: `pool.QueryRow(ctx, `UPDATE portfolio.watchlist_signal_expiry SET valid_until = valid_until - interval '72 hours' - interval '1 millisecond' WHERE watchlist_id = $1 AND symbol = 'PLTR' RETURNING valid_until`, wlID).Scan(&aged)`. The DB `now()` is the only clock seam, and D-6 forbids a production clock hook. Do not add a pre-boundary aging step (R-9).
   5. `assertPruned(t, mustPrune(t, repo, wlID), PrunedEntry{UserID: userID, WatchlistID: wlID, Symbol: "PLTR", StrategyID: "strat-3", ValidUntil: aged})`, with `SignalID` nil, then `assertBindingGone(t, pool, wlID, "PLTR")`.
4. Add `"context"` usage only if it is not already imported. It is imported at `:6`.
5. Do not edit any other test.

**Verification** (unit 3+4):
```bash
cd services/xstockstrat-portfolio
PORTFOLIO_DB_TEST_URL=<migrated test DB URL> GOWORK=off go test -tags dbtest -race -count=1 -run 'TestBackfill_StrictUntrackedRemoval' ./internal/repository/...   # RED before Step 3, GREEN after
PORTFOLIO_DB_TEST_URL=<migrated test DB URL> GOWORK=off go test -tags dbtest -race -count=1 ./internal/repository/...   # whole dbtest suite incl. :443, :349, :252-295 and the Step 2 guards
GOWORK=off go test ./internal/service/... -run TestSignalPrune_UntrackedEventPayload -count=1
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in an excluded package (`repository/`), so no coverage threshold applies to it. The total must stay ≥ 40%, and the dbtest run is the behavioral verification. C-13: the `"PLTR"`/`"strat-3"` literals are pre-existing single-test inline values, with no second consumer.

---

### Step 5 — docs: backfill runbook and runbooks index for the locked per-row tx and the 3-day mark grace

**Status**: `done`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/signal-watchlist-expiry-backfill.md` — modify
- `docs/runbooks/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `signal-watchlist-expiry-backfill.md`:
  - `:27` UNTRACKED row: "a mark: `valid_until = now()`, `signal_id NULL` | **Pruned on the next tick**".
  - `:66-67`: "REPORT is one read-only transaction and APPLY is one autocommit statement per row".
  - `:122-123` (§6): "`seed_expired = Y` … APPLY seeds it and the next tick removes the entry". This stays true for seeds.
  - §7 `:150-155`: "APPLY then writes one autocommit `INSERT … ON CONFLICT DO NOTHING` per row … **recomputes the class from ingest at statement time** …".
  - §8 heading `:160` "No grace period — the clock starts at APPLY" and `:162-164`.
  - §9 `:177-179` "Act **within one interval of APPLY**".
  - §11 `:223` "watch the next tick's events".
- `docs/runbooks/CLAUDE.md:14`: the backfill row ends "…no grace period, emergency stop within one prune interval)".

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (D-10, D-14; operator decision 2026-11-17 sanctions the §8 change):
1. `:27`: the UNTRACKED row's "APPLY writes" becomes "a mark: `valid_until = now() + 72 hours`, `signal_id NULL`", and its Effect becomes "**Pruned on the first tick after APPLY + 72h**, unless a live signal added in that window rescues it".
2. `:66-67`: change "APPLY is one autocommit statement per row" to "APPLY is one short transaction per row (it locks the watchlist row, then inserts)".
3. §7 (`:150-155`): APPLY writes one short transaction per row. It locks the parent watchlist row (`FOR NO KEY UPDATE`), then runs `INSERT … ON CONFLICT DO NOTHING`, so the class is recomputed after any concurrent signal add commits. Add the sentence: "A row printed as `changed since REPORT` stays untracked until REPORT and APPLY are re-run." Add the R-6 operator note: "APPLY sets no lock timeout; a row waits behind an in-flight signal add for that watchlist, and an APPLY wedged on one can be interrupted and re-run (idempotent)."
4. §8: retitle to "3-day grace for marks; none for seed_expired — the clock starts at APPLY". `seed_expired` seeds are still due on the next tick. Marks are due 72 hours after their APPLY row, and a live agent watchlist signal added within that window rescues the mark (the add-path merge). Keep the event bullets and the "pasted REPORT is authoritative" text.
5. §9: "Act within one interval of APPLY for `seed_expired` removals, and within 72 hours of APPLY for marks." The SQL is unchanged.
6. §11 item 1: "watch the next tick's events for `seed_expired` removals, and the ticks after APPLY + 72h for mark removals".
7. `docs/runbooks/CLAUDE.md:14`: replace "no grace period, emergency stop within one prune interval" with "3-day grace for untracked marks; seed_expired removed next tick, emergency stop within one prune interval for seeds and 72h for marks".
8. Use no bash beyond what is already there. macOS rules are unaffected.

**Verification**:
```bash
grep -n "no grace\|No grace\|autocommit" docs/runbooks/signal-watchlist-expiry-backfill.md docs/runbooks/CLAUDE.md   # expect no match
grep -n "72 hours\|72h\|3-day" docs/runbooks/signal-watchlist-expiry-backfill.md docs/runbooks/CLAUDE.md          # expect §1, §8, §9, §11 + index row
grep -n "changed since REPORT\` stays untracked" docs/runbooks/signal-watchlist-expiry-backfill.md                # expect one match
```

---

### Step 6 — docs: durable acceptance — CHANGE 281 @AC-16, retitle @AC-17 (@feature-359)

**Status**: `pending`
**Service**: `xstockstrat-portfolio` (durable business-rule suite)
**Files**:
- `services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- @AC-16 `:127-136`. The tag line is `@AC-16 @FR-7 @feature-281`. Its last When/Then (`:135-136`): "When APPLY runs with --legacy-owner "SEED" --expect-untracked 1 and the next prune tick runs / Then "PLTR" is absent … one signal_entry_removed_untracked event names user-2, "PLTR", "strat-3"".
- @AC-17 `:138-139`: tag `@AC-17 @FR-7 @feature-281`, title "A marked entry is rescued by a live signal before the next tick".
- Multi-feature provenance tag precedent: `acceptance/fix-after-hours-positions-priced.feature:47` `@AC-6 @FR-3 @FR-7 @feature-231 @feature-240`.
- C-16 sign-off: operator decision 2026-11-17 (design-gate steer, FR-3 / @AC-3), recorded in context.md OPERATOR DECISIONS and design.md § Business Rules Touched.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (one commit for both edits; D-14):
1. Change the @AC-16 tag line to `@AC-16 @FR-7 @feature-281 @feature-359`. Keep the title and `:129-134` unchanged. Replace `:135-136` with:
   - `When APPLY runs with --legacy-owner "SEED" --expect-untracked 1`
   - `Then "PLTR" has an expiry record with signal_id NULL and valid_until 3 days after APPLY`
   - `When a prune tick runs within those 3 days`
   - `Then "PLTR" is still on user-2's signal watchlist`
   - `When a prune tick runs after those 3 days`
   - `Then "PLTR" is absent from user-2's signal watchlist and one signal_entry_removed_untracked event names user-2, "PLTR", "strat-3"`
2. Change the @AC-17 tag line to `@AC-17 @FR-7 @feature-281 @feature-359` and its title to "A marked entry is rescued by a live signal before it is pruned". The steps are unchanged (wording only; the guarantee is PRESERVED).
3. Do not touch any other scenario. 359's own @AC-1..3 are promoted at launch by the promoter, not here.

**Verification**:
```bash
grep -n "@feature-359" services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature   # expect the @AC-16 and @AC-17 tag lines
grep -n "next prune tick runs\|before the next tick" services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature   # expect no match
grep -c "Scenario" services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature      # unchanged count vs. origin/main-dev
```

---

### Step 7 — docs: PORTFOLIO-18 lock-order invariant + grace note; portfolio CLAUDE.md Database bullet

**Status**: `pending`
**Service**: `xstockstrat-portfolio` (docs)
**Files**:
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-portfolio/docs/context-constitution.md:30` is the PORTFOLIO-18 row. Its rationale column says "The backfill subcommand only inserts expiry rows; it never deletes bindings". The guard-tests column lists `signal_expiry_prune_dbtest_test.go#TestPrune_ConcurrencyNeverWaits` and `watchlist_signal_expiry_add_dbtest_test.go#TestAddPath_ReplaceAllKeepsExpiry`.
- `services/xstockstrat-portfolio/CLAUDE.md:98` (Database bullet) ends "`signal_id NULL` = a backfill "untracked" mark."
- O-8 (closed round 3): the lock-order invariant is a **mandatory** doc step.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In the PORTFOLIO-18 row (`:30`), append to the invariant cell: "Every `watchlist_signal_expiry` writer takes the parent `watchlists` row lock first, including backfill APPLY (`applyBackfillRow`, one short locked tx per row). A writer that touches expiry rows before the parent lock can deadlock with APPLY or lose the add-path rescue." Append to the rationale cell: "Backfill marks are `signal_id NULL` with a fixed 72h grace (`backfillMarkGrace`, feature 359); the add-path merge rescues them." Append `internal/repository/signal_expiry_backfill.go#applyBackfillRow`, `#backfillMarkGrace` and the guard tests `signal_expiry_backfill_dbtest_test.go#TestBackfill_MarkIngestInterleavingRescued`, `#TestBackfill_SeedIngestInterleavingRescued` to the evidence cell. Do not add a new row; this extends PORTFOLIO-18.
2. `CLAUDE.md:98`: change the end to "`signal_id NULL` = a backfill "untracked" mark, due 72h after APPLY."

**Verification**:
```bash
grep -n "applyBackfillRow\|backfillMarkGrace" services/xstockstrat-portfolio/docs/context-constitution.md   # expect PORTFOLIO-18 row
grep -n "due 72h after APPLY" services/xstockstrat-portfolio/CLAUDE.md                                        # expect one match
grep -c "^| \*\*PORTFOLIO-" services/xstockstrat-portfolio/docs/context-constitution.md                         # unchanged count vs. origin/main-dev
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### DEV-1 — Step 1: dbtest Verification line and local RED/GREEN deferred to CI (2026-11-17)

- **Expected**: Step 1's Verification runs `PORTFOLIO_DB_TEST_URL=<migrated test DB URL> GOWORK=off go test -tags dbtest -race -count=1 -run 'TestBackfill_|TestAddPath_|TestPrune_' ./internal/repository/...`, and the TDD gate captures RED (Step 2's tests on the pre-Step-1 tree), then GREEN, locally.
- **Actual**: no migrated TimescaleDB test DB can be provisioned in the execute container (Docker Hub 429 on `timescale/timescaledb:latest-pg16`, no apt package, GitHub source download 403), and the execute loop never starts a database. Ran the rest of the block locally: `go build` and `go vet -tags dbtest` clean, `golangci-lint` v2.14.0 (pinned install, built with go1.27.0, put first on `PATH` because the host binary is 2.5.0) `0 issues.`, `pool.Exec(ctx, stmt` no match, `FOR NO KEY UPDATE` only at `:124` (`backfillLockSQL`).
- **Disposition**: operator decision B 2026-11-17 — explicit P-06 waiver of LOCAL red-before-green for the dbtest-verified steps of feature 359. The dbtest run and the Steps 1–2 RED/GREEN evidence are deferred to the CI `Portfolio DB test (TimescaleDB)` job on the integration PR. No test was weakened, skipped or loosened; `:443`, `:349` and `:252-295` are untouched.

### DEV-2 — Step 2: dbtest Verification lines and local RED/GREEN deferred to CI (2026-11-17)

- **Expected**: Step 2's Verification runs the two `PORTFOLIO_DB_TEST_URL=<migrated test DB URL> … -tags dbtest` lines, and the TDD gate captures RED (`branch="addDone"` plus the strict-equality failure) on the pre-Step-1 tree and GREEN (`branch="blocked"`) after Step 1, locally.
- **Actual**: `PORTFOLIO_DB_TEST_URL` is unset and the execute loop never starts a database, so both new tests SKIP locally (`.sdd-logs/v-1.log`). Ran the rest of the block: `go vet -tags dbtest` clean, the coverage gate (`total: 81.8%`), `golangci-lint` v2.14.0 (pinned, built with go1.27.0; `.golangci.yml` sets `build-tags: dbtest`) `0 issues.`, and the `:443` diff guard `0`. Step 1 was already committed before this step, so no pre-fix RED tree exists on the branch; RED needs the CI job run against `2f99b190^` or a revert of `applyBackfillRow`.
- **Disposition**: covered by operator decision B 2026-11-17 (DEV-1: P-06 waiver of LOCAL red-before-green for Steps 1, 2, 3+4). The RED/GREEN branch proof and the `wait_event_type='Lock'` / `insertBindingsTx` assumptions are deferred to the CI `Portfolio DB test (TimescaleDB)` job on the integration PR. `:443`, `:349` and `:252-295` are untouched (append-only diff).

### DEV-3 — Steps 3+4: dbtest Verification lines and local RED/GREEN deferred to CI (2026-11-17)

- **Expected**: the unit's Verification runs the two `PORTFOLIO_DB_TEST_URL=<migrated test DB URL> … -tags dbtest` lines, and the TDD gate captures RED (`rec.ValidUntil ≈ now()` fails the `[t0+72h, t1+72h]` bound) on the pre-Step-3 tree and GREEN after Step 3, locally.
- **Actual**: no migrated test DB exists here and the execute loop never starts a database. Ran the block with the `PORTFOLIO_DB_TEST_URL=<…>` prefix dropped and `-v` added to the two targeted lines so the SKIP/PASS is visible: the dbtest files compile under `-race`, `TestBackfill_StrictUntrackedRemoval` `--- SKIP`, `TestSignalPrune_UntrackedEventPayload` `--- PASS`, coverage `total: 81.8%`, `golangci-lint` v2.14.0 (pinned, built with go1.27.0, first on `PATH`) `0 issues.` Step 3 greps: `backfillMarkGrace` at `:117` (const) and `:121` (one use); no `mark_grace` match in config migrations or `internal/config`.
- **Disposition**: covered by operator decision B 2026-11-17 (DEV-1: P-06 waiver of LOCAL red-before-green for Steps 1, 2, 3+4). The dbtest run and the @AC-3 RED/GREEN proof are deferred to the CI `Portfolio DB test (TimescaleDB)` job on the integration PR; RED needs that job on this unit's parent commit with only the test rewrite applied. No test was weakened, skipped or loosened; `:443`, `:349` and `:252-295` are untouched.
