# Context: pipeline-job-graph

**Feature**: `docs/roadmap/features/367-pipeline-job-graph/feature.md`
**Product Spec**: `docs/roadmap/features/367-pipeline-job-graph/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/367-pipeline-job-graph/implementation-spec.md`

---

## Session 2026-11-27 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Program context: `docs/roadmap/program-job-graph-analysis-pipeline.md`. This is feature 1 of 9.
- Operator decisions that bind this feature (recorded in the program plan, 2026-11-27):
  - D-1: Postgres job graph, no broker.
  - D-10: future universe-relative ranking must not be blocked, hence a run id on every job.
  - D-11: single-instance constraints are removed, hence leases with fencing. This **reverses**
    the 156/158 ruling "do NOT rebuild lease/CAS fencing on an `instance_count:1` service"
    (`docs/roadmap/ledger/insights.md` 2026-08-26 entries). The design must address the failure
    that ruling cited: a lease taken before a crash wedging the work for the full hold.
- Open fork raised to the operator (product-spec Open Questions, first item): a core that migrates
  no pipeline has no consumer, which the "minimum that solves the stated problem" rule and C-18
  will challenge.

## Session 2026-11-27 — operator decision on the consumer fork

- **OPERATOR DECISION: "go with B"** — the retention prune is the first real job kind, so the core
  runs itself in production. Rejected: (a) test-only job kinds; (c) merging with program feature 2.
- Spec changes: FR-7 now runs the prune as job kind `pipeline.retention_prune`, one per UTC day,
  ensured by every instance through the idempotent enqueue. FR-9 became a kill switch. Added
  `@AC-15` and `@AC-16`.
- Author inference, not an operator statement: `analysis.pipeline.worker_enabled` now defaults to
  `true`, because a prune that needs an operator step would not exercise the core. Flagged in
  product-spec Open Questions for confirmation at `/sdd-review`.

## Session 2026-11-27 — sdd-review product-spec (FAIL, round 1)

- Tree: ccr-fe135a59-nyslbm@7766822, which is origin/main-dev@50e5021 plus docs-only commits.
  Deviation from `docs/sdd/tree-freshness.md`: the tree was not switched to `main-dev`, because the
  feature directory exists only on the harness branch until PR #1634 merges.
- Overlap: CLEAN. Analysis migration `031` and config migration `060` are free; re-check at spec.
- Criteria: FAIL on criterion 6 (config readers and seed number not stated) and criterion 9
  (six unchecked Open Questions). No Floor breach. Status stays `draft`.
- Fixed in the spec after the review: reader and seed migration named; five design-deferred
  questions restated as `## Design Constraints`; FR-2, FR-3, FR-6 and FR-7 tightened; `@AC-4`,
  `@AC-5` and `@AC-15` wording made concrete (IDs unchanged).
- Still open: the worker default (`worker_enabled` = `true`) needs the operator. Re-run the review
  after that answer.

## Session 2026-11-27 — operator decision on the worker default

- **OPERATOR DECISION: "Default true"** — `analysis.pipeline.worker_enabled` defaults to `true`.
  The last open question in product-spec.md is closed.

## Session 2026-11-27 — sdd-review product-spec (round 2)

- Product spec approved. Status: draft → spec-ready.
- Warnings: lane set and order undefined (FR-5 / `@AC-10`); `no_vendor_data` in `@AC-9` read as
  pipeline meaning. Both fixed in product-spec.md after the verdict.
