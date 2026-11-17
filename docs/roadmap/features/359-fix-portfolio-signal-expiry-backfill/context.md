# Context Log: fix-portfolio-signal-expiry-backfill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md` (PR #1570; Issues disabled).
- Severity: SEV-3, confirmed by the operator at the `/sdd-qa defect` P-04 gate (lowered from the initially proposed rating).
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md.
- Affected services (from report): xstockstrat-portfolio.
- Root cause hypothesis: the backfill APPLY mark (`backfillMarkSQL`) runs as a READ COMMITTED autocommit statement without the parent watchlist row lock. The add path's update-only `mergeSignalExpirySQL` is a no-op when it runs before the mark row commits, so a due `signal_id NULL` row survives next to a live signal. The same shape is suspected, not observed, for `backfillSeedSQL`.
- Recommended design depth: skip → `/sdd-spec fix-portfolio-signal-expiry-backfill` (rubric: SEV-3, single service, no proto/migration/config, clear root cause).
- **Operator directive (2026-11-17), overrides the rubric:** run this fix through the `/sdd-batch` workflow, which always runs the full design debate. The design gate is `halt` (operator approves design.md), then `/sdd-batch-execute` (sequential) after the operator's mode-entry confirmation.
- Development branch: feature/fix-portfolio-signal-expiry-backfill.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Warnings:
  - Criterion 9 (Open Questions): the items were plain bullets. Resolved here by converting them to unchecked `- [ ]` boxes. All remain deferred to `/sdd-design`, and design must resolve each one. If the seed-path race is confirmed, add FR-2 and an append-only `@AC-2`.
  - Criterion 8 (C-15): `@AC-1` "runs concurrently" is intermittent on the buggy code. Design must supply a forced-interleaving hook so the regression fails deterministically before the fix.
  - Criterion 8 wording: Given/When use only "META" and a relative "valid_until 30 days ahead". Both are acceptable; a reviewer may want the REPORT bounds stated.
  - Criterion 11 (C-14): "None — internal/platform-only" is justified. Minor clarity gap: the spec does not say whether `portfolio.watchlist.signal_entry_removed_untracked` is the only operator-visible signal.
  - Runbook §7 "changed since REPORT" wording (`docs/runbooks/signal-watchlist-expiry-backfill.md:152-153`): whether it needs an update is deferred to design/spec.
- Overlap findings (WARN, no FAIL):
  - [file] `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go`: this feature's likely fix sites (`mergeSignalExpirySQL` `:293`, `applyExpiryIntentTx` `:545-576`) vs feature 354 `ListByUser` (`:107-141`). Disjoint regions, rebase-only. If design moves the fix into `ListByUser` or the constructor, add a soft merge-order row (354 first, 359 rebases).
  - [file] `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go`: 354 adds `seedNamedWatchlist` and turns `seedWatchlist` into a delegate. Collides only if 359 edits this helper file. Conditional, low risk.
  - No config-key, proto field-number or migration collision. No merge-order entry required now.
- Recommended design depth: full (operator directive; the rubric would give quick for a single-service SEV-3 bug with no proto/DB/config gates).

### OPERATOR DECISIONS (binding, recorded 2026-11-17)

