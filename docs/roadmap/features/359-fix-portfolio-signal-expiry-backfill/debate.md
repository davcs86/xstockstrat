# Debate Register: fix-portfolio-signal-expiry-backfill

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-batch | 6 | 4 | 0 | 7 | 0 | yes |
| 2 | 2026-11-17 | /sdd-batch | 4 | 2 | 6 | 2 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Fix site is the backfill APPLY loop only (signal_expiry_backfill.go:157-183). watchlist_repo.go, backfillSeedSQL and backfillMarkSQL stay unchanged. | watchlist_repo.go:291-296 (@AC-17 rescue is update-only); feature 354 is editing watchlist_repo.go | settled |
| D-2 | 1 | Each APPLY candidate runs in one short READ COMMITTED transaction with exactly two statements: Exec of `SELECT 1 FROM portfolio.watchlists WHERE watchlist_id=$1 FOR NO KEY UPDATE`, then the unchanged seed or mark INSERT. The lock must be its own statement. | signal_expiry_repo.go:70 lock form; watchlist_repo.go:502 touchWatchlistTx; watchlist_repo.go:545-546 parent-row lock contract; RC per-statement snapshot | settled |
| D-3 | 1 | Outcome accounting is unchanged. Begin, lock and commit errors route through the existing ABORTED path; 0 rows (including a deleted watchlist) map to 'changed since REPORT'. | signal_expiry_backfill.go:168-176 | settled |
| D-4 | 1 | The seed path is in scope as FR-2 / @AC-2, appended to product-spec.md and acceptance.feature. | backfillSeedSQL has the same NOT EXISTS + ON CONFLICT shape (signal_expiry_backfill.go:101-121) | settled |
| D-5 | 1 | Production ingest commits the signal before AddWatchlistSymbols. This is recorded as evidence and is no longer an assumption. | services/xstockstrat-agent/app/tools.py:690 awaits ingest_signal, then :741-747 calls ensure/add; the ingest service has no AddWatchlistSymbols caller | settled |
| D-6 | 1 | TestBackfill_IngestRaceNeverLeavesEntryRemovable (:443) stays byte-identical. TestBackfill_IngestInterleavingSkipsChanged (:349) is a must-still-pass guard. Deterministic RED is built in test code only, with no production hook. | Operator decision 2026-11-17; signal_expiry_backfill_dbtest_test.go:349,:400-403,:443 | settled |
| D-7 | 2 | applyBackfillRow is the single-caller helper. It returns (pgconn.CommandTag, error), so signal_expiry_backfill.go:168-183 stays byte-identical, and it uses the package rollback idiom `defer func() { _ = tx.Rollback(ctx) }()` inside the helper only. | signal_expiry_backfill.go:167-183, :207; signal_expiry_repo.go:66; watchlist_repo.go:43 | settled |
| D-8 | 2 | The forced-interleave tests pin their pools. APPLY uses a pool with no lock_timeout (as at :351-356). AddSymbols uses NewWatchlistRepo over testPool with lock_timeout=10s. The gate is two-branch: addDone returned, or a Lock waiter with query LIKE 'UPDATE portfolio.watchlists SET updated_at%'. Behaviour assertions run before the branch=='blocked' assertion. | watchlist_ensure_dbtest_test.go:20; dbtest_helpers_test.go:35; signal_expiry_prune_dbtest_test.go:439; watchlist_repo.go:505 | settled |
| D-9 | 2 | The GREEN assertion is strict equality (signal_id==sigID, valid_until==until, in the future), with no pre-authorized relaxation. Any divergence at execute escalates to the register. | ON CONFLICT re-checks only the unique index after the speculative-insert wait; the :349 precedent at :419-430 relies on the same behaviour | settled |
| D-10 | 2 | The doc edits cover runbook :66-67 and §7 :150-153, a merged 2-line comment at signal_expiry_backfill.go:99-100 that keeps the zero-rows rule, a correction at :123-124, and a lock-order invariant line next to PORTFOLIO-18 in the portfolio context-constitution. | docs/runbooks/signal-watchlist-expiry-backfill.md:66-67,:150-153; signal_expiry_backfill.go:99-100,:123-124; services/xstockstrat-portfolio/docs/context-constitution.md:30 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Single-statement CTE lock + INSERT (`WITH l AS (SELECT ... FOR NO KEY UPDATE) INSERT ...`) | Under RC the snapshot predates the lock grant, and EvalPlanQual does not re-check the NOT EXISTS subquery, so the race persists | locked |
| R-2 | 1 | Upsert in mergeSignalExpirySQL (add-path fix) | It CHANGEs @AC-9, @AC-17 and the untracked-stays-untracked contract, and touches watchlist_repo.go, which 354 is editing | locked |
| R-3 | 1 | SERIALIZABLE APPLY or a backfill-only advisory lock | SSI needs AddSymbols at SERIALIZABLE too, and an advisory lock needs an add-path edit. Both are worse than the documented parent-row lock | locked |
| R-4 | 1 | Locking via the touchWatchlistTx UPDATE | It bumps updated_at, a user-visible side effect for no benefit | locked |
| R-5 | 2 | Pre-authorizing a relaxed GREEN assertion ('absent OR signal_id==sigID') in the forced-interleave tests | The NOT EXISTS re-evaluation risk is not real (ON CONFLICT re-checks only the unique index after the wait), and loosening in place weakens the C-15 RED/GREEN proof | locked |
| R-6 | 2 | A production lock_timeout on backfill APPLY | YAGNI: AddSymbols transactions are short, there is no production lock_timeout precedent, and the one-shot job is operator-interruptible | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | [C-15/P-06] The forced-interleave tests must pin their pools: backfillApply on a no-lock_timeout pool, AddSymbols on a testPool with lock_timeout raised to about 10s. The 500ms default gives 55P03 on GREEN. | yes | closed @ round 2 (Pools pinned: applyPool with no lock_timeout (as at :351-356), addPool = testPool with a 10s lock_timeout override (as at watchlist_ensure_dbtest_test.go:20), and the 500ms testPool for seed, poll and asserts) |
| O-2 | 1 | [C-15] The step-4 gate must be 'AddSymbols returned OR a waiter with query LIKE UPDATE portfolio.watchlists%' (excluding the INSERT waiter), and the test must assert which branch fired. | yes | closed @ round 2 (Exact two-branch gate pinned (addDone, or the 'UPDATE portfolio.watchlists SET updated_at%' Lock waiter), which cannot match the INSERT waiter; branch=='blocked' is asserted after the behaviour assertions) |
| O-3 | 1 | [C-15] The @AC-2 seed RED needs a prior own signal with a past valid_until, plus signal_id and valid_until equality assertions. FR-2/@AC-2 must be appended to product-spec.md and acceptance.feature. | yes | open |
| O-4 | 1 | [P-03] Per-candidate transaction error surface: rollback on every error, the ABORTED path for begin/lock/commit, Exec (not Scan) for the lock. | no | closed @ round 2 (Lock via Exec (a deleted list gives 0 rows, then 'changed since REPORT'); `_ = tx.Rollback` defer in the helper per :207; begin, lock, insert and commit errors all go through the unchanged ABORTED path) |
| O-5 | 1 | [C-18] No defer in the loop. Use a single-caller helper returning (rowsAffected, err); no generic abstraction. | no | closed @ round 2 (One single-caller helper returning (CommandTag, error); the defer lives only in the helper, never in the :157 loop) |
| O-6 | 1 | [C-16] Runbook §7 must state that a 'changed since REPORT' row can stay untracked until REPORT and APPLY are re-run. | no | closed @ round 2 (The runbook gains the 'changed since REPORT stays untracked until REPORT and APPLY are re-run' sentence, and both autocommit claims (:66-67 and :150-153) are reworded) |
| O-7 | 1 | [C-08/C-16] List the :349 interleaving test as an explicit must-still-pass guard in spec. | no | closed @ round 2 (:349 TestBackfill_IngestInterleavingSkipsChanged is a named must-still-pass guard in the approach) |
| O-8 | 2 | [PORTFOLIO constitution] Add the lock-order invariant (every watchlist_signal_expiry writer takes the parent watchlists row lock first, and APPLY is now one of them) next to PORTFOLIO-18 as a mandatory spec step. | no | open |
| O-9 | 2 | [C-18] The shared forced-interleave test helper takes only the class and the prior-signal setup, takes no function hooks, returns (sigID, until, branch), and leaves assertions in each test body. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