- Overlap findings: none (round-1 scan reused; only this feature's docs changed since).
- Recommended design depth: full (DB migration, 2 affected services).
- Design-phase watch items from the reviewer: F-06 pool contention for `worker_concurrency` 4;
  C-18 on lanes and dependency edges with no production consumer yet.

## Session 2026-11-27 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (services: analysis, config). Tree:
  ccr-fe135a59-nyslbm@eda1880 ≡ origin/main-dev.
- **OPERATOR DECISION: "keep going with writing the plans until you need me again"** — taken as a
  standing choice of *Run another round* at any gate where *Approve* is not yet selectable (full
  mode, round 1). The approval gate itself is never skipped.
- **OPERATOR OVERRIDE: "I override the round cap. Getting a sound high quality design is more
  important."** — the 5-round hard cap of `/sdd-design` does not apply to this feature. Rounds
  continue while they make progress; the no-progress detector still applies.

## Session 2026-11-27 — sdd-design gate after round 4

- Rounds 1–4 run (full; cap lifted). Register: 45 decisions, 18 rejected alternatives, 53
  objections, 3 open at the gate. No Floor breach, no C-16 regression. design.md is a draft.
- **OPERATOR DECISION (O-12): "30-day window"** — succeeded jobs pruned after `retention_days`;
  `failed`/`dead`/`blocked` jobs kept `max(30, retention_days)` days, not tunable; no requeue in
  this feature (program feature 4 owns it); manual recovery SQL in a runbook page. This changes
  FR-7, which said dead and blocked jobs are kept.
- **OPERATOR DECISION (O-47): "Busy delay, idle backoff"** — `pipeline.poll_interval_ms` is the
  delay between claims while work flows; idle polling backs off to `max(poll_interval_ms, 5 s)`.
- **OPERATOR (O-34): "Show me the exact text first"** — spec and scenario amendments NOT applied.
  The before/after text was shown in session; awaiting the answer.
- **OPERATOR (design gate): "Run another round"** — round 5 started. Not approved.

## Session 2026-11-27 — sdd-design round 5

- Round 5 run at the operator's request. Proposer self-review and adversary audit of design.md.
  No Floor breach, no C-16 regression. Nine new objections (O-54..O-62), four blocking.
- Three reopen petitions are pending the operator: P-1 (D-43 slot release), P-2 (D-42 worst-case
  figure, replaced by invariants), P-3 (D-34/D-44 heartbeat period, fixed 7.5 s). Both sides
  recommend accepting all three.
- O-34 (spec wording) is still with the operator; the before/after text was shown in session,
  with a proposed `@AC-18` for the 30-day deletion.
- design.md not yet amended for round 5; corrections wait for the operator's rulings.

## Session 2026-11-27 — sdd-design gate after round 5

- **OPERATOR REOPEN P-1 (D-43): "hold the slot"** — a job keeps its worker slot until its report
  or park is written, rejected or abandoned (D-46).
- **OPERATOR REOPEN P-2 (D-42, D-34 worst case): "state invariants"** — no closed-form worst-case
  takeover figure; bounding invariants plus the normal figure `lease_seconds` + 10 s (D-47).
- **OPERATOR REOPEN P-3 (D-34, D-44): "fixed 7.5 s period"** — heartbeat period independent of
  `lease_seconds` (D-48).
- **OPERATOR DECISION (O-34): "Accept all, add AC-18"** — product-spec.md amended (FR-7, FR-9,
  lease constraint, `poll_interval_ms` description); acceptance.feature amended (`@AC-3`,
  `@AC-4`, `@AC-12`, `@AC-15`) and `@AC-17`, `@AC-18` appended. These change an approved spec
  with explicit operator sign-off.
- Reopens require another round: round 6 started over the amended design.md. Not approved.

## Session 2026-11-27 — sdd-design round 6

- Round 6 run over the amended design (required by the round-5 reopens). No Floor breach, no
  C-16 regression, no register violation. Every lease-timing figure was recomputed by both sides
  and confirmed. Eight new objections (O-63..O-70); O-63 is a functional gap (a claim after the
  kill switch), found independently by both sides.
- Two reopen petitions pending the operator: P-4 (D-49 lock strength) and P-5 (D-47 invariants 1
  and 3). One spec wording follow-up pending the operator (the 4 s lag in the lease constraint).
- design.md not yet amended for round 6.

## Session 2026-11-27 — sdd-design gate after round 6

- **OPERATOR REOPEN P-5 (D-47 invariants 1 and 3): "correct both"** — D-51.
- **OPERATOR REOPEN P-4 (D-49 lock strength): "weaker lock"** — reap and settle use
  `FOR NO KEY UPDATE SKIP LOCKED` (D-52).
- **OPERATOR DECISION: "Update the spec"** — the lease constraint in product-spec.md now reads
  "`lease_seconds` + 10 s, plus up to 4 s of event-loop lag".
- Kill-switch re-check and the other round-6 corrections applied to design.md (D-53).
- Reopens require another round: round 7 started. Not approved.

## Session 2026-11-27 — sdd-design round 7

- Round 7 run over the design as amended for round 6. One substance item, found independently by
  both sides: a finished handler's result could be discarded by the self-fence while it waited
  for the lane (O-71 → D-54). Everything else was wording, applied to design.md. No Floor breach,
  no C-16 regression, no register violation; FR-1..FR-9 and `@AC-1`..`@AC-18` all PASS.
- One non-blocking reopen petition pending the operator: P-6 (claim lock strength). If declined
  it stays an Open Risk.

## Session 2026-11-27 — sdd-design gate after round 7

- **OPERATOR REOPEN P-6 (D-4 / D-52 claim lock): "weaker lock in the claim"** — the claim selects
  with `FOR NO KEY UPDATE SKIP LOCKED` (D-55).
- **OPERATOR (design gate): "Run another round"** — round 8 started. Not approved.

## Session 2026-11-27 — sdd-design round 8

- Round 8 run with a full row-lock audit and a (phase, event) audit of an attempt's life.
  The adversary judged the debate converged. The proposer found one substance item that predates
  this round's changes: the prune's guard could miss an edge committed after its snapshot
  (O-74 → D-56). Two small undecided points (park's parent lock mode; give-up clock start) and
  wording were fixed (D-57). No Floor breach, no C-16 regression, no register violation, no
  petition. `@AC-2` confirmed under the weaker claim lock; no deadlock cycle.

## Session 2026-11-27 — sdd-design gate after round 8

- **OPERATOR (design gate): "Run round 9"** — the round-8 prune fix (D-56) has not been through an
  adversarial pass. Round 9 started. Not approved.

## Session 2026-11-27 — sdd-design round 9

- Round 9 run, focused on the two-statement prune (D-56) and on any other statement with the
  same "predicate on an older snapshot than the lock" shape. Both sides confirmed D-56 is
  race-free and that O-74 was real; settle, reap and claim are safe. No mechanism changed.
- One narrow substance item: the manual recovery SQL for a `blocked` parent needed an order and a
  transaction (O-78 → D-58). The rest was wording and one unbuildable test description.
- Both sides judge the debate converged. No Floor breach, no C-16 regression, no petition.

## Session 2026-11-27 — sdd-design gate after round 9

- **OPERATOR (design gate): "Run round 10"** — the round-9 text edits have not been re-read by
  either reviewer. Round 10 started. Not approved.

## Session 2026-11-27 — sdd-design round 10

- Round 10 run as a clean final read. No mechanism changed. One substance item, found
  independently by both sides: the `blocked`-parent recovery SQL's edge delete was unguarded
  (O-81 → D-59); the SQL is now written out in design.md. Two settled decisions (D-13, D-39) that
  were missing from the document were added. The adversary's sweep of every numeric and
  "never / at most" claim found three that depended on unstated conditions; all corrected.
- No Floor breach, no register violation, no petition. FR-1..FR-9 and `@AC-1`..`@AC-18` PASS.

## Session 2026-11-27 — sdd-design gate after round 10

- **OPERATOR (design gate): "Run a full round 11"** — round 11 started. Not approved.

## Session 2026-11-27 — sdd-design round 11

- Round 11 run as a full pass. The proposer's verdict: SOUND, wording only (first round with no
  substance from a reviewer). The adversary found no worker-mechanism defect; one low-severity
  lock-mode point in the printed recovery SQL (O-84, petition P-7 pending the operator) and
  runbook wording (O-83, applied). Both printed SQL blocks are valid, satisfy every table check
  and are safe run twice or concurrently. A recovered failed or dead job's "every declared child
  succeeded" assumption was confirmed true in every case.
- No Floor breach, no C-16 regression, no register violation. FR-1..FR-9, `@AC-1`..`@AC-18` PASS.
  Both sides rate a further full round as low value.

## Session 2026-11-27 — sdd-design gate after round 11

- **OPERATOR REOPEN P-7 (D-59 recovery lock): "weaker lock"** — the recovery locks its row
  `FOR NO KEY UPDATE` (D-60).
- **OPERATOR (design gate): "Run round 12"** — round 12 started. Not approved.

## Session 2026-11-27 — sdd-design round 12

- Round 12 run. **No substance from either side** (proposer: SOUND, wording only; adversary:
  SOUND, READY FOR OPERATOR APPROVAL). The adversary read the design as a spec author, a test
  writer and an operator, spot-checked 19 code citations (all resolve) and found a test seam for
  every `@AC-*`. Wording and completeness edits applied (O-85). By the protocol's detector this is
  a no-progress round: the debate has converged.

## Session 2026-11-27 — sdd-design (approved)

- **OPERATOR DECISION (design gate): "Approve design"** after round 12.
- Phase 0 Recon: wrote recon.md (services: analysis, config; key reuse patterns:
  `supervision.spawn`, `read_budget.py`'s server-side statement timeout and terminate rule).
- Phase 1 Grilling: 12 rounds (full; cap lifted). Chosen approach: two job tables in analysis, a
  fenced lease on the database clock, a separate fixed-size control pool, `bounded_txn` for every
  database operation, three supervised loops, park-and-settle dependencies, a daily prune job.
  Rejected: 18 alternatives (advisory locks, LISTEN/NOTIFY, a single shared lock or connection,
  raising `DB_POOL_MAX`, deferred cancellation, a result column, and others; see debate.md).
- Operator reopens accepted during the debate: P-1..P-7 (slot held until the report is written;
  bounding invariants instead of a worst-case figure; fixed 7.5 s heartbeat; `FOR NO KEY UPDATE`
  for reap, settle, claim and the recovery lock; corrected invariants).
- Constitution rules touched: C-05, C-07, C-08, C-10, C-13, C-14, C-15, C-16, C-18, F-01, F-06,
  F-07, P-03. Floor breaches: none in any round.
- Status: spec-ready → design-approved.

## Session 2026-11-27 — sdd-spec

- Generated implementation-spec.md with 19 steps. Status → implementation-ready.
- Tree: ccr-fe135a59-nyslbm@19d095b ≡ origin/main-dev. `feature/pipeline-job-graph` does not exist
  on origin yet, so `main-dev` was the target; the tree-freshness check passed without a switch.
- Discovery ran inline in this session (no `codebase-discovery` subagents). recon.md's Codebase Map
  was reused; only what it does not cover was searched.
- The ledger files (about 650 KB each) were read by targeted search for the affected services and
  surfaces, not end to end.
- Key codebase findings:
  - Next free numbers on `origin/main-dev`: analysis migration `031`, config migration `060`.
    Feature 345 (`authelia-sso`, implementation-ready) also plans config `060_authelia_sso_keys`;
    whichever merges first keeps the number. No `merge-order.md` row exists yet for 367 against 345.
  - Three pins the design and recon did not name (spec decision S-9):
    `scripts/migration-rerun.py:1114` hard-codes the analysis clean end version `30` (Step 4);
    `tests/test_config_zero_clamps.py:96-97` requires `AC6_ROWS` to equal `FR3_KEYS` (Step 3);
    `tests/test_supervision.py:143-148` pins the number of `spawn(` calls in `app/main.py`
    (Step 18).
  - `scripts/config-wiring.json` `registry.receivers` keys a read by `<file>:<receiver>`; the reader
    needs the two entries `…/job_graph.py:int_positive` and `…/job_graph.py:self._cfg`, and no
    `findings` entry. The wiring gate also compares a literal read default with the seeded default.
  - `asyncpg` is locked at 0.31.0, whose `create_pool` accepts `reset` and `min_size`. PostgreSQL 16
    binaries are present in the sandbox, so the `real_pg` tests run here (77 baseline tests passed).
  - No virtual-time event loop, fake job repository or job-row fixture exists in `tests/`; Steps 8
    and 12 create them in `tests/conftest.py`.
  - Regenerating `scripts/config-wiring-stored.json` needs a database. Feature 366 did it on a
    throwaway local PostgreSQL 16 under an operator ruling; Step 1 lists the routes.
- Spec-time decisions S-1..S-9 are in implementation-spec.md § Spec-time decisions (repository
  method names; `prune_batch` as a module-level function; `control_pool_reset` in `read_budget.py`;
  boot task names; file names; the unconditional daily ensure; one gate test moved to Step 12;
  config docs rows in Step 1; the three unlisted pins).
- Not run at spec time: the `xstockstrat-config` lint and test commands (`node_modules` is not
  installed in this sandbox). In this sandbox a bare `uv run pytest` resolved a `pytest` outside the
  service environment, so the spec's analysis commands pass `--extra dev`.

## Open Threads

Carried from design.md § Open Risks; each needs an owner at `/sdd-spec` or later:

- asyncpg behaviours pinned by build step 3's tests before step 4 (terminate wakes an in-flight
  await; `reset=`; `min_size=0`), with fallbacks written in design.md.
- PgBouncer queueing is untestable in CI; measured in program feature 3's shadow run.
- No requeue until program feature 4; manual recovery SQL ships in
  `services/xstockstrat-analysis/docs/pipeline-jobs.md` (build step 8).
- Hazards H1 and H2 for an in-transaction report, and executor-thread handlers: program feature 3.
- `docs/roadmap/program-job-graph-analysis-pipeline.md` line 81 (advisory-lock note) is corrected
  in build step 8.
- Config migration `060` is also planned by feature 345; re-check the number at `/sdd-execute`
  Step 1 and before the integration PR. `/sdd-review pipeline-job-graph impl-spec` owns the
  `merge-order.md` row.
- Step 6's asyncpg pins gate Step 9 onward; a failed pin applies the design.md fallback and is
  recorded in the Deviation Log.
- Step 1's stored-set regeneration starts a database for artifact generation; name the route at
  the Phase-2 confirmation.

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 1)