- Operator directive 2026-11-17: run through /sdd-batch with a full design debate (overrides the triage rubric's 'skip'); the design gate halts for operator approval.
- Severity is SEV-3 (operator-confirmed at the /sdd-qa P-04 gate); production exposure is limited to a one-shot backfill APPLY overlapping signal ingest.
- Fix the race without weakening or skipping TestBackfill_IngestRaceNeverLeavesEntryRemovable; it is the regression guard for @AC-1.

## Session 2026-11-17 — sdd-batch design gate (round 2)

`/sdd-design fix-portfolio-signal-expiry-backfill` (full) halted at its approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md is unchanged (still `spec-ready`). The register is in `debate.md` (State in-debate, Rounds run 2: D-1..D-10, R-1..R-6, O-1..O-9).

## Open Threads

- **Approach (agreed by proposer and adversary; adversary verdict SOUND):**
  - The fix is only in the backfill APPLY loop (D-1). `watchlist_repo.go`, `backfillSeedSQL` and `backfillMarkSQL` stay unchanged.
  - At `signal_expiry_backfill.go:167`, the autocommit `pool.Exec` becomes a call to `applyBackfillRow`, a new single-caller helper that returns `(pgconn.CommandTag, error)`. Each call runs one short READ COMMITTED tx:
    1. A separate `SELECT 1 FROM portfolio.watchlists WHERE watchlist_id=$1 FOR NO KEY UPDATE` Exec (D-2).
    2. The unchanged INSERT.
    3. Commit.
  - The helper uses the package rollback idiom `defer func() { _ = tx.Rollback(ctx) }()` (D-7).
  - `:168-183` (the ABORTED path and the outcome switch) stays byte-identical (D-3).
  - Two new forced-interleave dbtests use pinned pools and a two-branch gate, with STRICT GREEN equality (D-8, D-9):
    - `TestBackfill_MarkIngestInterleavingRescued` (@AC-1)
    - `TestBackfill_SeedIngestInterleavingRescued` (@AC-2)
  - `:443` stays byte-identical, and `:349` is a must-still-pass guard (D-6).
  - Doc edits (D-10):
    - Runbook `:66-67` and §7 `:150-153`, plus a sentence that a row reported 'changed since REPORT' stays untracked until REPORT and APPLY are re-run.
    - A merged 2-line comment at `:99-100` and a fix at `:123-124`.
    - A lock-order invariant line next to PORTFOLIO-18.
  - No proto, migration or config changes.
- **Strongest open objection (blocking): O-3 [C-15].** The seed-RED test design is pinned. The FR-2 / `@AC-2` append to `product-spec.md` and `acceptance.feature` is still drafted text only, and it must land before the operator approves the design gate.
  - Non-blocking, for spec to pin:
    - O-8: the lock-order invariant in the portfolio context-constitution is a mandatory doc step.
    - O-9: the C-18 narrow test-helper signature is `(class, prior-signal setup) → (sigID, until, branch)`, with no function hooks.
- **Floor status:** no breaches.
- **Uncovered @AC changes (not covered by an operator decision):**
  - EXTEND: `@AC-2` and `281 @AC-17`.
  - PRESERVE: `281 @AC-9`, `@AC-12`, `@AC-15` and `@AC-16`.
  - `@AC-1` PRESERVE is covered by the 2026-11-17 operator decision.
- **Accepted residual risks:**
  - The frozen `:443` test has a 500ms lock_timeout exposure under `-race`. If it shows up, investigate CI load and never edit the test.
  - The cluster-wide `pg_stat_activity` gate predicates are a known limitation.
  - RED/GREEN determinism and the `wait_event_type='Lock'` assumption must be proven at execute.
  - APPLY has no production lock_timeout (YAGNI, R-6).
  - Whether `insertBindingsTx` behaves as assumed on an existing binding must be confirmed at execute.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The fix stays in the backfill APPLY loop only (D-1). watchlist_repo.go and backfillSeedSQL/backfillMarkSQL (signal_expiry_backfill.go:101-121) are not changed.\n\nSERVICE CHANGE (services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go)\n- At :167, replace `tag, err := pool.Exec(ctx, stmt, c.watchlistID, c.symbol)` with `tag, err := applyBackfillRow(ctx, pool, stmt, c.watchlistID, c.symbol)`. Lines :168-183 (the ABORTED path and the outcome switch) stay byte-identical (D-3).\n- applyBackfillRow is a new unexported helper with one caller. It returns (pgconn.CommandTag, error). Steps:\n  1. tx, err := pool.Begin(ctx) at the default READ COMMITTED level.\n  2. `defer func() { _ = tx.Rollback(ctx) }()`. This is the package idiom, as at :207, signal_expiry_repo.go:66 and watchlist_repo.go:43. Do not use the bare test-file defer. The defer lives only in the helper, never in the :157 loop.\n  3. `_, err = tx.Exec(ctx, backfillLockSQL, wlID)`, where backfillLockSQL = `SELECT 1 FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE`. This is the signal_expiry_repo.go:70 form without SKIP LOCKED, run as its own statement (D-2).\n  4. `tag, err := tx.Exec(ctx, stmt, wlID, sym)`.\n  5. tx.Commit(ctx).\n  Any error returns err and goes through the unchanged ABORTED path. A deleted watchlist locks 0 rows, then the INSERT writes 0 rows, which maps to 'changed since REPORT'.\n- Comments, 2-line cap:\n  - At :99-100, merge rather than replace. Keep the zero-rows-means-changed rule and add the constraint: \"APPLY runs each row as a parent-row lock then this INSERT in one RC tx; the lock must be its own statement so the INSERT snapshot follows any AddSymbols that held the row.\"\n  - At :123-124, replace \"autocommit row\" with \"one short locked tx per row\".\n\nTESTS (signal_expiry_backfill_dbtest_test.go)\n- Add TestBackfill_MarkIngestInterleavingRescued (@AC-1) and TestBackfill_SeedIngestInterleavingRescued (@AC-2).\n- They share one narrow unexported test helper (C-18):\n  - It takes only the class and the prior-signal setup, with no function-valued hooks.\n  - It returns (sigID, until, branch).\n  - The assertions stay in each test body.\n- Pools:\n  - pool := testPool(t) (500ms) for seed, poll, mustPrune and asserts.\n  - applyPool with no lock_timeout, built exactly as at :351-356.\n  - addPool := testPool(t, func(c *pgxpool.Config){ c.ConnConfig.RuntimeParams[\"lock_timeout\"] = \"10s\" }). Precedent: watchlist_ensure_dbtest_test.go:20.\n  - repo := NewWatchlistRepo(addPool).\n- Choreography:\n  1. Seed the system list and the META SIGNAL binding. The seed test also seeds the owner's own signal with a past valid_until. Run backfillReport and assert the class count (seedExpired==1 in the seed test).\n  2. A side tx on pool INSERTs an uncommitted expiry row (wlID,'META',now()+1d,NULL) and holds it. Its FK takes FOR KEY SHARE, which is compatible with FOR NO KEY UPDATE.\n  3. Run backfillApply(applyPool,…) in a goroutine. Poll with the exact :400-403 predicate. Abort if done fires first.\n  4. Autocommit the live signal (as at :475-478), keeping sigID and until. Start repo.AddSymbols(ctx, wlID, addBinding(\"META\", srcSignal), provenanceIntent(\"META\", sigID, until)) in a goroutine with addDone.\n  5. Gate on a 10s deadline with a 20ms poll, with exactly two branches:\n     - branch=\"returned\" if addDone fired.\n     - branch=\"blocked\" if `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE portfolio.watchlists SET updated_at%' AND pid <> pg_backend_pid()` > 0. Form from signal_expiry_prune_dbtest_test.go:439.\n  6. side.Rollback, then join both goroutines. Neither may return an error.\n  7. Assert behaviour first:\n     - The expiry row exists with signal_id == sigID and valid_until == until, which is in the future. This is STRICT equality, with no pre-authorized relaxation.\n     - mustPrune(NewWatchlistRepo(pool), wlID) is empty.\n     - assertSource(srcSignal).\n     Only then assert branch==\"blocked\".\n- Expected results:\n  - Buggy code: AddSymbols returns. Its UPDATE-only merge (watchlist_repo.go:293-296) misses the uncommitted row. After the rollback the parked INSERT commits a due row (mark test) or a past-dated row with the old signal id (seed test). Both tests are RED.\n  - Fixed code: AddSymbols parks in touchWatchlistTx (watchlist_repo.go:505) until the backfill commits. Its later merge statement then rescues the row to sigID/until. Both tests are GREEN.\n- Guards:\n  - :443 TestBackfill_IngestRaceNeverLeavesEntryRemovable stays byte-identical (D-6).\n  - :349 TestBackfill_IngestInterleavingSkipsChanged is a named must-still-pass guard.\n- If GREEN ever diverges at execute, escalate to the register. Do not loosen the assertion in place.\n\nDOCS AND ARTIFACTS\n- docs/runbooks/signal-watchlist-expiry-backfill.md:\n  - :66-67: \"APPLY is one short explicit transaction per row (lock the watchlist row, then INSERT), so both still fit the transaction pool with DB_PGBOUNCER=true.\"\n  - §7 :150-153: replace \"one autocommit INSERT … per row\" with \"one short transaction per row: lock the watchlist row, then INSERT … ON CONFLICT DO NOTHING\".\n  - Add: a row reported 'changed since REPORT' because AddSymbols took the lock first is left with no expiry row (open-ended) until REPORT and APPLY are re-run.\n- services/xstockstrat-portfolio/docs/context-constitution.md: add one row or line next to PORTFOLIO-18 recording the lock-order invariant. Every writer of portfolio.watchlist_signal_expiry takes the parent portfolio.watchlists row lock first: AddSymbols, Remove/Update, the prune, and now backfill APPLY.\n- Before design approval, append FR-2 to product-spec.md and @AC-2 to acceptance.feature (append-only): \"a signal added during a seed APPLY leaves the entry tracked by the new signal, never by the owner's expired one\".\n\nTouchpoints: no proto, migration or config changes.",
    "open_objections": [
      {
        "text": "[C-15] O-3 (remaining part): the seed-RED test design is now pinned (past-dated prior signal, strict signal_id and valid_until equality, REPORT seedExpired==1). The FR-2 / @AC-2 append to product-spec.md and acceptance.feature is still drafted text only. It must land in the feature artifacts before the design gate approves.",
        "blocking": true
      },
      {
        "text": "[PORTFOLIO constitution] Record the lock-order invariant in services/xstockstrat-portfolio/docs/context-constitution.md next to PORTFOLIO-18: every expiry-row writer takes the parent watchlists row lock first, and APPLY is now one of them. A future writer that touches expiry rows before the parent lock deadlocks against APPLY. Spec must include this as a mandatory doc step, not an optional one.",
        "blocking": false
      },
      {
        "text": "[C-18] The shared forced-interleave test helper must stay narrow. It takes only what differs between the tests (class and prior-signal setup), takes no function-valued hooks, and returns (sigID, until, branch). Assertions stay in each test body. Spec must pin this signature.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "281 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "281 @AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-16",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Single-statement CTE lock + INSERT (R-1): under READ COMMITTED the snapshot predates the lock grant, and EvalPlanQual does not re-check NOT EXISTS.",
      "Upsert in mergeSignalExpirySQL (R-2): it changes @AC-9 and @AC-17 and touches watchlist_repo.go, which feature 354 is editing.",
      "SERIALIZABLE APPLY or a backfill-only advisory lock (R-3): both need the add path changed too.",
      "Locking via the touchWatchlistTx UPDATE (R-4): it bumps updated_at, a user-visible side effect.",
      "Pre-authorizing a relaxed GREEN assertion ('absent OR signal_id == sigID') if execute diverges: after the speculative-insert wait, ON CONFLICT re-checks only the unique index, not the SELECT/NOT EXISTS, so the risk is not real. The :349 test depends on the same behaviour. Strict equality stays; any divergence escalates to the register.",
      "Bare `defer tx.Rollback(ctx)` copied from the test file (:369): production code in this package uses `defer func() { _ = tx.Rollback(ctx) }()` (:207), and a bare call risks errcheck lint.",
      "Replacing the :99-100 comment wholesale: the zero-rows-means-changed rule is still a real constraint, so merge it with the lock constraint within 2 lines.",
      "A production lock_timeout on APPLY: YAGNI. AddSymbols transactions are short, there is no production lock_timeout precedent, and the operator can interrupt the one-shot job (backfill.go:51).",
      "A datname or watchlist filter on the pg_stat_activity gate predicates: speculative. The package's tests run sequentially and the branch assertion runs after the behaviour assertions."
    ],
    "open_risks": [
      "Accepted residual risk in the frozen :443 test. It runs both sides on testPool with a 500ms lock_timeout. After the fix, one side now waits milliseconds on the other's watchlist-row tx. Under -race on a loaded CI runner, a wait over 500ms would surface as 55P03 at :486-488. If that happens, investigate CI load; never edit the test (operator decision, D-6).",
      "The gate predicates count lock waiters cluster-wide (inherited from :400-403 and signal_expiry_prune_dbtest_test.go:439). 'UPDATE portfolio.watchlists SET updated_at%' would also match a concurrent prune UPDATE (signal_expiry_repo.go:137) or a prune-test fixture running at the same time. Accepted because the tests run sequentially and the branch assertion comes last; the spec records it as a known limitation.",
      "RED/GREEN determinism of the forced interleave still needs proving at execute, as does the assumption that the speculative-insert wait shows as wait_event_type='Lock'. The latter rests on the :400-403 precedent.",
      "APPLY has no lock_timeout, so a wedged add-path tx pauses the one-shot operator job. Accepted under YAGNI; the job is operator-visible and interruptible.",
      "Unverified assumption: insertBindingsTx neither errors nor waits on an existing binding in the forced-interleave tests. The :481 guard exercises that path; execute must confirm it."
    ],
    "constitution_rules_touched": [
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-03",
      "P-06",
      "F-01",
      "F-06",
      "F-07",
      "PORTFOLIO-18"
    ],
    "rationale": "The proposer and the adversary agree on the round-1 design (D-1 to D-6). The adversary's verdict is SOUND with no floor breaches, and no R-n is reintroduced: the lock is a separate Exec, watchlist_repo.go is untouched, and it uses SELECT FOR NO KEY UPDATE, not the touch UPDATE.\n\nI checked the cited lines in the worktree:\n- :167 is the autocommit pool.Exec, and :168-183 are the ABORTED path and the outcome switch.\n- :207 uses the `_ = tx.Rollback` idiom.\n- :99-100 carries the zero-rows rule that must be preserved.\n- :123-124 says \"autocommit row\".\n- Runbook :66-67 also says \"one autocommit statement per row\" and :150-153 says \"one autocommit INSERT\".\n- PORTFOLIO-18 is at context-constitution.md:30.\n\nI folded the adversary's concrete corrections into the approach:\n- the package rollback idiom\n- the second runbook site\n- the merged comment\n- strict GREEN equality\n- the mandatory constitution line\n- a narrow test helper\n\nWith those in, O-1, O-2, O-4, O-5, O-6 and O-7 are concretely answered.\n\nO-3 stays open as blocking only for the outstanding FR-2/@AC-2 artifact append. That append must exist before the operator design gate.\n\nThe :443 lock_timeout exposure is recorded as accepted residual risk rather than an objection, because the operator decision forbids editing that test and the wait is milliseconds.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "applyBackfillRow is the single-caller helper. It returns (pgconn.CommandTag, error), so signal_expiry_backfill.go:168-183 stays byte-identical, and it uses the package rollback idiom `defer func() { _ = tx.Rollback(ctx) }()` inside the helper only.",
          "evidence": "signal_expiry_backfill.go:167-183, :207; signal_expiry_repo.go:66; watchlist_repo.go:43"
        },
        {
          "text": "The forced-interleave tests pin their pools. APPLY uses a pool with no lock_timeout (as at :351-356). AddSymbols uses NewWatchlistRepo over testPool with lock_timeout=10s. The gate is two-branch: addDone returned, or a Lock waiter with query LIKE 'UPDATE portfolio.watchlists SET updated_at%'. Behaviour assertions run before the branch=='blocked' assertion.",
          "evidence": "watchlist_ensure_dbtest_test.go:20; dbtest_helpers_test.go:35; signal_expiry_prune_dbtest_test.go:439; watchlist_repo.go:505"
        },
        {
          "text": "The GREEN assertion is strict equality (signal_id==sigID, valid_until==until, in the future), with no pre-authorized relaxation. Any divergence at execute escalates to the register.",
          "evidence": "ON CONFLICT re-checks only the unique index after the speculative-insert wait; the :349 precedent at :419-430 relies on the same behaviour"
        },
        {
          "text": "The doc edits cover runbook :66-67 and §7 :150-153, a merged 2-line comment at signal_expiry_backfill.go:99-100 that keeps the zero-rows rule, a correction at :123-124, and a lock-order invariant line next to PORTFOLIO-18 in the portfolio context-constitution.",
          "evidence": "docs/runbooks/signal-watchlist-expiry-backfill.md:66-67,:150-153; signal_expiry_backfill.go:99-100,:123-124; services/xstockstrat-portfolio/docs/context-constitution.md:30"
        }
      ],
      "new_rejected": [
        {
          "text": "Pre-authorizing a relaxed GREEN assertion ('absent OR signal_id==sigID') in the forced-interleave tests",
          "why": "The NOT EXISTS re-evaluation risk is not real (ON CONFLICT re-checks only the unique index after the wait), and loosening in place weakens the C-15 RED/GREEN proof"
        },
        {
          "text": "A production lock_timeout on backfill APPLY",
          "why": "YAGNI: AddSymbols transactions are short, there is no production lock_timeout precedent, and the one-shot job is operator-interruptible"
        }
      ],
      "new_objections": [
        {
          "text": "[PORTFOLIO constitution] Add the lock-order invariant (every watchlist_signal_expiry writer takes the parent watchlists row lock first, and APPLY is now one of them) next to PORTFOLIO-18 as a mandatory spec step.",
          "blocking": false
        },
        {
          "text": "[C-18] The shared forced-interleave test helper takes only the class and the prior-signal setup, takes no function hooks, returns (sigID, until, branch), and leaves assertions in each test body.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Pools pinned: applyPool with no lock_timeout (as at :351-356), addPool = testPool with a 10s lock_timeout override (as at watchlist_ensure_dbtest_test.go:20), and the 500ms testPool for seed, poll and asserts"
        },
        {
          "id": "O-2",
          "how": "Exact two-branch gate pinned (addDone, or the 'UPDATE portfolio.watchlists SET updated_at%' Lock waiter), which cannot match the INSERT waiter; branch=='blocked' is asserted after the behaviour assertions"
        },
        {
          "id": "O-4",
          "how": "Lock via Exec (a deleted list gives 0 rows, then 'changed since REPORT'); `_ = tx.Rollback` defer in the helper per :207; begin, lock, insert and commit errors all go through the unchanged ABORTED path"
        },
        {
          "id": "O-5",
          "how": "One single-caller helper returning (CommandTag, error); the defer lives only in the helper, never in the :157 loop"
        },
        {
          "id": "O-6",
          "how": "The runbook gains the 'changed since REPORT stays untracked until REPORT and APPLY are re-run' sentence, and both autocommit claims (:66-67 and :150-153) are reworded"
        },
        {
          "id": "O-7",
          "how": ":349 TestBackfill_IngestInterleavingSkipsChanged is a named must-still-pass guard in the approach"
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
