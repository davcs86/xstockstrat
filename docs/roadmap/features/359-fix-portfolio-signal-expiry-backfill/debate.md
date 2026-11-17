# Debate Register: fix-portfolio-signal-expiry-backfill

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-batch | 6 | 4 | 0 | 7 | 0 | yes |
| 2 | 2026-11-17 | /sdd-batch | 4 | 2 | 6 | 2 | 0 | yes |
| 3 | 2026-11-17 | /sdd-batch | 4 | 3 | 3 | 2 | 1 | yes |

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
| D-11 | 3 | FR-3: backfillMarkSQL selects now() + backfillMarkGrace instead of now() at signal_expiry_backfill.go:116, for marks only. backfillSeedSQL and watchlist_repo.go stay untouched. This supersedes only D-1's 'backfillMarkSQL unchanged' clause; D-1's lock-fix scope stands. | Operator decision 2026-11-17 (FR-3 / @AC-3, which sanctions the CHANGE of 281 @AC-16 and runbook §8); signal_expiry_backfill.go:101-121 | settled |
| D-12 | 3 | The grace is an unexported Go string constant backfillMarkGrace = interval '72 hours', concatenated the way ownWatchlistSignals is. It is not a config key: no migration, no SetConfig bound, no $3 parameter. The F-07 reasoning is recorded in context.md. | docs/patterns/config-governance.md:7 (env-specific scope); cmd/server/backfill.go:29-61 (no config client); product-spec Fix Scope 'No config key changes'; signal_expiry_backfill.go:107,120,167 | settled |
| D-13 | 3 | The @AC-3 test rewrites the removal tail of TestBackfill_StrictUntrackedRemoval (:216-250), retagged AC-16+AC-3. It asserts signal_id nil and valid_until within [t0+72h, t1+72h], that a prune immediately after APPLY is empty, then backdates the row past the boundary and asserts assertPruned with SignalID nil plus assertBindingGone. There is no pre-boundary aging step. The event kind is covered by signal_prune.go:59-70 and signal_prune_test.go:102. | signal_expiry_backfill_dbtest_test.go:216-250; signal_expiry_repo.go:38,151 (DB now(), no clock seam); fails.md:1902-1908 | settled |
| D-14 | 3 | The FR-3 documentation set covers: runbook :27, §8 retitle, §9 emergency window, §11; the docs/runbooks/CLAUDE.md backfill row; a durable @AC-16 CHANGE tagged @feature-359 and an @AC-17 retitle to 'before it is pruned' in the same commit; a PORTFOLIO-18 grace note; and a portfolio CLAUDE.md Database bullet. TestBackfill_MarkedEntryRescued (:252-295) stays as a must-still-pass guard with no edit. | signal-watchlist-expiry-pruning.feature:127-139; watchlist_repo.go:294-295; context-constitution.md:30 | settled |

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
| R-7 | 3 | Config key portfolio.watchlist.backfill_mark_grace_hours (with a seed migration and a SCALAR_BOUNDS entry) for the mark grace | The value is not env-specific, the one-shot CLI has no config client, and it contradicts the Fix Scope and the operator's fixed acceptance value | locked |
| R-8 | 3 | Grace via interval '3 days' or via a $3 bind parameter | '3 days' is DST-dependent on timestamptz and diverges from the 72h test literal; $3 breaks the shared (wlID, sym) argument list at :167 | locked |
| R-9 | 3 | Pre-boundary 'age to 1 minute before, prune still empty' step in the @AC-3 test | It re-tests the 281 prune comparator rather than the grace, and adds a timing assumption; the DB-written bound already proves the grace | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | [C-15/P-06] The forced-interleave tests must pin their pools: backfillApply on a no-lock_timeout pool, AddSymbols on a testPool with lock_timeout raised to about 10s. The 500ms default gives 55P03 on GREEN. | yes | closed @ round 2 (Pools pinned: applyPool with no lock_timeout (as at :351-356), addPool = testPool with a 10s lock_timeout override (as at watchlist_ensure_dbtest_test.go:20), and the 500ms testPool for seed, poll and asserts) |
| O-2 | 1 | [C-15] The step-4 gate must be 'AddSymbols returned OR a waiter with query LIKE UPDATE portfolio.watchlists%' (excluding the INSERT waiter), and the test must assert which branch fired. | yes | closed @ round 2 (Exact two-branch gate pinned (addDone, or the 'UPDATE portfolio.watchlists SET updated_at%' Lock waiter), which cannot match the INSERT waiter; branch=='blocked' is asserted after the behaviour assertions) |
| O-3 | 1 | [C-15] The @AC-2 seed RED needs a prior own signal with a past valid_until, plus signal_id and valid_until equality assertions. FR-2/@AC-2 must be appended to product-spec.md and acceptance.feature. | yes | closed @ round 3 (The operator appended FR-2/@AC-2 (and FR-3/@AC-3) to product-spec.md and acceptance.feature on the feature branch (verified); the seed RED design is pinned in D-8/D-9) |
| O-4 | 1 | [P-03] Per-candidate transaction error surface: rollback on every error, the ABORTED path for begin/lock/commit, Exec (not Scan) for the lock. | no | closed @ round 2 (Lock via Exec (a deleted list gives 0 rows, then 'changed since REPORT'); `_ = tx.Rollback` defer in the helper per :207; begin, lock, insert and commit errors all go through the unchanged ABORTED path) |
| O-5 | 1 | [C-18] No defer in the loop. Use a single-caller helper returning (rowsAffected, err); no generic abstraction. | no | closed @ round 2 (One single-caller helper returning (CommandTag, error); the defer lives only in the helper, never in the :157 loop) |
| O-6 | 1 | [C-16] Runbook §7 must state that a 'changed since REPORT' row can stay untracked until REPORT and APPLY are re-run. | no | closed @ round 2 (The runbook gains the 'changed since REPORT stays untracked until REPORT and APPLY are re-run' sentence, and both autocommit claims (:66-67 and :150-153) are reworded) |
| O-7 | 1 | [C-08/C-16] List the :349 interleaving test as an explicit must-still-pass guard in spec. | no | closed @ round 2 (:349 TestBackfill_IngestInterleavingSkipsChanged is a named must-still-pass guard in the approach) |
| O-8 | 2 | [PORTFOLIO constitution] Add the lock-order invariant (every watchlist_signal_expiry writer takes the parent watchlists row lock first, and APPLY is now one of them) next to PORTFOLIO-18 as a mandatory spec step. | no | closed @ round 3 (The lock-order invariant next to PORTFOLIO-18 (context-constitution.md:30) is a mandatory spec doc step, together with the FR-3 grace note) |
| O-9 | 2 | [C-18] The shared forced-interleave test helper takes only the class and the prior-signal setup, takes no function hooks, returns (sigID, until, branch), and leaves assertions in each test body. | no | closed @ round 3 (The helper is pinned as runForcedInterleave(t, class, priorSignalAge time.Duration) (sigID, until, branch): no function-valued parameters, assertions in each test body, and the @AC-3 test does not use it) |
| O-10 | 3 | [C-15/C-16] After FR-3, 359's @AC-1 Then clause and FR-1 text ('absent or valid_until in the future'; 'prune removes nothing') pass on lock-less code: the mark that lost the race is +72h/NULL and is pruned at APPLY+72h while the signal is live. The operator must amend them to 'absent or tracked by the live signal (signal_id and valid_until)' plus 'a prune after 3 days removes nothing', or sign a written waiver that the strict test assertion carries the guarantee. | yes | open |
| O-11 | 3 | [C-08] Present the :443 blindness to @AC-1 as an explicit design-gate line item, and list the forced-interleave tests in spec as must-not-weaken with the same status as :443 under D-6. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 3 | D-1 | Operator decision 2026-11-17 (FR-3) explicitly sanctions changing backfillMarkSQL's valid_until, which contradicts D-1's 'backfillMarkSQL unchanged' clause; this evidence post-dates D-1 and is not on the register. The petition asks the operator to confirm D-1 as superseded-in-part by the FR-3 decision; its lock-fix scope stands. | pending user |