- Tree: ccr-fe135a59-nyslbm@bbc6e89 (origin/main-dev@19d095b plus the spec commit).
- Result: 2 failures (one root cause), 7 warnings (advisory — did not block). No Floor breach.
  Every `@AC-1`..`@AC-18` has a test step; every design test has a step; no rejected alternative
  is reintroduced.
- Unresolved ✗ / ⚠ carried into execution:
  - Steps 15/16: adding `Loop.PIPELINE_WORKER` turns `tests/test_analysis_tick_telemetry.py:164-166`
    red (F-05 exposure) — [x] fixed in the spec: the file is in Step 16's Files, and Steps 15 and
    16 land together.
  - Step 1: no seed-to-reader value test (C-05) — [x] fixed: Step 3 parses the seed migration.
  - Step 1: TDD marked N/A despite a bounds-registry code change (P-06) — [x] fixed.
  - Step 1: eight files — [x] recorded as S-11 (one commit required by D-25 / C-10).
  - Step 8/12: 1 200 settleable parents not tested in one tick — [x] fixed: Step 12 adds it.
  - Step 11: fixed-constants list incomplete — [x] fixed.
  - Step 12: Covers omitted `@AC-5/6/7` — [x] fixed.
  - Step 16: no `host.provider` assertion for the durable `@AC-3 @feature-337` — [x] fixed.
  - Undeclared seams — [x] recorded as S-10.
  - Step 7 (S-2): `prune_batch` is a module-level function where design.md says "method" —
    [x] design.md wording corrected with operator approval (D-61).
  - S-7: one design gate test lands in Step 12, not before the engine — [x] design.md test lists
    corrected with operator approval (D-61).
