# Design: fix-portfolio-signal-expiry-backfill

**Created**: 2026-11-17
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-17 (operator approval at the /sdd-batch design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

The fix has two parts. The parent-row lock fix (D-1..D-10) is unchanged from round 2. FR-3 (D-11..D-14) sits on top of it as an operator-sanctioned change to the mark SQL only. Nothing changes in proto, migrations (portfolio or config), config keys or services. The fix is internal to `xstockstrat-portfolio`, and the only operator-visible surface is the backfill CLI and its runbook. No UI segment or Agent tool changes (C-14).

### 1. Lock fix (D-1, D-2, D-3, D-7)

**The race.** The APPLY loop runs one pool-autocommit `pool.Exec` per candidate (recon.md:21, `signal_expiry_backfill.go:157-183`, `:167`). `backfillMarkSQL` takes no row lock (recon.md:22). `AddSymbols` does hold the parent row lock through `touchWatchlistTx` (recon.md:24-28). But its `mergeSignalExpirySQL` is update-only (recon.md:33), so it misses a mark row that has not committed yet (recon.md:44-48). The seed path has the same shape (recon.md:23, :50).

**The fix.** At `:167`, call a new single-caller helper `applyBackfillRow(ctx, pool, stmt, c.watchlistID, c.symbol)`, which returns `(pgconn.CommandTag, error)`. Inside it:
- Begin at READ COMMITTED, then `defer func() { _ = tx.Rollback(ctx) }()`.
- Exec `backfillLockSQL` = `SELECT 1 FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE` as its own statement. This reuses the parent-row serialization point (recon.md:29, :54-56) without bumping `updated_at` (recon.md:113).
- Exec the unchanged `stmt` with `(wlID, sym)`.
- Commit.

**Why it works.** Under READ COMMITTED, the INSERT's snapshot is taken after the lock is granted, so both orderings resolve correctly (recon.md:58-60):
- **Add path commits first:** the mark sees the signal and writes 0 rows, which the loop reports as "changed since REPORT".
- **Mark commits first:** `AddSymbols` blocks in `touchWatchlistTx` until the mark commits, and its merge then rescues the mark (@AC-17).

**Error handling.** `:168-183` stay byte-identical. Begin, lock, insert and commit errors all take the existing ABORTED path. Zero rows, including the deleted-watchlist case, still means "changed since REPORT" (recon.md:61).

**Pooling.** A short explicit transaction works with the pooled `:25061` URL (recon.md:114). The prune `SKIP LOCKED`s a list the backfill holds for one tick, which @AC-12 / PORTFOLIO-18 allows (recon.md:115).

**Call order.** Production ingest commits the signal before `AddWatchlistSymbols` (D-5, `services/xstockstrat-agent/app/tools.py:690`, `:741-747`). This closes recon.md:112.

### 2. FR-3 mark grace (D-11, D-12; operator decision 2026-11-17)

**The change.** In `backfillMarkSQL` (recon.md:22), the select list at `:116` changes from `now()` to `now() + ` concatenated with `backfillMarkGrace`, a new unexported Go string constant equal to `interval '72 hours'`. The constant is concatenated into the SQL the same way `ownWatchlistSignals` already is (`:107`, `:120`).
- `backfillSeedSQL` (`:101-112`) stays byte-identical, so seed rows keep the owner's signal `valid_until`.
- `watchlist_repo.go` is untouched.
- `now()` is the start of each candidate's own transaction, so the grace is anchored to that row's APPLY write.

**Why not a config key (F-07).** This reasoning is recorded in context.md so `/sdd-review` does not re-flag it:
- `config-governance.md:7` scopes the hardcoding ban to values that differ per environment. This value is the same in every environment and was fixed by the operator.
- The backfill CLI has no config client (`cmd/server/backfill.go:29-61`; recon.md:37).
- The product-spec Fix Scope says "No config key changes".

### 3. Comments (D-10)

Comments stay within the 2-line cap:
- Use the merged 2-line comment at `:99-100`, keeping the zero-rows rule.
- At `:123-124`, change "autocommit row" to "one short locked tx per row".

### 4. Tests (`internal/repository/signal_expiry_backfill_dbtest_test.go`)

#### Forced-interleave tests for @AC-1 and @AC-2 (D-8, D-9)

There are two new tests:
- `TestBackfill_MarkIngestInterleavingRescued` for @AC-1.
- `TestBackfill_SeedIngestInterleavingRescued` for @AC-2.

Both use a shared helper, `runForcedInterleave(t, class, priorSignalAge time.Duration) (sigID int64, until time.Time, branch string)`.
- A `priorSignalAge` of 0 means there is no prior signal. The seed test passes an age in the past.
- The helper takes no function-valued parameters, and every assertion stays in the test body (O-9).
- The technique reuses the `:349` second-connection, open-transaction and `pg_stat_activity` polling pattern (recon.md:40, :62-67).

The tests use three pools:
- The 500ms `testPool`.
- An `applyPool` with no `lock_timeout`, as at `:351-356`.
- An `addPool` with `lock_timeout=10s`.

The gate has two branches:
- `addDone` returned, or
- a Lock waiter whose query is `LIKE 'UPDATE portfolio.watchlists SET updated_at%'`.

Assertions run in this order:
1. Strict equality: `signal_id == sigID` and `valid_until == until`, with `until` in the future. Any relaxation is rejected (R-5).
2. `mustPrune` returns nothing.
3. `assertSource(srcSignal)`.
4. `branch == "blocked"`, checked last.

After FR-3, these two tests are the only guard on the lock fix. The spec must list them as must-not-weaken, with the same status as `:443` under D-6 (O-11).

#### @AC-3 test: CHANGE of 281 @AC-16 (D-13)

Rewrite the removal tail of `TestBackfill_StrictUntrackedRemoval` (`:216-250`) and retag it `AC-16+AC-3`. Keep the REPORT and refusal half (`:226-236`). The new tail:
1. Capture `t0 := dbNow(pool)` before APPLY and `t1` after it.
2. With `rec := dueRow(...)`, assert that `rec.SignalID == nil` and that `rec.ValidUntil` lies within `[t0+72h, t1+72h]`. The literal 72h checks the value the DB actually wrote, so this is not the constant-versus-constant tautology described in `fails.md:1902-1908`.
3. Run `mustPrune` immediately after APPLY and assert it is empty, and assert `assertSource(PLTR, srcSignal)`.
4. Backdate the row past the boundary: `valid_until = valid_until - interval '72 hours' - interval '1 millisecond'`.
5. Assert `assertPruned(mustPrune(...), PrunedEntry{user-2, wlID, "PLTR", StrategyID "strat-3", SignalID nil, ValidUntil aged})` and `assertBindingGone`.

The event kind follows from `SignalID == nil`: the routing is at `signal_prune.go:59-70` and the payload is guarded by `signal_prune_test.go:102`. Backdating is the only clock seam, because the prune uses the DB's `now()` (`signal_expiry_repo.go:38`, `:151`) and D-6 forbids a production clock hook (recon.md:119).

#### Must-still-pass guards (no edits)

- `:443` `TestBackfill_IngestRaceNeverLeavesEntryRemovable` stays byte-identical (operator decision; recon.md:39).
- `:349` `TestBackfill_IngestInterleavingSkipsChanged`.
- `:252-295` `TestBackfill_MarkedEntryRescued` (@AC-17). It still passes because `mergeSignalExpirySQL` overwrites `valid_until` when `signal_id IS NULL` (`watchlist_repo.go:294-295`).

### 5. Docs (D-10, D-14)

**Runbook `docs/runbooks/signal-watchlist-expiry-backfill.md`:**
- **`:27`:** the mark is `valid_until = now() + 72 hours`, and it is pruned on the first tick after that.
- **`:66-67` and §7 `:150-153`:** the per-row transaction wording (recon.md:42, :118), plus the sentence "a 'changed since REPORT' row stays untracked until REPORT and APPLY are re-run".
- **§8 (`:160-175`):** retitle to "3-day grace for marks; none for seed_expired", and note that a live signal added within the window rescues a mark.
- **§9 (`:177-205`):** the emergency-stop window is one interval for seed_expired removals and 3 days for marks.
- **§11 (`:223`):** watch the next tick for seed_expired, and watch after 3 days for marks.

**`docs/runbooks/CLAUDE.md`:** in the backfill row, replace "no grace period" with "3-day grace for untracked marks; seed_expired removed next tick".

**Durable acceptance (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`):** make both edits in the same `@feature-359` commit:
- CHANGE @AC-16 (`:127-136`) to: the mark row has `signal_id NULL` and `valid_until` 3 days after APPLY; a tick within 3 days removes nothing; a tick after 3 days removes PLTR with one `signal_entry_removed_untracked` event.
- Retitle @AC-17 (`:139`) to "...rescued by a live signal before it is pruned". This is a wording change only.

**`services/xstockstrat-portfolio/docs/context-constitution.md`, next to PORTFOLIO-18 (`:30`):**
- Add the lock-order invariant: every `watchlist_signal_expiry` writer, including backfill APPLY, takes the parent `watchlists` row lock first.
- Add the grace note: backfill marks are written with `signal_id NULL` and a fixed 72h grace (`backfillMarkGrace`), and the add-path merge rescues them.

**`services/xstockstrat-portfolio/CLAUDE.md`:** in the Database bullet for `signal_id NULL`, append "due 72h after APPLY".

### 6. Build order

- **Step 1:** write the RED forced-interleave tests, then make them GREEN with the lock fix.
- **Step 2:** rewrite `:216-250` so it fails on `now()`, then make it GREEN with the one-token SQL change. Then do the docs.

### 7. @AC-1 / FR-1 wording (O-10, closed)

The operator amended 359's own @AC-1 Then clause and FR-1 at the round-3 gate (commit `96fad930`). They now read "the expiry row is either absent or tracked by the live signal (its signal_id and valid_until)" plus "a prune tick run after 3 days removes nothing". The scenario text therefore matches the D-9 strict-equality assertion again, and a mark that lost the race no longer satisfies it.

## Rejected Alternatives

- `R-1` Single-statement CTE lock + INSERT (`WITH l AS (SELECT ... FOR NO KEY UPDATE) INSERT ...`). Rejected because under RC the snapshot predates the lock grant, and EvalPlanQual does not re-check the NOT EXISTS subquery, so the race persists.
- `R-2` Upsert in `mergeSignalExpirySQL` (fixing it on the add path). Rejected because it CHANGEs @AC-9, @AC-17 and the contract that an untracked entry stays untracked, and it touches `watchlist_repo.go`, which feature 354 is editing.
- `R-3` SERIALIZABLE APPLY, or a backfill-only advisory lock. Rejected because SSI also needs AddSymbols at SERIALIZABLE, and an advisory lock needs an add-path edit. Both are worse than the documented parent-row lock.
- `R-4` Locking via the `touchWatchlistTx` UPDATE. Rejected because it bumps `updated_at`, a user-visible side effect that buys nothing.
- `R-5` Pre-authorizing a relaxed GREEN assertion ("absent OR signal_id==sigID") in the forced-interleave tests. Rejected because the NOT EXISTS re-evaluation risk is not real (after the wait, ON CONFLICT re-checks only the unique index), and loosening the assertion in place weakens the C-15 RED/GREEN proof.
- `R-6` A production `lock_timeout` on backfill APPLY. Rejected under YAGNI: AddSymbols transactions are short, production has no `lock_timeout` precedent, and the one-shot job is operator-interruptible.
- `R-7` Config key `portfolio.watchlist.backfill_mark_grace_hours` (with a seed migration and a SCALAR_BOUNDS entry). Rejected because the value does not vary by environment, the one-shot CLI has no config client, and it contradicts both the Fix Scope and the operator's fixed acceptance value.
- `R-8` Grace via `interval '3 days'` or via a `$3` bind parameter. Rejected because `'3 days'` on timestamptz depends on DST and diverges from the 72h test literal, and `$3` breaks the shared `(wlID, sym)` argument list at `:167`.
- `R-9` A pre-boundary step in the @AC-3 test ("age to 1 minute before, prune still empty"). Rejected because it re-tests the 281 prune comparator rather than the grace and adds a timing assumption. The DB-written bound already proves the grace.

## Open Risks

- [ ] **`:443` can no longer catch a lock-fix regression (O-11).** After FR-3, a mark that lost the race is no longer due, so only the D-9 strict-equality forced-interleave tests guard @AC-1. To be addressed at /sdd-spec (the spec lists both tests as must-not-weaken, with the same status as `:443` under D-6) and at Step 1.
- [ ] **Operational window change.** Untracked marks now reach prune 72h after APPLY instead of on the next tick. The runbook §9 emergency-stop window and the §11 monitoring advice must change with it, or an operator who watches only the next tick will miss the removals. To be addressed at Step 2 (docs).
- [ ] **`:443`'s 500ms `lock_timeout` (accepted residual).** The frozen `:443` test runs with a 500ms `lock_timeout` and now waits milliseconds on the watchlist-row lock. If CI reports 55P03 under `-race` load, investigate the runner and never edit the test. To be addressed at Step 1 (execute verification).
- [ ] **Cluster-wide gate predicates.** The `pg_stat_activity` gate predicates count lock waiters across the whole cluster. This is accepted because the tests run sequentially and the branch assertion comes last. To be addressed at Step 1.
- [ ] **Still to prove at execute:**
  - that the forced interleave is deterministic in both RED and GREEN;
  - that the speculative-insert wait shows up as `wait_event_type='Lock'`;
  - that `insertBindingsTx` does not wait on an existing binding.

  To be addressed at Step 1 (the RED run on current code, then GREEN).
- [ ] **No `lock_timeout` on APPLY.** A wedged add-path transaction pauses the one-shot job. This is accepted under YAGNI (R-6) because the job is operator-interruptible. To be addressed in the Step 2 runbook (operator note).

## Constitution Rules Touched

- `C-08`: honored. `:443` stays byte-identical, `:349` and `:252-295` are must-still-pass, and the forced-interleave tests are raised to must-not-weaken (O-11).
- `C-11`: honored. This is a full 3-round debate with the operator gate and a design-phase ledger touch (no reusable lesson qualified this time; see context.md).
- `C-15`: honored. Deterministic RED/GREEN forced-interleave tests with strict equality cover @AC-1 and @AC-2. The @AC-3 bound is read from the DB-written value. @AC-1/FR-1 were amended so the scenario text fails on the defect (O-10).
- `C-16`: honored. The single CHANGE (281 @AC-16) is signed off by the operator decision of 2026-11-17 and tagged `@feature-359` in the durable suite.
- `C-18`: honored. There is one single-caller helper, `runForcedInterleave` takes no function hooks, and the @AC-3 test rewrites the existing `TestBackfill_StrictUntrackedRemoval` instead of adding a near-duplicate twin.
- `P-02`: honored. Proposer and adversary output was mediated through synthesized state only.
- `P-03`: honored. Every error surface is explicit (rollback defer, ABORTED path), and nothing was invented. Unverified items are listed as Open Risks.
- `P-06`: honored. The test pools are pinned (O-1), and the tests are sequential and deterministic.
- `F-01`: honored. There is no hardcoded environment-specific value; the 72h grace is the same in every environment and fixed by the operator.
- `F-06`: honored. No migration, proto or config surface is touched.
- `F-07`: honored. `backfillMarkGrace` is a named constant, not a config key, for the reasons in D-12, which are recorded in context.md.
- `PORTFOLIO-18`: honored. The prune still never waits; it `SKIP LOCKED`s a list held by APPLY for one tick. The lock-order invariant and the grace note are added next to it.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1` "A signal added during backfill APPLY keeps its watchlist entry out of the prune set" (`docs/roadmap/features/359-fix-portfolio-signal-expiry-backfill/acceptance.feature`). It is guarded by the strict-equality forced-interleave test. Its Then clause was amended by operator sign-off 2026-11-17 (round-3 gate, commit `96fad930`; context.md OPERATOR DECISIONS).
- EXTEND `@AC-2` "A signal added during a seed APPLY leaves the entry tracked by the new signal". The seed path was added to scope by operator decision 2026-11-17 (FR-2). It is covered by `TestBackfill_SeedIngestInterleavingRescued`.
- EXTEND `@AC-3` "A backfill untracked mark gets a 3-day grace before pruning". This is FR-3, by operator decision 2026-11-17, covered by the rewritten `TestBackfill_StrictUntrackedRemoval`.
- CHANGE `@AC-16 @feature-281` "Strict untracked removal, including the accepted pre-224 legacy-owner case" (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature:127-136`). Removal moves from "next prune tick" to "first tick after APPLY + 72h". Signed off by the operator @ 2026-11-17 (design-gate steer, FR-3 / @AC-3, which also sanctions the change to runbook §8 "no grace period"; context.md OPERATOR DECISIONS). The edit is tagged `@feature-359`.
- PRESERVE `@AC-17 @feature-281` "A marked entry is rescued by a live signal before the next tick" (same file, `:139`). It is not regressed, because `mergeSignalExpirySQL` still overwrites a `signal_id IS NULL` row (`watchlist_repo.go:294-295`) and `TestBackfill_MarkedEntryRescued` passes unedited. Its title is reworded to "...before it is pruned" with no change to the guarantee.
- PRESERVE `@AC-9 @feature-281` "A SIGNAL add without dated provenance untracks the entry". It is not regressed, because `applyExpiryIntentTx` and `watchlist_repo.go` are untouched (R-2 rejected).
- PRESERVE `@AC-12 @feature-281` "The prune never waits on a concurrent rebind". It is not regressed, because the prune keeps `SKIP LOCKED`, and a list held by APPLY is skipped for one tick.
- PRESERVE `@AC-15 @feature-281` "Backfill seeds expiry for existing entries from the owner's signal rows". It is not regressed, because `backfillSeedSQL` is byte-identical and runs inside the locked transaction with the same output.
- PRESERVE the remaining suites listed in recon.md:78-98 (@AC-13 event kind, @AC-8, @AC-18, core prune semantics, features 170/282/127/167). None of their surfaces is touched.

## Rounds

- **Round 1:** +6 decisions, +4 rejected, +7 objections. The lock fix site and lock form were settled, and the seed path was brought into scope.
- **Round 2:** +4 decisions, +2 rejected, 6 objections closed, +2 opened. Covered the helper shape, pinned pools, the strict GREEN assertion and the doc set.
- **Round 3:** +4 decisions, +3 rejected, 3 objections closed, +2 opened, 1 petition. FR-3 was folded in as a named constant, along with the @AC-3 test design and the FR-3 doc set.
- **Termination:** approved. The operator approved at the round-3 gate with the Floor clear.
  - Blocking O-10 was resolved by the operator's amendment of @AC-1/FR-1 (commit `96fad930`).
  - Petition P-1 (REOPEN D-1) was declined, because the operator approved instead of reopening. D-11 records the superseded-in-part clause under the operator's FR-3 decision.
  - Non-blocking O-11 is carried forward to /sdd-spec as an Open Risk.
