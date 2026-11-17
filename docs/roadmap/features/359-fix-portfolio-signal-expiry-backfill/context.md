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

## Session 2026-11-17 — sdd-batch design gate (round 3)

`/sdd-design fix-portfolio-signal-expiry-backfill` (full) halted at its approval gate after round 3 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md is unchanged (still `spec-ready`). The register is in `debate.md` (State in-debate, Rounds run 3: D-1..D-14, R-1..R-9, O-1..O-11, P-1).

## Open Threads

- **Approach (lock fix from D-1..D-10 unchanged; FR-3 added on top as an operator-sanctioned mark-SQL edit):**
  - Lock fix: at `signal_expiry_backfill.go:167`, `applyBackfillRow` runs one short READ COMMITTED tx per candidate: a separate `SELECT 1 FROM portfolio.watchlists WHERE watchlist_id=$1 FOR NO KEY UPDATE` Exec, then the unchanged INSERT, then Commit. `:168-183` stays byte-identical.
  - FR-3 (D-11): `backfillMarkSQL` selects `now() + backfillMarkGrace` at `:116`, where `backfillMarkGrace` is an unexported Go string constant `interval '72 hours'`, concatenated like `ownWatchlistSignals` (D-12). `backfillSeedSQL` and `watchlist_repo.go` are untouched.
  - **F-07 reasoning (recorded so /sdd-review does not re-flag it):** the grace is not a config key because `docs/patterns/config-governance.md:7` scopes the hardcoding ban to env-specific values, and this value is the same in every environment and fixed by the operator; the backfill CLI has no config client (`cmd/server/backfill.go:29-61`); and the product-spec Fix Scope says "No config key changes".
  - Tests: the two forced-interleave dbtests (`TestBackfill_MarkIngestInterleavingRescued` @AC-1, `TestBackfill_SeedIngestInterleavingRescued` @AC-2) use the shared helper `runForcedInterleave(t, class, priorSignalAge time.Duration) (sigID, until, branch)` with strict-equality GREEN assertions. The @AC-3 test rewrites the removal tail of `TestBackfill_StrictUntrackedRemoval` (`:216-250`), retagged AC-16+AC-3: it checks valid_until in `[t0+72h, t1+72h]` and an empty prune right after APPLY, then backdates past the boundary and asserts the untracked prune (D-13).
  - Must-still-pass guards with no edits: `:443` (byte-identical), `:349`, `:252-295` (@AC-17).
  - Docs (D-10, D-14): runbook `:27`, `:66-67`, §7, §8 retitle, §9 emergency window, §11; the `docs/runbooks/CLAUDE.md` backfill row; durable @AC-16 CHANGE tagged `@feature-359` plus @AC-17 retitle in the same commit; the lock-order invariant and grace note next to PORTFOLIO-18; the portfolio CLAUDE.md Database bullet.
  - Build order: Step 1 RED forced-interleave tests, then the lock fix. Step 2 the @AC-3 test rewrite (RED on `now()`), then the one-token SQL change, then docs. No proto, migration, config key or new service.
- **Strongest open objection (blocking): O-10 [C-15/C-16].** After FR-3, a mark that lost the race is `now()+72h` / `signal_id NULL`. It passes every Then clause of 359's own @AC-1 and the FR-1 text ("absent or has a valid_until in the future"; "a prune tick removes nothing"), yet at APPLY+72h it is pruned while the 30-day signal is still live. Only the D-9 strict-equality test assertion still catches the defect. Before approval, the operator must either (a) sign off on amending @AC-1 Then and FR-1 to "absent or tracked by the live signal (its signal_id and valid_until)" plus "a prune tick run after 3 days removes nothing", or (b) record a written waiver that the test assertion, not the scenario text, carries the @AC-1 guarantee.
  - Non-blocking: O-11 [C-08]. The frozen `:443` guard is blind to @AC-1 after FR-3. This is a design-gate line item, and spec must list the two forced-interleave tests as must-not-weaken, with the same status as `:443` under D-6.
  - Pending operator: P-1 asks the operator to confirm D-1 as superseded-in-part by the FR-3 decision. D-1's lock-fix scope stands.