- Overlap findings: config migration `060` is claimed by both 367 and 345 (`authelia-sso`); no
  `merge-order.md` row exists — [x] conditional row added with operator confirmation.
  All other overlaps are clean or rebase-only.

## Session 2026-11-27 — operator rulings on the impl-spec review

- **OPERATOR DECISION: "Add a conditional row"** — `docs/roadmap/features/merge-order.md` gains a
  367 ↔ 345 row: whichever merges first keeps config `060`; the other renumbers and regenerates
  the stored set. Neither waits.
- **OPERATOR DECISION: "Correct the design text"** — design.md amended after approval, wording
  only (D-61): the prune batch is the repository module's `prune_batch` function; the
  runner-versus-heartbeat test is an engine test. No mechanism changed.
- **OPERATOR: loop the impl-spec review until all warnings are addressed.**

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 2: overlap)

- Overlap scan round 2: the 367 ↔ 345 entry was a Blocking Dependencies table row with
  `Resolved = No`, which would make `/sdd-execute` warn 367's integration PR until 345 launches,
  contradicting the operator's "neither waits". Converted to a non-blocking prose section in
  `merge-order.md` (the file's existing form for config-seed-number overlaps), naming merge-time
  renumbering as the accepted remedy and adding `scripts/config-wiring-stored.json`. No other
  collision; the rest is rebase-only.

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 2: criteria)

