# Product Spec: fix-portfolio-signal-expiry-backfill

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-17

---

## Problem Statement

**Observed.** `TestBackfill_IngestRaceNeverLeavesEntryRemovable` (`services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go`) fails intermittently. It failed once in CI run 43997601438 with `iteration 1: entry left due (valid_until=… signal_id=<nil>) while a live signal exists`, then passed on re-run.

A backfill APPLY (`RunBackfill`, mode `apply`) races a signal ingest for the same system-watchlist SIGNAL binding. The race can leave a `portfolio.watchlist_signal_expiry` row with `valid_until ≈ now()` and `signal_id NULL`, which is the backfill "untracked mark". At that point a live `ingest.newsletter_signals` row (watchlist direction, `valid_until` 30 days out) exists, and `AddSymbols` has committed its provenance intent for it. The next prune tick removes the entry and emits `portfolio.watchlist.signal_entry_removed_untracked`.

**Expected.** If a live signal for the binding commits while APPLY is running, the entry must never end up due. Either the mark writes nothing (the runbook's "changed since REPORT" guarantee, `docs/runbooks/signal-watchlist-expiry-backfill.md` §7), or the add path rescues the mark row (the documented contract of `mergeSignalExpirySQL`).

## Reproduction Steps

1. A system-managed watchlist has a `source = 2` SIGNAL binding with no expiry row and no own watchlist signals, so REPORT classifies it as untracked.
2. Run REPORT, then APPLY with the printed bounds. Concurrently, insert and commit a live watchlist-direction signal for that owner and symbol, then call `WatchlistRepo.AddSymbols` with a provenance intent for it.
3. Losing interleaving:
   1. The mark statement's READ COMMITTED snapshot predates the signal commit, so `NOT EXISTS` passes.
   2. The add path's update-only `mergeSignalExpirySQL` runs before the mark row commits and affects 0 rows.
   3. The mark commits a due `signal_id NULL` row.
4. The prune tick deletes the binding.

Intermittent. The guard test is `go test -tags dbtest -race -count=1 -run TestBackfill_IngestRaceNeverLeavesEntryRemovable ./internal/repository/...` (from `services/xstockstrat-portfolio`, with `PORTFOLIO_DB_TEST_URL` set).

## Root Cause Hypothesis

Nothing serializes the backfill APPLY writes against the add path:

- `backfillMarkSQL` (`internal/repository/signal_expiry_backfill.go:114-121`) runs as a pool autocommit statement (`:167`). Its `NOT EXISTS` is evaluated on a snapshot that can predate a concurrent signal commit.
- The add path's `mergeSignalExpirySQL` (`internal/repository/watchlist_repo.go:293`) is UPDATE-only, so it is a no-op if the mark row is not yet committed.
- The backfill never takes the parent `portfolio.watchlists` row lock that `AddSymbols` holds through `touchWatchlistTx`. `applyExpiryIntentTx` documents that lock as the serialization point.

Possibly the same shape, not observed: `backfillSeedSQL` (`:101-112`) can commit a stale, already-expired `valid_until` after a merge that found no row.

## Affected Services

- xstockstrat-portfolio (repository layer: `signal_expiry_backfill.go`, possibly `watchlist_repo.go#applyExpiryIntentTx`). The `backfill-signal-expiry` subcommand and its runbook may need a wording update.

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature`. Its regression scenario must fail on the buggy behavior and pass after the fix (Constitution **C-15**). Also, existing tests pass and the affected service is smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Changes to the prune tick's locking (PORTFOLIO-18), unless the design shows they are required