- **Closed this round:** O-3 (FR-2/@AC-2 and FR-3/@AC-3 are on the feature branch), O-8 (lock-order invariant is a mandatory spec doc step), O-9 (helper signature pinned).
- **Floor status:** no breaches.
- **Uncovered @AC changes (not covered by an operator decision):** PRESERVE only: `281 @AC-17`, `281 @AC-9`, `@AC-12`, `@AC-15`. All changes (@AC-1 PRESERVE, @AC-2 and @AC-3 EXTEND, `281 @AC-16` CHANGE) are covered by the 2026-11-17 operator decision.
- **Open risks:**
  - After FR-3, `:443` can no longer detect a lock-fix regression; only the D-9 strict-equality tests guard @AC-1.
  - Untracked marks now reach prune 72h after APPLY, not on the next tick. Runbook §9 and §11 must change with it.
  - Accepted residuals carried over: the `:443` 500ms lock_timeout under `-race`, the cluster-wide `pg_stat_activity` gate predicates, RED/GREEN determinism to prove at execute, and no production lock_timeout on APPLY (R-6).

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The lock fix from D-1..D-10 is unchanged. FR-3 is added on top of it as an operator-sanctioned edit to the mark SQL only.\n\nSERVICE (services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go)\n1. Lock fix (as settled).\n   - At :167, call applyBackfillRow(ctx, pool, stmt, c.watchlistID, c.symbol). It returns (pgconn.CommandTag, error).\n   - Inside the helper: Begin at READ COMMITTED; defer func() { _ = tx.Rollback(ctx) }(); Exec backfillLockSQL = SELECT 1 FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE as its own statement; Exec the unchanged stmt with (wlID, sym); Commit.\n   - Lines :168-183 stay byte-identical. Begin, lock, insert and commit errors take the existing ABORTED path. Zero rows means 'changed since REPORT'.\n2. FR-3 (D-11, operator decision 2026-11-17).\n   - In backfillMarkSQL, the select list at :116 changes from now() to now() + backfillMarkGrace.\n   - backfillMarkGrace is a new unexported Go string constant: interval '72 hours'. It is concatenated the same way ownWatchlistSignals already is (:107, :120).\n   - backfillSeedSQL (:101-112) stays byte-identical, so seeds keep the owner's signal valid_until. watchlist_repo.go is untouched.\n   - now() is the per-candidate transaction start, so the grace is anchored to that row's APPLY write.\n   - There is no config key, migration or SetConfig bound (D-12). The F-07 reasoning goes into context.md so /sdd-review does not re-flag it:\n     - config-governance.md:7 scopes the rule to env-specific values. This grace is the same in every environment and was fixed by the operator.\n     - The backfill CLI has no config client (cmd/server/backfill.go:29-61).\n     - The product-spec Fix Scope says 'No config key changes'.\n3. Comments (2-line cap): use the merged comment at :99-100 per D-10. At :123-124, change 'autocommit row' to 'one short locked tx per row'.\n\nTESTS (internal/repository/signal_expiry_backfill_dbtest_test.go)\n@AC-1 and @AC-2 forced-interleave tests (D-8/D-9, unchanged):\n- TestBackfill_MarkIngestInterleavingRescued and TestBackfill_SeedIngestInterleavingRescued.\n- Shared helper: runForcedInterleave(t, class, priorSignalAge time.Duration) (sigID int64, until time.Time, branch string).\n  - priorSignalAge == 0 means no prior signal. The seed test passes a past age.\n  - The helper takes no function-valued parameters. All assertions stay in each test body.\n- Pools: the 500ms testPool, an applyPool with no lock_timeout (as at :351-356), and an addPool with lock_timeout=10s.\n- Two-branch gate: addDone, or a Lock waiter whose query is LIKE 'UPDATE portfolio.watchlists SET updated_at%'.\n- Assertions, in order:\n  1. Strict equality: signal_id == sigID and valid_until == until, in the future.\n  2. mustPrune is empty.\n  3. assertSource(srcSignal).\n  4. Then branch == 'blocked'.\n- These tests are now the only lock-fix guard (see the :443 risk). Spec lists them as must-not-weaken, with the same status as :443 under D-6.\n\n@AC-3 (CHANGE of 281 @AC-16): rewrite the removal tail of TestBackfill_StrictUntrackedRemoval (:216-250) and retag it AC-16+AC-3.\n- The REPORT and refusal half (:226-236) is kept.\n- t0 := dbNow(pool) before APPLY; t1 after it.\n- rec := dueRow(...). Assert rec.SignalID == nil, !rec.ValidUntil.Before(t0.Add(72*time.Hour)) and !rec.ValidUntil.After(t1.Add(72*time.Hour)).\n  - The literal 72h reads the value the DB wrote. This is not the constant-vs-constant tautology in fails.md:1902-1908.\n- mustPrune immediately after APPLY is empty, and assertSource(PLTR, srcSignal) holds. This is the 'within those 3 days' clause.\n- The 'age to 1 minute before the boundary' step is dropped (D-13).\n- Backdate the row past the boundary: UPDATE ... SET valid_until = valid_until - interval '72 hours' - interval '1 millisecond'.\n- Then assertPruned(mustPrune(...), PrunedEntry{user-2, wlID, 'PLTR', StrategyID 'strat-3', SignalID nil, ValidUntil aged}) and assertBindingGone.\n- The event kind follows from SignalID == nil. That routing is at signal_prune.go:59-70 and the payload is guarded by signal_prune_test.go:102.\n- Backdating is the only clock seam. The prune uses DB now() (signal_expiry_repo.go:38,151), and D-6 forbids a production clock hook.\n\nMust-still-pass guards with no edits:\n- :443 TestBackfill_IngestRaceNeverLeavesEntryRemovable (byte-identical).\n- :349 TestBackfill_IngestInterleavingSkipsChanged.\n- :252-295 TestBackfill_MarkedEntryRescued (@AC-17). It holds because mergeSignalExpirySQL overwrites valid_until when signal_id IS NULL (watchlist_repo.go:294-295).\n\nBUILD ORDER\n- Step 1: RED forced-interleave tests, then the lock fix (GREEN).\n- Step 2: rewrite :216-250 so it fails on now(), then the one-token SQL change (GREEN), then the docs.\n\nDOCS\ndocs/runbooks/signal-watchlist-expiry-backfill.md:\n- :27: the mark is valid_until = now() + 72 hours and is pruned on the first tick after that.\n- :66-67 and §7 :150-153: the D-10 edits, plus the 'changed since REPORT stays untracked until REPORT and APPLY are re-run' sentence.\n- §8 (:160-175): retitle to '3-day grace for marks; none for seed_expired'. A live signal added in the window rescues a mark through the merge.\n- §9 (:177-205): the emergency stop is within one interval for seed_expired removals and within 3 days for marks.\n- §11 (:223): watch the next tick for seed_expired, and after 3 days for marks.\n\ndocs/runbooks/CLAUDE.md: change the backfill row's 'no grace period' text to '3-day grace for untracked marks; seed_expired removed next tick'.\n\nDurable acceptance (services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature):\n- @AC-16 (:127-136): CHANGE it to 'mark row signal_id NULL with valid_until 3 days after APPLY / a tick within 3 days removes nothing / a tick after 3 days removes PLTR with one signal_entry_removed_untracked event'. Tag @feature-359 per C-16 and cite the 2026-11-17 operator decision.\n- @AC-17 (:139): retitle to '...rescued by a live signal before it is pruned', in the same commit. This is wording only.\n\nservices/xstockstrat-portfolio/docs/context-constitution.md, next to PORTFOLIO-18 (:30):\n- Mandatory: the lock-order invariant. Every watchlist_signal_expiry writer, including backfill APPLY, takes the parent watchlists row lock first.\n- Add: backfill marks are signal_id NULL with a fixed 72h grace (backfillMarkGrace), and the add-path merge rescues them.\n\nservices/xstockstrat-portfolio/CLAUDE.md, Database bullet for signal_id NULL: append 'due 72h after APPLY'.\n\nGATED ON THE OPERATOR (blocking objection below): amend 359's own @AC-1 Then clause and the FR-1 text.\n- Proposed wording: 'the binding's expiry row is either absent or tracked by the live signal (its signal_id and valid_until)', plus 'a prune tick run after 3 days removes nothing'. This matches the D-9 assertion.\n- Alternatively, the operator signs an explicit written waiver recording that the strict-equality test assertion, not the scenario text, carries the @AC-1 guarantee.\n\nTouchpoints: no proto, no migration (portfolio or config), no config key, no new service.",
    "open_objections": [
      {
        "text": "[C-15/C-16, regression of 359's own @AC-1] After FR-3, a mark row that lost the race is now()+72h / signal_id NULL. That row satisfies every Then clause of @AC-1 and the FR-1 text ('absent or has a valid_until in the future'; 'a prune tick removes nothing'), yet the defect remains: at APPLY+72h it is pruned with signal_entry_removed_untracked while the 30-day signal is still live. Only the D-9 strict-equality test assertion still discriminates. Before approval, the operator must either (a) sign off on amending @AC-1 Then and FR-1 to 'absent or tracked by the live signal (its signal_id and valid_until)' plus 'a prune tick after 3 days removes nothing', or (b) record an explicit written waiver stating that the test assertion, not the scenario, encodes the @AC-1 guarantee.",
        "blocking": true
      },
      {
        "text": "[C-08] The frozen guard :443 TestBackfill_IngestRaceNeverLeavesEntryRemovable (:493-499) becomes blind to @AC-1 after FR-3, because a mark that lost the race is no longer due. It must appear as an explicit line item at the design gate, not only as a risk. Spec must list the two forced-interleave tests as must-not-weaken guards with the same status as :443 under D-6.",
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
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "281 @AC-16",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "281 @AC-17",
        "kind": "PRESERVE",
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
      }
    ],
    "rejected_alternatives": [
      "R-1..R-6 stay locked: the CTE lock, the add-path upsert, SERIALIZABLE or an advisory lock, the touch-UPDATE lock, a relaxed GREEN assertion, and a production lock_timeout.",
      "Config key portfolio.watchlist.backfill_mark_grace_hours: it needs a config seed migration, a SCALAR_BOUNDS entry and WatchConfig wiring in a one-shot CLI with no config client. It contradicts the Fix Scope ('no config key changes'), and the value is not env-specific (config-governance.md:7).",
      "Grace passed as a $3 bind parameter: it breaks the shared (wlID, sym) argument list both statements use at signal_expiry_backfill.go:167. Concatenation follows the ownWatchlistSignals precedent (:107, :120).",
      "interval '3 days': on timestamptz it depends on the session TimeZone, so across DST it differs from the test's 72h literal. interval '72 hours' means the same thing everywhere and still satisfies '3 days after APPLY'.",
      "A new twin @AC-3 test instead of rewriting TestBackfill_StrictUntrackedRemoval: it near-duplicates the PLTR/strat-3 fixture, and @AC-16 is itself being changed (C-18).",
      "An 'age to 1 minute before the boundary, prune still empty' step: it re-tests the prune comparator (281 @AC-2), not the grace, and it adds a tick-under-1-minute timing assumption. The [t0+72h, t1+72h] bound plus a prune immediately after APPLY already covers 'within 3 days'.",
      "A production clock seam for the prune: D-6 allows only test-code hooks, and backdating the row is enough."
    ],
    "open_risks": [
      "After FR-3, :443 can no longer detect a regression of the lock fix. Only the D-9 strict-equality forced-interleave tests guard @AC-1, and that holds only if the blocking @AC-1 wording objection is not resolved by amending the scenario.",
      "Operational window change: untracked marks now reach prune 72h after APPLY instead of on the next tick. The runbook §9 emergency-stop window and the §11 monitoring advice must change with it, or an operator watching only the next tick will miss the removals.",
      "Accepted residual from earlier rounds: the frozen :443 test runs with a 500ms lock_timeout, and after the fix it now waits milliseconds on the watchlist-row lock. A CI 55P03 under -race load means investigate the runner, never edit the test.",
      "The pg_stat_activity gate predicates count lock waiters cluster-wide. This is accepted because the tests run sequentially and the branch assertion comes last.",
      "Still to prove at execute: that the forced interleave is RED/GREEN deterministic, that the speculative-insert wait shows as wait_event_type='Lock', and that insertBindingsTx does not wait on an existing binding.",
      "APPLY has no lock_timeout, so a wedged add-path transaction pauses the one-shot job. Accepted under YAGNI because the job is operator-interruptible."
    ],
    "constitution_rules_touched": [
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-06",
      "F-07",
      "PORTFOLIO-18"
    ],
    "rationale": "I checked the cited sites in the worktree:\n- backfillMarkSQL writes now() at signal_expiry_backfill.go:116, and the seed SQL at :101-112 is separate.\n- config-governance.md:7 scopes the hardcoding ban to env-specific values.\n- The feature's acceptance.feature now carries @AC-2 and @AC-3, which closes O-3.\n- @AC-1 Then still reads 'absent or has a valid_until in the future'. This confirms the adversary's blocking point.\n- Durable 281 @AC-16 (:127-136) and the @AC-17 title (:139) match the cited text.\n\nProposer and adversary agree on the lock fix and on a one-token FR-3 as a named constant. The adversary found no Floor breach. On F-07 I adopt the 'not env-specific, operator-fixed, no config client, Fix Scope says none' reading and record it in context.md.\n\nFolded in from the adversary's non-blocking points:\n- interval '72 hours' resolves the DST choice.\n- The pre-boundary aging step is dropped.\n- @AC-17 is retitled in the same @feature-359 commit.\n- The forced-interleave tests are elevated to must-not-weaken.\n- priorSignalAge is a typed time.Duration.\n\nOn the register: the FR-3 edit contradicts D-1's 'backfillMarkSQL unchanged' clause. The binding operator decision explicitly sanctions it, so it is recorded as D-11 with that citation, and a REOPEN D-1 petition carrying the operator decision as new evidence goes to the operator. It is not marked reopened, because the steer does not name D-1. The lock-fix scope of D-1 still stands.\n\nO-3 is closed by the operator. O-8 and O-9 are concretely answered.\n\nOne blocking objection remains. It needs operator action at the gate, either by amending 359's own @AC-1/FR-1 wording or by signing a waiver, because after FR-3 the scenario text no longer fails on the defect.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "FR-3: backfillMarkSQL selects now() + backfillMarkGrace instead of now() at signal_expiry_backfill.go:116, for marks only. backfillSeedSQL and watchlist_repo.go stay untouched. This supersedes only D-1's 'backfillMarkSQL unchanged' clause; D-1's lock-fix scope stands.",
          "evidence": "Operator decision 2026-11-17 (FR-3 / @AC-3, which sanctions the CHANGE of 281 @AC-16 and runbook §8); signal_expiry_backfill.go:101-121"
        },
        {
          "text": "The grace is an unexported Go string constant backfillMarkGrace = interval '72 hours', concatenated the way ownWatchlistSignals is. It is not a config key: no migration, no SetConfig bound, no $3 parameter. The F-07 reasoning is recorded in context.md.",
          "evidence": "docs/patterns/config-governance.md:7 (env-specific scope); cmd/server/backfill.go:29-61 (no config client); product-spec Fix Scope 'No config key changes'; signal_expiry_backfill.go:107,120,167"
        },
        {
          "text": "The @AC-3 test rewrites the removal tail of TestBackfill_StrictUntrackedRemoval (:216-250), retagged AC-16+AC-3. It asserts signal_id nil and valid_until within [t0+72h, t1+72h], that a prune immediately after APPLY is empty, then backdates the row past the boundary and asserts assertPruned with SignalID nil plus assertBindingGone. There is no pre-boundary aging step. The event kind is covered by signal_prune.go:59-70 and signal_prune_test.go:102.",
          "evidence": "signal_expiry_backfill_dbtest_test.go:216-250; signal_expiry_repo.go:38,151 (DB now(), no clock seam); fails.md:1902-1908"
        },
        {
          "text": "The FR-3 documentation set covers: runbook :27, §8 retitle, §9 emergency window, §11; the docs/runbooks/CLAUDE.md backfill row; a durable @AC-16 CHANGE tagged @feature-359 and an @AC-17 retitle to 'before it is pruned' in the same commit; a PORTFOLIO-18 grace note; and a portfolio CLAUDE.md Database bullet. TestBackfill_MarkedEntryRescued (:252-295) stays as a must-still-pass guard with no edit.",
          "evidence": "signal-watchlist-expiry-pruning.feature:127-139; watchlist_repo.go:294-295; context-constitution.md:30"
        }
      ],
      "new_rejected": [
        {
          "text": "Config key portfolio.watchlist.backfill_mark_grace_hours (with a seed migration and a SCALAR_BOUNDS entry) for the mark grace",
          "why": "The value is not env-specific, the one-shot CLI has no config client, and it contradicts the Fix Scope and the operator's fixed acceptance value"
        },
        {
          "text": "Grace via interval '3 days' or via a $3 bind parameter",
          "why": "'3 days' is DST-dependent on timestamptz and diverges from the 72h test literal; $3 breaks the shared (wlID, sym) argument list at :167"
        },
        {
          "text": "Pre-boundary 'age to 1 minute before, prune still empty' step in the @AC-3 test",
          "why": "It re-tests the 281 prune comparator rather than the grace, and adds a timing assumption; the DB-written bound already proves the grace"
        }
      ],
      "new_objections": [
        {
          "text": "[C-15/C-16] After FR-3, 359's @AC-1 Then clause and FR-1 text ('absent or valid_until in the future'; 'prune removes nothing') pass on lock-less code: the mark that lost the race is +72h/NULL and is pruned at APPLY+72h while the signal is live. The operator must amend them to 'absent or tracked by the live signal (signal_id and valid_until)' plus 'a prune after 3 days removes nothing', or sign a written waiver that the strict test assertion carries the guarantee.",
          "blocking": true
        },
        {
          "text": "[C-08] Present the :443 blindness to @AC-1 as an explicit design-gate line item, and list the forced-interleave tests in spec as must-not-weaken with the same status as :443 under D-6.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "The operator appended FR-2/@AC-2 (and FR-3/@AC-3) to product-spec.md and acceptance.feature on the feature branch (verified); the seed RED design is pinned in D-8/D-9"
        },
        {
          "id": "O-8",
          "how": "The lock-order invariant next to PORTFOLIO-18 (context-constitution.md:30) is a mandatory spec doc step, together with the FR-3 grace note"
        },
        {
          "id": "O-9",
          "how": "The helper is pinned as runForcedInterleave(t, class, priorSignalAge time.Duration) (sigID, until, branch): no function-valued parameters, assertions in each test body, and the @AC-3 test does not use it"
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-1",
          "evidence": "Operator decision 2026-11-17 (FR-3) explicitly sanctions changing backfillMarkSQL's valid_until, which contradicts D-1's 'backfillMarkSQL unchanged' clause; this evidence post-dates D-1 and is not on the register. The petition asks the operator to confirm D-1 as superseded-in-part by the FR-3 decision; its lock-fix scope stands.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-17 — sdd-design

- **Phase 0 Recon:** wrote `recon.md` earlier (services: xstockstrat-portfolio). Key reuse patterns:
  - The parent `watchlists` row lock is the serialization point (`watchlist_repo.go:545-546`; the lock form at `signal_expiry_repo.go:70`).
  - The `:349` `pg_stat_activity` forced-interleave test technique.
- **Phase 1 Grilling:** 3 rounds (full). The operator approved at the round-3 gate with the Floor clear.
- **Chosen approach:**
  - **Lock fix:** each APPLY candidate runs in its own short READ COMMITTED tx, via the single-caller helper `applyBackfillRow`. The tx does an Exec of `SELECT 1 … FOR NO KEY UPDATE` on the parent watchlist row, then the unchanged seed/mark INSERT, then Commit. `:168-183` stay byte-identical.
  - **FR-3:** `backfillMarkSQL` writes `now() + backfillMarkGrace`, an unexported Go constant `interval '72 hours'`. This applies to marks only; the seed SQL is untouched.
- **Rejected:** R-1..R-9.
  - R-1..R-6 were rejected in earlier rounds: CTE lock, add-path upsert, SERIALIZABLE/advisory lock, touch-UPDATE lock, relaxed GREEN assertion, production lock_timeout.
  - R-7..R-9 were rejected in round 3: config key, `'3 days'`/`$3`, pre-boundary aging step.
- **Register at approval:**
  - O-10 (blocking) is closed by the operator's @AC-1/FR-1 amendment (commit `96fad930`).
  - P-1 (REOPEN D-1) is marked user declined. The operator approved instead of reopening, and D-11 records the superseded-in-part clause.
  - O-11 (non-blocking) is carried into Open Threads.
- **Constitution rules touched:** C-08, C-11, C-15, C-16, C-18, P-02, P-03, P-06, F-01, F-06, F-07, PORTFOLIO-18. Floor breaches: none.
- **Business rules (C-16):**
  - CHANGE `281 @AC-16`, signed off by operator decision 2026-11-17 (FR-3 design-gate steer; also sanctions runbook §8).
  - EXTEND @AC-2 and @AC-3.
  - PRESERVE @AC-1 (Then clause amended by the operator), `281 @AC-17` (title wording only), @AC-9, @AC-12 and @AC-15.
- **F-07 reasoning (for /sdd-review):** `backfillMarkGrace` is a constant, not a config key, for three reasons:
  - `config-governance.md:7` scopes the hardcoding ban to env-specific values, and this one is not env-specific and was fixed by the operator.
  - The backfill CLI has no config client (`cmd/server/backfill.go:29-61`).
  - The Fix Scope says "No config key changes".
- **Ledger:** no line added. The parent-row-lock pattern is already the documented portfolio contract and is recorded next to PORTFOLIO-18 in this feature's spec. The RC snapshot-before-lock trap is feature-specific evidence (R-1).
- **Status:** spec-ready → design-approved.

## Open Threads

- [ ] **O-11 / :443 blindness.** After FR-3, `:443` can no longer catch a lock-fix regression. /sdd-spec must list `TestBackfill_MarkIngestInterleavingRescued` and `TestBackfill_SeedIngestInterleavingRescued` as must-not-weaken, with the same status as `:443` under D-6. Target: /sdd-spec, Step 1.
- [ ] **Operational window change.** Marks now reach prune 72h after APPLY. The runbook §9 emergency-stop window and the §11 monitoring advice must change with it. Target: Step 2 (docs).
- [ ] **Accepted residual: `:443` 500ms lock_timeout.** The frozen test now waits milliseconds on the watchlist-row lock. If CI reports 55P03 under `-race`, investigate the runner and never edit the test. Target: Step 1 verification.
- [ ] **Accepted: cluster-wide `pg_stat_activity` gate predicates.** Acceptable because the tests run sequentially and the branch assertion comes last. Target: Step 1.
- [ ] **Prove at execute.** Target: Step 1 (RED on current code, then GREEN).
  - The forced interleave is deterministic in both RED and GREEN.
  - The speculative-insert wait shows as `wait_event_type='Lock'`.
  - `insertBindingsTx` does not wait on an existing binding.
- [ ] **Accepted (YAGNI, R-6): APPLY has no lock_timeout.** A wedged add-path tx pauses the one-shot job. Target: Step 2 runbook note.

## Session 2026-11-17 — sdd-spec

- Generated implementation-spec.md with 7 steps. Status: design-approved → implementation-ready. Tree: `feature/fix-portfolio-signal-expiry-backfill@7418bc8b`. It is 6 commits behind `origin/main-dev`, with no diff under `services/xstockstrat-portfolio`, `docs/runbooks` or `.github`.
- The steps:
  1. service: `applyBackfillRow` lock fix.
  2. test: the forced-interleave tests (@AC-1, @AC-2).
  3. service: `backfillMarkGrace` FR-3. **Lands with** Step 4.
  4. test: the `TestBackfill_StrictUntrackedRemoval` tail rewrite (@AC-3). **Lands with** Step 3.
  5. docs: the runbook and the runbooks index row.
  6. docs: the durable @AC-16 CHANGE and @AC-17 retitle, tagged `@feature-359`.
  7. docs: PORTFOLIO-18 lock-order invariant and grace note, plus the portfolio CLAUDE.md bullet.
- Scenario coverage: @AC-1 and @AC-2 → Step 2. @AC-3 → Step 4.
- **O-11 closed in spec.** `TestBackfill_MarkIngestInterleavingRescued` and `TestBackfill_SeedIngestInterleavingRescued` are listed as must-not-weaken, with the same status as `:443` (spec § Must-not-weaken guards).
- **Atomic unit:** Steps 3+4. The FR-3 one-token SQL change breaks the current next-tick removal tail (`signal_expiry_backfill_dbtest_test.go:243-249`), so Step 3 cannot pass its own dbtest Verification alone.
- **No Lands with on Steps 1–2.** Step 2 references only existing helpers, so its RED is a behavior failure, and Step 1 alone keeps every existing test green.
- Key codebase findings:
  - APPLY's autocommit call is `signal_expiry_backfill.go:167`, and `:168-183` stays byte-identical. The transaction idiom is copied from `readBackfillState` (`:203`, `:207`). `pgconn` is imported in-package already at `portfolio_repo.go:13`. `pgx.ReadCommitted` was not grepped (no module cache), so the Step 1 compile confirms it.
  - The AddSymbols pool override uses the variadic `testPool(t, opts ...func(*pgxpool.Config))` (`dbtest_helpers_test.go:22`), as `watchlist_ensure_dbtest_test.go:20` does. 359 does not edit `dbtest_helpers_test.go` (354 overlap avoided).
  - The gate predicate matches `touchWatchlistTx`'s SQL at `watchlist_repo.go:505`. The poll and goroutine precedent is `:390-418`.
  - Other mark-then-prune tests hold under the grace: `:252-295` (the merge sets a NULL-signal row's `valid_until := $3`, `watchlist_repo.go:294`), `:320-344`, `:349` and `:443`. No other file calls `RunBackfill` except `cmd/server/backfill.go`.
  - The @AC-3 event kind comes from `SignalID == nil` routing (`signal_prune.go:59-70`) and is guarded by `TestSignalPrune_UntrackedEventPayload` (`signal_prune_test.go:102`).
  - Runbook touch points: `:27`, `:66-67`, §7 `:150-155` (with the R-6 no-lock_timeout operator note), §8 `:160` retitle, §9 `:177-179`, §11 `:223`, and `docs/runbooks/CLAUDE.md:14`. §6 `:122-123` (seed_expired next tick) stays correct.
- Ledger: no line added. No new cross-feature lesson; the lock-parked interleave pattern is already at `insights.md` 2026-11-10 (signal-watchlist-expiry-pruning, reuse).

## Open Threads

- [x] **O-11 / :443 blindness.** Closed by the spec's must-not-weaken list (Step 2 + § Must-not-weaken guards).
- [ ] **Operational window change.** Target: Step 5 (runbook §8, §9, §11).
- [ ] **Accepted residual: `:443` 500ms lock_timeout.** If CI reports 55P03 under `-race`, investigate the runner and never edit the test. Target: Step 1 verification.
- [ ] **Accepted: cluster-wide `pg_stat_activity` gate predicates.** Target: Step 2.
- [ ] **Prove at execute.** Target: Step 2.
  - RED branch is `addDone` and GREEN branch is `blocked`, deterministically.
  - The speculative-insert wait shows as `wait_event_type='Lock'`.
  - `insertBindingsTx` does not wait on an existing binding.
- [ ] **Accepted (YAGNI, R-6): APPLY has no lock_timeout.** Target: the Step 5 runbook §7 operator note.

## Session 2026-11-17 — sdd-review impl-spec (advisory)

- Result: 0 failures, 6 warnings, no Floor breaches (PASS WITH WARNINGS; advisory, lifecycle unchanged at `implementation-ready`).
- Overlap: WARN, file-level only, all with `352-delisted-symbol-handling` (`implementation-ready` on `origin/main-dev`). No migration NNN, proto field or config-key collision.
  - The PORTFOLIO-18 row of `services/xstockstrat-portfolio/docs/context-constitution.md`.
  - `services/xstockstrat-portfolio/CLAUDE.md`, on different lines.
  - The `docs/runbooks/CLAUDE.md` index table.
  - Behavioural overlap only: 352 adds a delisting removal to the same prune tick. No shared file.
- **Addressed** (implementation-spec.md § Step Dependencies):
  - Process warning: added an explicit execute-order bullet. Write Step 2 first and capture RED, then apply Step 1.
  - Overlap: added a bullet naming 352's three textual same-file overlaps. The rebase falls on whichever feature lands second, and no merge-order row is needed. 352's spec lines were verified on `origin/main-dev` (`:287`, `:509`, `:1197-1198`).
- **No change needed** (re-verified; already recorded in the spec or design):
  - Step 3/4 `Lands with` pairing is symmetric and correct.
  - Step 1/3 YAGNI: D-2 and D-7 are recorded decisions. The R-6 no-lock_timeout operator note is in Step 5.
- **Still open** (announce at every /sdd-execute checkpoint):
  - [ ] Step 1: `pgx.ReadCommitted` and `pgconn.CommandTag` were not confirmed against the module cache. Only the Step 1 compile confirms them. Low risk.
  - [ ] Step 2: the RED/GREEN claim relies on `pg_stat_activity` behaviour that is still unproven: the speculative-insert wait showing as `Lock`, and `insertBindingsTx` not waiting on the existing binding. A divergence escalates to the debate register and is never relaxed in place (C-08).
  - [ ] Step 2: the 10s-poll gates may be flaky on slow CI runners. If one flakes, investigate the runner. Never loosen the strict-equality assertions.
  - [ ] Step 4: the `[t0+72h, t1+72h]` bound uses DB `now()` sampled on separate pool connections around APPLY. It is sound on a single server clock, but watch for a bound failure caused by sampling skew, not by the code. Advisory.
  - [ ] Overlap with 352: whichever of 359 and 352 lands second must rebase the PORTFOLIO-18 row, the portfolio CLAUDE.md edit and the runbooks index row (Steps 5 and 7).

## Session 2026-11-17 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation (operator-approved record, verbatim): `{"mainDev":"4330f0eff61f0a5683d284e60a9296895bc93b9b","dev":"b3d37c7ee73c50bf9e8511391bf40c46d3a2a7bc","specHash":"56b0cebbee6695c10f21194fe863f00a8f7463cd","directive":"conditional","pending":[1,2,3,4,5,6,7],"mismatches":[]}`
- Merged `origin/main-dev@4330f0ef` into the dev branch (`ed81aa0d`); resolver and ledger-guard clean.
- Re-spec commits (`respec(fix-portfolio-signal-expiry-backfill)`): none (mismatches empty).
- Status: `implementation-ready` → `in-progress`.
- Tooling detection (steps 1-7): go1.27.0 ✓ · golangci-lint ✗ 2.5.0 on PATH (needs v2.14.0 → pinned `GOTOOLCHAIN=go1.27.0 go install …@v2.14.0` at step time) · docs steps need none.
- [ ] Steps 1, 2 and 4 verify with `-tags dbtest` against a migrated test DB (`PORTFOLIO_DB_TEST_URL`). None is set here and the execute loop never starts a database; the step executor must raise this as a blocker or record the CI `portfolio-db-test` job as the decided fallback.

```sdd-batch-setup
{"mainDev":"4330f0eff61f0a5683d284e60a9296895bc93b9b","date":"2026-11-17"}
```

## Session 2026-11-17 — sdd-execute sequential, Step 1

- Tooling setup (step 1): go1.27.0 ✓ · golangci-lint ⬇ v2.14.0 (pinned `GOTOOLCHAIN=go1.27.0` install, built with go1.27.0; host 2.5.0 left in place) · test DB ✗ (operator decision B → CI dbtest).
- Operator decision (binding, 2026-11-17): B — explicit P-06 waiver of LOCAL red-before-green for the dbtest-verified steps of feature 359 (Steps 1, 2, 3+4). No migrated TimescaleDB test DB can be provisioned here (Docker Hub 429, no apt package, GitHub source 403). Run build, vet, golangci-lint and the step greps locally, commit, and defer the dbtest run plus Steps 1–2 RED/GREEN to the CI `Portfolio DB test (TimescaleDB)` job on the integration PR. Never weaken, skip or loosen a test to compensate.

### Step 1 — service: serialize each APPLY row on the parent watchlist row lock [done]
- Added `backfillLockSQL` (`SELECT 1 … FOR NO KEY UPDATE`, no SKIP LOCKED) and the single-caller helper `applyBackfillRow`: one READ COMMITTED tx per candidate (lock Exec, unchanged INSERT, Commit, `_ = tx.Rollback` defer). `:167` now calls it; the ABORTED path and the outcome switch are byte-identical. Comments at the APPLY statements and on `RunBackfill` updated per D-10.
- Verification (local, `.sdd-logs/v-1.log`, `exit=0`): build and `vet -tags dbtest` clean, `golangci-lint` v2.14.0 `0 issues.`, `pool.Exec(ctx, stmt` no match, `FOR NO KEY UPDATE` only at `:124`. TDD: red/green deferred to CI per the operator waiver (no local RED captured).
- Files modified: `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill.go`
- Deviations: DEV-1 — dbtest Verification line and local RED/GREEN deferred to CI (operator decision B).
- [ ] Open: the CI `Portfolio DB test (TimescaleDB)` job must show `TestBackfill_|TestAddPath_|TestPrune_` green on the integration PR, including `:443` and `:349`; a 55P03 on `:443` under `-race` is the accepted lock_timeout residual (investigate the runner, never edit the test).
- [ ] Still open from impl-spec review: `pgx.ReadCommitted` and `pgconn.CommandTag` are now confirmed by the Step 1 compile (closes that warning). Step 2 `pg_stat_activity` assumptions, Step 2 10s-poll flakiness, Step 4 `[t0+72h, t1+72h]` sampling skew and the 352 overlap stay open.

## Session 2026-11-17 — sdd-execute sequential, Step 2

- Tooling setup (step 2): go1.27.0 ✓ · golangci-lint ⬇ v2.14.0 (pinned `GOTOOLCHAIN=go1.27.0` install into the session scratch bin; host 2.5.0 left in place) · test DB ✗ (operator decision B → CI dbtest).

### Step 2 — test: deterministic forced-interleave tests for the mark and seed race (@AC-1, @AC-2) [done]
- Appended `runForcedInterleave(t, class, priorSignalAge) (sigID, until, branch)` (pinned signature; branches `"blocked"` / `"addDone"`), `TestBackfill_MarkIngestInterleavingRescued` (AC-1) and `TestBackfill_SeedIngestInterleavingRescued` (AC-2) after `:349`, with the strict-equality assertions in spec order and `branch == "blocked"` last. The pinned signature returns no watchlist id, so each test body resolves it from `sigID` through `watchlistOfSignal` (signal `user_id` → that user's only watchlist); no assertion changes.
- Verification (local, `.sdd-logs/v-1.log`, `exit=0`): `go vet -tags dbtest` clean; both tests `--- SKIP` (`PORTFOLIO_DB_TEST_URL` unset); coverage `total: 81.8%`; `golangci-lint` v2.14.0 `0 issues.`; `:443` diff guard `0`. The diff only adds lines, so `:443`, `:349` and `:252-295` are byte-identical.
- TDD: AC-1/AC-2 red → green deferred to CI per operator decision B (DEV-1/DEV-2). No local RED captured, and Step 1 is already on the branch, so RED needs the CI job against `2f99b190^` (or the fix reverted).
- Files modified: `services/xstockstrat-portfolio/internal/repository/signal_expiry_backfill_dbtest_test.go`
- Deviations: DEV-2 — dbtest Verification lines and local RED/GREEN deferred to CI (operator decision B).
- [ ] Open: the CI `Portfolio DB test (TimescaleDB)` job must show both new tests green with `branch="blocked"`. A RED run on the pre-Step-1 tree (`branch="addDone"`, signal_id NULL or the old seed id) is still unproven. Any divergence escalates to the register and is never relaxed in place.
- [ ] Still open from impl-spec review: Step 2 `pg_stat_activity` assumptions (speculative-insert wait as `Lock`, `insertBindingsTx` not waiting), Step 2 10s-poll flakiness, Step 4 `[t0+72h, t1+72h]` sampling skew, the 352 overlap.