- Result: 1 failure, 8 warnings, 6 notes (advisory). No Floor breach. Every round-1 fix verified
  in the text; the pin search found no existing test the spec had missed.
- Unresolved ✗ / ⚠ carried into execution:
  - F1 Steps 15+16 had no Step Dependencies line — [x] added.
  - W1 batch-size, prune block budget and prune self-stop constants unnamed — [x] `BATCH_SIZE`,
    `PRUNE_BLOCK_BUDGET_S`, `PRUNE_SELF_STOP_S`; `prune_batch` returns `full`.
  - W2 `start_listening()` had no watcher source — [x] `JobGraphSettings.on_change`.
  - W3 Step 18's pool assertions could not run — [x] `_create_pools(dsn)` helper in `main.py`.
  - W4 `@AC-7` not driven through the worker — [x] test added to Step 12.
  - W5 duplicate test bullet in Step 12 — [x] removed.
  - W6 `host.provider` assertion had no method — [x] precedent and steps cited in Step 16.
  - W7 `prune_batch(conn, …)` positional conflicted with the handler contract — [x] `conn` is
    keyword-only everywhere.
  - W8 service steps' Verification does not exercise behaviour — [x] each names its gating test step.
  - N1–N5 — [x] applied (Step 15 gate, staleness clock, Step 17 symbol list, a grep that could not
    fail, table names in the analysis `CLAUDE.md` section).
  - N6 stored-set regeneration needs a database route at execute confirmation — [ ] unaddressed:
    an execute-time choice, not a spec defect.
  - N6 config-service lint and tests not run in this sandbox (`node_modules` absent) —
    [ ] unaddressed: run at execute.

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 3: overlap)

- Overlap scan round 3: the `060` collision still fails by the letter of the overlap rule
  ("Rename one before executing"); a prose note is not a waiver.
- **OPERATOR DECISION: "Renumber 367 to 061"** — 345 was specced first and keeps `060`. Every
  `060` in implementation-spec.md, design.md and product-spec.md now reads `061`; the merge-order
  note is updated. If 367 merges first, 345 moves above `061` and `060` stays a gap.
- The scan's `host.provider` seam with feature 337 is moot: `_with_host_provider` is already on
  `main-dev` for analysis (`app/telemetry.py:49`).

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 3: criteria)

