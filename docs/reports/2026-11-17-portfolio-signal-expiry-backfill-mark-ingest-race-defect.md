# Defect: portfolio signal-expiry backfill mark races a concurrent signal add, leaving a live entry prunable

**Recorded**: 2026-11-17
**Severity**: SEV-2
**Impact type**: silent-data-loss (watchlist entry removed while its signal is live)
**Environment**: CI (Portfolio DB test, TimescaleDB); production exposure when `backfill-signal-expiry --mode=apply` overlaps signal ingest
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

`TestBackfill_IngestRaceNeverLeavesEntryRemovable` failed once in CI and passed on retry:

- Failing run: https://github.com/davcs86/xstockstrat/actions/runs/43997601438, job "Portfolio DB test (TimescaleDB)" (job 133753465478), PR #1566, 2026-11-17:
  `--- FAIL: TestBackfill_IngestRaceNeverLeavesEntryRemovable (0.08s)`
  `signal_expiry_backfill_dbtest_test.go:494: iteration 1: entry left due (valid_until=2026-11-17 01:43:41.579708 +0000 UTC signal_id=<nil>) while a live signal exists`
- Same PR re-run green: run 43998297248 (conclusion `success`). main-dev green: run 43995549716 (conclusion `success`).
- PR #1566 (fix-listwatchlists-page-token) does not touch the backfill or the `AddSymbols` expiry paths, so this is a latent race in feature 281, not a regression from that PR.

After the race, the expiry row has `valid_until ≈ now()` and `signal_id = NULL`. That is the "untracked mark" shape, and it is due immediately. A live `ingest.newsletter_signals` row for the same owner and symbol (`direction='watchlist'`, `valid_until = now()+30d`) exists, and the add path's provenance intent for it has already committed.

## Expected

If a live signal for the binding commits while APPLY is running, the entry must not end up due, by either path:
the mark's `NOT EXISTS` sees the signal and writes nothing ("changed since REPORT", as `docs/runbooks/signal-watchlist-expiry-backfill.md` §7 promises), or the add path's merge rescues the mark row (`mergeSignalExpirySQL` is documented to do this: "a backfill-marked row (signal_id NULL) is rescued").

## Reproduction

Intermittent. 1 failure observed in 3 CI runs of the job. No local loop was run when this was recorded.

1. A system-managed watchlist has a `source = 2` (SIGNAL) binding with no expiry row and no own watchlist signals, so REPORT classifies it as untracked.
2. Run REPORT, then APPLY with the printed bounds. Concurrently: (a) INSERT a live `ingest.newsletter_signals` row for that owner and symbol and commit it, then (b) call `WatchlistRepo.AddSymbols` with `provenanceIntent(symbol, id, valid_until)` for the same binding.
3. Interleaving that loses the entry:
   1. The APPLY mark statement takes its READ COMMITTED snapshot before (a) commits, so its `NOT EXISTS` subquery sees no signal.
   2. (b) runs `mergeSignalExpirySQL`, an UPDATE-only statement, before the mark INSERT commits. The UPDATE cannot see the uncommitted row and does not wait on it, so it affects 0 rows. `AddSymbols` commits.
   3. The mark INSERT commits with `valid_until = now()` and `signal_id = NULL`.
4. The next prune tick (`lockDueExpiryTx`: `valid_until <= now()`) deletes the binding and emits `portfolio.watchlist.signal_entry_removed_untracked`.

Guard test: `go test -tags dbtest -race -count=1 -run TestBackfill_IngestRaceNeverLeavesEntryRemovable ./internal/repository/...` (from `services/xstockstrat-portfolio`, with `PORTFOLIO_DB_TEST_URL` set).

## Evidence

`services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go:114-121`
> `INSERT INTO portfolio.watchlist_signal_expiry (watchlist_id, symbol, valid_until, signal_id) SELECT s.watchlist_id, s.symbol, now(), NULL … AND NOT EXISTS (SELECT 1 FROM ` + ownWatchlistSignals + `) ON CONFLICT DO NOTHING`

`services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go:167`
> `tag, err := pool.Exec(ctx, stmt, c.watchlistID, c.symbol)` (one autocommit statement on the pool: default READ COMMITTED, and no `touchWatchlistTx` parent-row lock)

`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:291-296`
> `// mergeSignalExpirySQL is update-only: an untracked entry (no row) stays untracked, and a backfill-marked row (signal_id NULL) is rescued.`
> `const mergeSignalExpirySQL = \`UPDATE portfolio.watchlist_signal_expiry SET valid_until = CASE WHEN signal_id IS NULL THEN $3 …`

`services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:546-571` (`applyExpiryIntentTx`): when the binding already exists (`!inserted[intent.Symbol]`) and `source == SIGNAL`, the only expiry write is `mergeSignalExpirySQL`. The function comment says the caller holds the parent watchlist row lock "which every binding deleter also takes first". The backfill writer does not take that lock.

`services/xstockstrat-portfolio/internal/repository/signal_expiry_repo.go` `#lockDueExpiryTx`
> `SELECT symbol, signal_id, valid_until FROM portfolio.watchlist_signal_expiry WHERE watchlist_id = $1 AND valid_until <= now() FOR UPDATE SKIP LOCKED`

`services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go:443-503`: the race test. Line 494 is the failing assertion.

`docs/runbooks/signal-watchlist-expiry-backfill.md` §7 says each APPLY statement "recomputes the class from ingest at statement time, so a row whose class changed since REPORT (for example, a new live signal arrived) writes nothing". This defect falsifies that guarantee for a signal that commits during the statement. §8 says marks are due "on the very next prune tick". The runbook does not tell operators to quiesce signal ingest during APPLY.

## Root cause hypothesis

Confirmed by reading the code; not reproduced deterministically. Nothing serializes the backfill mark against the add path:

- The mark's `NOT EXISTS` is evaluated on a statement snapshot that can predate a signal's commit.
- The add path's merge is UPDATE-only, so it is a no-op if it runs before the mark row is committed.
- The mark does not take the parent `portfolio.watchlists` row lock that `AddSymbols` holds (`touchWatchlistTx`).

Possibly the same shape, not observed: the seed statement (`backfillSeedSQL`, `:101-112`) picks `max(valid_until)` from the same kind of snapshot. It could commit an older, already-expired `valid_until` after a merge that found no row, leaving a `seed_expired`-style row due while a newer live signal exists.

Production exposure: only while an operator runs APPLY (a one-shot, DBA-reviewed run) and a watchlist-direction signal for an untracked binding is ingested inside a single statement's window. The damage is the removal of a live signal's watchlist entry with an owner-visible `signal_entry_removed_untracked` event. Nothing restores the entry until another signal for the symbol re-adds it.

## Confidence

high
