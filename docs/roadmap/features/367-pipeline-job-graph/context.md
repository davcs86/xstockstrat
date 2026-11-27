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
    [ ] unaddressed: needs an operator ruling on the design wording.
  - S-7: one design gate test lands in Step 12, not before the engine — [ ] unaddressed: needs an
    operator ruling on the design's test list.
- Overlap findings: config migration `060` is claimed by both 367 and 345 (`authelia-sso`); no
  `merge-order.md` row exists — [ ] unaddressed: needs operator confirmation to write the row.
  All other overlaps are clean or rebase-only.