- Result: 0 failures, 6 warnings, 8 notes. All round-2 fixes verified present; all 18 `@AC-*`
  traced; no Floor breach. All 14 items applied to implementation-spec.md:
  - [x] W1 Step 14 lacked evidence for `make_handler` and a test of the 30 s block budget; the
    self-stop test now builds its own registry with an injected clock.
  - [x] W2 `on_change` / `start_listening()` were untested and Step 11's rationale was wrong
    (`snapshot_watcher` does support `on_change`, `app/config/watch_core.py:92-97`); tests added
    in Steps 3 and 12.
  - [x] W3 Step 16 never called `register_pipeline_gauges()` before reading the gauges.
  - [x] W4, W5 two verification greps could not fail; both now exit non-zero on a match.
  - [x] W6 Step 8 gates Step 9 onward and Step 12 gates Step 13 onward (design.md § Build order).
  - [x] N1 Deviation Log seeded with the `061` ruling. N2 S-10 lists the remaining seams.
    N3 Step 15 no longer requires Step 13. N4 the stats step uses the real monotonic clock.
    N5 the handler gate is an `asyncio.Lock`. N6 `_create_pool` is async; `serve()` pool
    defaults stated. N7 `prune_batch` tests run inside a transaction. N8 two more greps gate.

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 4)

- Overlap: clean. No other claimant of config `061`, analysis `031` or `analysis.pipeline.*`;
  the shared-file overlaps (stored set, `config-wiring.json`, `config-governance.md` next to
  feature 322's edits, `database.md`) are rebase-only and need no merge-order row.
- Criteria: 0 failures, 2 warnings, 2 notes; all round-3 fixes verified. All applied:
  - [x] W1 seven more verification commands always exited 0 (Steps 5, 8, 12, 14, 16, 18, 19,
    and the `spawn(` grep in Step 11); each now fails on the wrong result.
  - [x] W2 the 45 s stats-staleness bound was declared in both Step 11 and Step 15; it is now
    `PIPELINE_STATS_STALE_S` in `app/telemetry.py` only.
  - [x] N1 stats run on maintenance ticks 1, 4, 7, …; `stats_step()` is a named coroutine
    (added to S-10). N2 tests needing more than one pool take the DSN from `local_pg`.

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 5: criteria)

- Result: 0 failures, 3 warnings, 2 notes; all round-4 fixes verified. All applied:
  - [x] W1 Step 12's `asyncio.sleep(` ban failed a correct test; the virtual-time helper now
    exposes `await advance(seconds)` and the grep bans only non-zero sleeps.
  - [x] W2 Step 18: the spawn count is asserted (`-eq 11`) and the deploy-file check diffs
    against `origin/main-dev`, so it still works after a commit.
  - [x] W3 Steps 8, 12, 14 and 16 carry Step 6's "nothing skipped" guard for their real-Postgres
    files.
  - [x] N1 Step 13's informational import grep is removed (the handler contract test is the
    gate). N2 Step 7's guard grep escapes its dots.

## Session 2026-11-27 — sdd-review impl-spec (advisory, round 6: criteria) — PASS

- Result: PASS, 0 failures, 0 warnings, 1 note. All round-5 fixes verified; paths, signatures,
  step order and all 18 `@AC-*` traces check out. The review loop is closed.
  - [x] N1 Step 12's sleep regex let `sleep(0.5)` through; the pattern now catches it.
- Still open by choice, for `/sdd-execute`: the stored-set regeneration database route, and the
  config-service lint and tests (not runnable in the spec sandbox).

## Session 2026-11-27 — sdd-execute (sequential)

- **OPERATOR DECISION (mode entry): "Agree, minimal"** — sequential mode with no 5-step-cap checkpoint;
  the run pauses only for blockers and once at the end of the feature, before the integration PR.
- **OPERATOR DECISION (stored set): "Throwaway local PG16"** — the route for regenerating
  `scripts/config-wiring-stored.json` (implementation-spec Step 1 item 7; closes review note N6).
- **OPERATOR (feature plan): "Proceed"** — re-spec gate passed with no mismatch (the only changes between
  the spec tree `19d095b` and `origin/main-dev@334d3b7` are docs); no re-spec.
- Branch `feature/pipeline-job-graph` created from `origin/main-dev@334d3b7` and pushed.
- Tooling setup (all steps): uv ✓ · analysis deps ⬇ `uv sync --extra dev` · ruff ✓ · PostgreSQL 16
  binaries ✓ · pnpm ✓ 9.15.9 · Node 22.23.5 (no Node 24; CI-equivalent) · config `node_modules` ⬇
  `pnpm install --frozen-lockfile` · golang-migrate ⬇ 4.17.1 (scratchpad, stored-set only). Baselines:
  analysis 1977 passed; config 438 passed, lint 0 errors.
- Config migration number re-checked: trunk's highest is `059`, so `061` stands (Step 1 item 1).

### Steps 1+2+3 — config unit [done]
- Seeded six `analysis.pipeline.*` keys (config `061`), five `SCALAR_BOUNDS_REGISTRY` rows,
  `JobGraphSettings` in `app/engine/job_graph.py`, two wiring receivers, the regenerated stored set,
  the read-classification rows and the docs rows.
- TDD: red — `setConfigScalarBounds.test.ts` 5 failures on the new rows before the registry entries;
  `tests/test_job_graph_settings.py` failed to collect (no `app.engine.job_graph`). Green — config 453
  passed (c8 lines ≥ 40); analysis 2007 passed under `--cov-fail-under=40`; ruff clean.
- Gates: `check-config-wiring.mjs --final` and `--doc-check` exit 0 (two `REPORTED` baseline findings,
  neither this feature's); watcher copies, context map and migration order pass; 12 stored rows from
  `061`; 5 bounds entries.
- Files modified: `services/xstockstrat-config/migrations/061_analysis_pipeline_keys.{up,down}.sql`,
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts`,
  `services/xstockstrat-config/src/__tests__/{analysisPipelineKeysSeedMigration,setConfigScalarBounds}.test.ts`,
  `scripts/config-wiring-stored.json`, `scripts/config-wiring.json`,
  `services/xstockstrat-analysis/app/engine/job_graph.py`,
  `services/xstockstrat-analysis/tests/{test_job_graph_settings,test_config_read_classification,test_config_zero_clamps}.py`,
  `services/xstockstrat-analysis/CLAUDE.md`, `docs/patterns/config-governance.md`.
- Deviations: stored-set route and tooling versions (Deviation Log); none to the plan.

### Step 4 — migration `031_pipeline_job_graph` [done]
- Two plain tables `analysis.pipeline_jobs` (fillfactor 70, four table checks) and
  `analysis.pipeline_job_deps`, with the four job indexes and the child index; `migration-rerun.py`
  analysis clean end version 30 → 31.
- TDD: N/A (migration). Verified offline: up/down pair at `031` (highest + 1); 2 `CREATE TABLE` ↔ 2
  `DROP TABLE` (edges first); migration-order gate ok; `pipeline_job` mentioned only by `031`. Live
  apply is CI's (`migration-rerun`); Step 8's fixture also executes the up file.
- Files modified: `services/xstockstrat-analysis/migrations/031_pipeline_job_graph.{up,down}.sql`,
  `scripts/migration-rerun.py`.
- Deviations: none.

### Step 5 — `bounded_txn` and the control-pool reset callback [done]
- `bounded_txn(pool, budget_s, *, on_acquired=None, on_terminate=None, monotonic=time.monotonic)` with
  `BoundedTxn` (`fetch`/`fetchrow`/`fetchval`/`execute`/`abort()`, `terminated`, `expired`,
  `begin_sent_at`), `DbBudgetExceeded`, `TxnNotCommitted` (the COMMIT-tag error, also transient) and
  `control_pool_reset`, appended beside the untouched `budgeted_read`.
- The client timer is `loop.call_later`; no `asyncio.timeout` wraps the transaction. `monotonic=` is
  an added keyword so Step 6's unit tests inject the clock (item 5).
- TDD: behaviour gated by Step 6 (red/green recorded there). Gate: ruff clean; `test_read_budget*.py`
  pass; 148 additions, 0 deletions against `origin/main-dev`.
- Files modified: `services/xstockstrat-analysis/app/repositories/read_budget.py`.
- Deviations: `control_pool_reset` is a no-op (Step 6 ruling, Deviation Log).

### Step 6 — `bounded_txn` against real PostgreSQL, and the asyncpg pins [done]
- 10 real-PG pins (`tests/test_bounded_txn_real_pg.py`) and 9 fake-connection unit tests
  (`tests/test_bounded_txn.py`, injected clock, no sleeps).
- asyncpg 0.31.0 pins: terminate wakes an in-flight await ✓ (no child-task fallback); `reset=` ✓;
  `min_size=0` ✓; the reset-callback in-transaction refusal ✗ → operator ruling "Adopt asyncpg's
  behaviour" (Deviation Log), re-pinned as two tests.
- TDD: red — with the COMMIT-tag check and the client timer disabled in a scratch copy,
  `test_commit_that_returns_rollback_raises` failed (`DID NOT RAISE TxnNotCommitted`) and
  `test_frozen_backend_…` hit its 10 s hang guard (`TimeoutError`). Green — the four `bounded_txn` /
  `read_budget` files 59 passed; full suite 2026 passed, coverage 92.17% (≥ 40); ruff clean; no real-PG
  test skipped.
- Test-harness note: a first draft wrapped `PoolConnectionProxy.execute` by attribute assignment and
  hung; replaced by the `sent` spy on `asyncpg.Connection` (no product-code change).
- Files modified: `services/xstockstrat-analysis/tests/test_bounded_txn_real_pg.py`,
  `services/xstockstrat-analysis/tests/test_bounded_txn.py`.
- Deviations: the reset pin (Deviation Log).

### Step 7 — `PipelineJobsRepository` [done]
- `app/repositories/pipeline_jobs.py`: the FIFO control lane (`lane()`, `lane_held=`), `enqueue`,
  `claim`, `reap`, `heartbeat` (no lane, 3 s), `report`, `park` (`ParkRace`), `settle_batch`,
  `list_by_run`, `ready_stats`, the module-level `prune_batch` and `BATCH_SIZE = 500`.
- Build choices inside the step's seams: `report` returns the state written, or `None` when fenced out
  (truthiness keeps the spec's True/False); `ready_stats` returns both lanes, an absent lane as
  `(0, 0.0)`; the prune candidate select takes its state as a whitelisted SQL literal
  (`prune_candidates_sql`), so a cached generic plan can still prove the finished-rows partial index;
  `CLAIM_SQL` and `prune_candidates_sql` are module-level so Step 8's `EXPLAIN` runs the exact text.
- TDD: behaviour gated by Step 8 (red/green recorded there). Gate: ruff clean; import ok; no
  `asyncio.timeout`/`wait_for`/`shield`/`is_transient_db_error`/`datetime.now`/`app.engine`; 4
  `SKIP LOCKED` (claim, reap, settle, prune).
- Files modified: `services/xstockstrat-analysis/app/repositories/pipeline_jobs.py`.
- Deviations: none.

### Step 8 — repository SQL against real PostgreSQL, and the job-row fixtures [done]
- `tests/conftest.py`: `pipeline_pool`, the `pipeline_pg` fixture (runs the `031` file alone, asserts
  no other migration names `pipeline_job`), `insert_pipeline_job`, `shift_pipeline_job`.
- `tests/test_pipeline_jobs_real_pg.py`: 39 tests — 15 `test_ac*` scenario tests (`@AC-1`..`@AC-13`,
  `@AC-18`) and the design's gate tests (opposite-order parks, a park naming a parking job, the prune
  guard race in both orders, the recovery SQL run twice, 10 000 children under 5 s, 1 200 parents in
  500/500/200 batches, `EXPLAIN` on both partial indexes, `FOR KEY SHARE` holders, reap+settle on two
  instances, the enqueue retry, no statement for an empty claim or heartbeat).
- TDD: red — on a scratch copy without the claim lock and the report fence, `@AC-2` failed
  (`1 + 1 == 1`: both claimers took the job) and `@AC-4` failed (the stale holder's report wrote
  `succeeded`). Green — the file 39 passed; full suite 2065 passed, coverage 92.23%; ruff clean; no
  real-PG test skipped; 15 `test_ac*` functions.
- One full-suite run showed 1 failure that five later full runs (three under the coverage gate) did
  not reproduce; its name was lost to an output filter. Not attributed to this feature.
- Files modified: `services/xstockstrat-analysis/tests/conftest.py`,
  `services/xstockstrat-analysis/tests/test_pipeline_jobs_real_pg.py`, and (deviation)
  `services/xstockstrat-analysis/app/repositories/pipeline_jobs.py` (park sorts its children).
- Deviations: the park-order fix (Deviation Log).

### Step 9 — engine primitives [done]
- `app/engine/job_graph.py`: `Lane`, `Child`, `Succeeded`/`WaitOn`/`Verdict`, `PermanentJobError`,
  `AttemptStopped`, `classify`, `check_outcome` (a non-outcome return → `PermanentJobError`),
  `backoff_seconds`, `truncate_error`, `HandlerRegistry` (`register`/`kinds`/`get`/`child_kinds`/
  `validate`), `validate_wait_on`, `validate_verdict`, the named constants and the prune identity
  (`PRUNE_KIND`, `PRUNE_SUBJECT`, `PRUNE_LANE`, `prune_epoch`, `prune_run_id`).
- TDD: red/green recorded under Step 10. Gate: ruff clean; import ok (CI-equivalent `PYTHONPATH`,
  Deviation Log); settings + classification tests pass; no `is_transient_db_error`.
- Files modified: `services/xstockstrat-analysis/app/engine/job_graph.py`.
- Deviations: none (import-check path only).

### Step 10 — engine primitive tests [done]
- `tests/test_job_graph_core.py`: 25 tests — `@AC-5` backoff bounds and sequence, `@AC-6` permanent
  classification, `@AC-7` transient default (six exception types incl. `DbBudgetExceeded`), non-outcome
  returns, the registry (DAG passes; two-kind cycle, self-edge, unregistered child, three-cycle raise),
  `validate_wait_on` (dedup, sort, higher lane, five named failures), empty verdict, `truncate_error`
  on a multi-byte string, prune identity.
- TDD: red — collection failed (`cannot import name 'MAX_CHILDREN_PER_PARK'`) before Step 9's code;
  green — 25 passed; full suite 2090 passed, coverage 92.34%; ruff clean; no local fixture (C-13).
- Files modified: `services/xstockstrat-analysis/tests/test_job_graph_core.py`.
- Deviations: none.
