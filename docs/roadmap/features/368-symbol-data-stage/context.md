# Context: symbol-data-stage

**Feature**: `docs/roadmap/features/368-symbol-data-stage/feature.md`
**Product Spec**: `docs/roadmap/features/368-symbol-data-stage/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/368-symbol-data-stage/implementation-spec.md`

---

## Session 2026-11-28T04:30Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Program context: `docs/roadmap/program-job-graph-analysis-pipeline.md`. This is feature 2 of 9.
  Prerequisite 367 `pipeline-job-graph` is on `main-dev` (`bc497728`, `code-completed`).
- Tree: ccr-d10c1761-fxpr1d ≡ origin/main-dev@bc497728 (0 ahead, 0 behind at story time).
- Operator decisions that bind this feature (program plan): D-1, D-2, D-6, D-11, D-13.
- **OPERATOR DECISION (fundamentals scope): "Also make EDGAR primary"** — FR-7. Rejected:
  staleness refresh on whatever provider is configured; deferring fundamentals to program feature 6.
- **OPERATOR DECISION (activation): "On by default"** — `analysis.pipeline.data_stage_enabled`
  defaults to `true` (FR-11).
- **OPERATOR DECISION (consumer surface): "None, internal only"** — C-14 box "None"; the
  user-facing view is deferred to the named follow-up `pipeline-cutover`.
- **OPERATOR DECISION (sequencing): "Stories now, then design 2 before 3"** — both stories are
  written and reviewed first; this feature is designed and specced before 369
  `strategy-eval-projection`, which is designed against this feature's approved seam. Full debate
  mode for both.
- Author inferences, not operator statements (to be tested at `/sdd-review` and `/sdd-design`):
  - "EDGAR primary" is read as changing the default of `marketdata.fundamentals.snapshot_source`
    from `vendor` to `edgar`, with the existing vendor fallback for non-filers.
  - The data job is per symbol across users, not per (user, symbol), per the program row.
  - The lane of a symbol is `held` if any user holds it.
  - Fundamentals staleness uses marketdata's existing freshness window (`edgar.cache_ttl_hours`,
    24); no new staleness key.
- Recon facts recorded for the design (unverified digests, re-ground in Phase 0):
  - No Python trading calendar; Go only (`packages/proto/marketsession`).
  - Backfill RPCs are on ingest; hole detection and `GetDataCoverage` are on marketdata.
  - 367 has no generic periodic-job API and no verdict enum.
  - Owner-level universe drains are duplicated in `live_loop.py` and `servicer.py`.
- Known traps from the ledger: feature 129 literal-key audit on a provider change; the feature-100
  bool zero-value trap; fix-python-loop-supervision (a transient allow-list misused as a classifier).

## Session 2026-11-28T04:50Z — sdd-review product-spec (FAIL, round 1)

- Tree: ccr-d10c1761-fxpr1d@ad8df6ef = origin/main-dev@bc497728 plus one docs-only commit.
  Deviation from `docs/sdd/tree-freshness.md`: the tree was not switched to `main-dev`, because
  the feature directory exists only on the harness branch until its docs PR merges.
- Overlap: CLEAN. Analysis `032` and config `062` are free. Feature 320 only records
  `snapshot_source` in a verification step. Recommended merge-order row: 368 after 367.
- Criteria: FAIL on criterion 6 (marketdata key had no reader `path:symbol`; stored forms not
  stated) and criterion 8 (`@AC-19` Then was an implementation step). No Floor breach.
- Fact found by the review and confirmed live through the agent `get_config` tool: both staging
  deployments (DigitalOcean, homelab) hold `fundamentals.snapshot_source` = `edgar`; migration 030
  seeded `vendor` and the repo inventory shows production still on it.
- **OPERATOR DECISION (EDGAR rows): "Default only, I flip production"** — FR-7 changes the code
  default and the seeded `default_value` only. No stored `value_data` is changed. Rejected:
  migrating `vendor` rows to `edgar`.
- **OPERATOR OVERRIDE: "I override the design rounds cap. Getting a sound high quality design is
  more important."** — the 5-round hard cap of `/sdd-design` does not apply to this feature. The
  no-progress detector and the approval gate still apply.
- Fixed after the review: FR-1 cap removed (sizing moved to Design Constraints); FR-3 window made a
  design output; FR-5 covers `SKIPPED` (author inference: same `no_vendor_data` verdict) and drops
  the waiting-job clause (owned by 369); FR-7 rewritten; config section states stored keys and both
  readers; proto box ticked "undecided, additive only"; migration run order stated; `@AC-8`,
  `@AC-10`, `@AC-13`, `@AC-19` reworded (IDs unchanged); `@AC-21` to `@AC-23` added.

## Session 2026-11-28T05:05Z — sdd-review product-spec (round 2)

- Product spec approved. Status: draft → spec-ready.
- Warnings: advisory scenario wording and accessor naming, fixed in the spec after the verdict.
- Overlap findings: none (round-1 scan reused; only this program's two feature directories changed).
- Recommended design depth: full (DB migration, 5 affected services, changed default on a shared key).
- Pending operator confirmation (shared file, not yet written): a `merge-order.md` row
  `symbol-data-stage` (368) after `pipeline-job-graph` (367).

## Session 2026-11-28T05:40Z — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (services: analysis, marketdata, ingest, portfolio, config). Tree:
  ccr-d10c1761-fxpr1d@f3183664 = origin/main-dev@bc497728 + docs-only commits (same deviation from
  `docs/sdd/tree-freshness.md` as the review: the feature directory exists only on the harness branch).
- Mode: full; round cap lifted (operator override above).
- Recon findings that reach the product spec, to be settled in the debate and put to the operator:
  - No cross-user positions or signals read and no system-callable user list; the only background
    owner list is `analysis.strategies` (FR-1 says "every user").
  - A parent blocked by a child verdict never runs again, so it cannot write the `no_vendor_data`
    coverage record (FR-5, FR-8 vs 367 `@AC-9`).
  - Ingest outcomes `INCOMPLETE`, `FAILED`, `CANCELED` have no mapping in FR-5.
  - No identity lets a job with no end user call ingest `TriggerBackfill`; a grant would change
    343 `@AC-15` (C-16 CHANGE, operator sign-off).
  - On the EDGAR axis a fundamentals read never fetches new filings; FR-6 needs a mechanism.
  - Twelve durable marketdata scenarios (255, 340, 254) rely on the `vendor` default without naming
    the key (FR-7, C-16).
  - No RPC exposes the trading calendar; closures after 2025-01-09 and early closes are not modelled.

## Session 2026-11-28T06:20Z — sdd-design round 1

- Round 1 run (proposer, adversary, synthesis). Register: 8 decisions, 5 rejected alternatives, 18
  objections (9 blocking), no petitions. No Floor breach. No certain C-16 regression; at risk: the
  feature 356 drain scenarios (O-16).
- Settled skeleton: universe job → data job per symbol → at most one backfill child; the data job
  alone decides the verdict (D-1, D-2); additive marketdata RPC for the last closed session (D-4).
- Approval is not selectable after round 1 (full mode). Product-level forks go to the operator at
  this gate: users without strategies, system-scope signals, run timing, backfill path, interior
  vendor holes, new-filings refresh, and the C-16 CHANGE for twelve vendor-default scenarios.

## Session 2026-11-28T06:40Z — sdd-design gate after round 1

- **OPERATOR DECISION (backfill path): "Call marketdata BackfillBars directly"** — D-9. The backfill
  child calls marketdata synchronously; ingest is out of the bar path. Rejected: self-serve under an
  owner's identity (R-6); a system grant in ingest (R-7).
- **OPERATOR DECISION (vendor holes): "Covered once the vendor confirmed the hole"** — D-10. Amends
  FR-3 and FR-5; the exact spec text is still to be shown to the operator before it is applied.
- **OPERATOR DECISION (run timing): "After the close, with a final-bar refetch"** — D-11. New
  config key for the delay (proposed default 30 minutes). Rejected: after New York midnight (R-8).
- **OPERATOR DECISION (new filings): "Also fetch new filings"** — D-12. Widens FR-6; adds a
  fundamentals backfill path to this feature. Rejected: re-derive only (R-12).
- **OPERATOR DECISION (users): "Strategy owners only"** — D-13. Narrows FR-1's "every user".
- **OPERATOR DECISION (system signals): "Include them"** — D-14.
- **OPERATOR SIGN-OFF (C-16 CHANGE): "Yes, pin them to vendor"** — D-15. Twelve promoted marketdata
  scenarios (255 `@AC-1,2,3,5,6,9`; 340 `@AC-2,4`; 254 `@AC-1,2,5,7`) gain an explicit Given
  `snapshot_source is "vendor"`; outcomes unchanged.
- **OPERATOR DECISION (gate): "Run rounds until sound"** — standing choice of *Run another round*
  while rounds make progress, each with a different lens; return at the approval gate or when a
  round needs a product decision or a spec change. The approval gate itself is never skipped.
- Pending: product-spec.md and acceptance.feature amendments for D-9 to D-14 (FR-1, FR-3, FR-4,
  FR-5, FR-6, Affected Services, Config Key Changes). To be drafted when the design converges and
  shown to the operator as exact text before being applied.

## Session 2026-11-28T07:30Z — sdd-design round 2

- Round 2 run (lens: code-claim verification and a failure/timing walk). Register: +13 decisions
  (D-16 to D-28), +1 rejected (R-13), 9 objections closed, 12 raised (O-19 to O-30; O-19 raised and
  closed in the round), 2 petitions pending the operator (P-1 on D-1, P-2 on D-9). No Floor breach.
  No un-petitioned register violation.
- Open after the round: O-1 (drift measurement), O-4 (pending P-1), O-7 (non-filer cost), O-18
  (seam: run-done query), O-20 to O-30.
- Needs the operator: P-1, P-2, the meaning of the fundamentals state (O-22), and whether the
  730-day window is a fixed invariant (O-24).

## Session 2026-11-28T07:50Z — sdd-design gate after round 2

- **OPERATOR REOPEN P-1 (D-1): "shards of 500"** — D-29. Universe job → shards of at most 500 →
  data jobs. Rejected: one level with a 10,000-symbol hard limit (R-15).
- **OPERATOR REOPEN P-2 (D-9, child clause): "fetch inline"** — D-30. The data job calls marketdata
  `BackfillBars` itself; no fetch child. Rejected: a child under every data job (R-14).
- **OPERATOR DECISION (fundamentals state): "Stored filings"** — D-31. The stage never calls the
  snapshot RPC; `@AC-12` is to be amended. Rejected: the served snapshot (R-16).
- **OPERATOR SIGN-OFF (window): "Fixed 730 days"** — D-32, a fixed invariant. Rejected: following
  `analysis.backtest.max_range_days` (R-17).
- Author call, not an operator statement (D-22): only the current last closed session gets a run;
  a missed session is not run later and its bars are filled by the next run. To be confirmed at
  the approval gate.
- Standing gate choice still applies: run further rounds while they make progress.

## Session 2026-11-28T08:40Z — sdd-design round 3

- Round 3 run on the consolidated design (lenses: spec author, test writer, operator on a bad day,
  numeric sweep). Register: +8 decisions (D-33 to D-40), 7 objections closed, 8 raised (O-31 to
  O-38). No Floor breach, no register violation, no C-16 regression.
- Open: O-7/O-36 (ledger volume sign-off), O-20, O-21 (fundamentals values, pending sign-off),
  O-28 (finality is unmeasured at runtime), O-31 (run gate must be fixed per run), O-32 (outage
  loses the session), O-33 (a daily-failing symbol blocks the run every day), O-34 (fundamentals
  checks bunch), O-35, O-37, O-38.
- Needs the operator before round 4: outage recovery (O-32), the failing-symbol policy (O-33,
  touches `@AC-10`), ledger volume (O-36), fundamentals cadence values (O-20, O-21, O-34).

## Session 2026-11-28T09:00Z — sdd-design gate after round 3

- **OPERATOR DECISION (outage): "Automatic retry passes"** — D-41. Rejected: manual requeue only (R-18).
- **OPERATOR DECISION (failing symbol): "Record 'fetch_failed', job succeeds"** — D-42. Third bar
  verdict; amends FR-5 and `@AC-10` (exact text still to be shown). Rejected: dead-letter (R-19).
- **OPERATOR DECISION (ledger volume): "Suppress for stage calls"** — D-43. Marketdata gains a
  behaviour change in this feature; the mechanism is a design output. Rejected: accept the events (R-20).
- **OPERATOR SIGN-OFF (filings cadence): "Sign as proposed"** — D-44. Fixed invariants 190 / 105 /
  7 / 28 days and a per-symbol weekday spread. Rejected: config keys (R-21).
- Open for round 4: O-28 (finality unmeasured at runtime), O-31, O-32 (mechanism for D-41), O-33
  (mechanism for D-42), O-35, O-37, O-38.

## Session 2026-11-28T10:10Z — sdd-design round 4

- Round 4 run on the revised consolidated design (lenses: run state machine, concurrent writers,
  ledger-suppression mechanism, scope). Adversary verdict: approvable with text fixes plus one
  mechanism choice. Register: +10 decisions (D-45 to D-54), 6 objections closed, 4 raised (O-39 to
  O-42), 2 petitions pending the operator (P-3 on D-16, P-4 on D-38). No Floor breach, no C-16
  regression. Scope check against the fix-ingest-seeded-config-keys ledger rule: every widening was
  an explicit operator decision at a gate.
- Open: O-28 (operator waiver), O-39 (slow-outage bound: mechanism choice), O-40, O-41, O-42 (text).

## Session 2026-11-28T10:30Z — sdd-design gate after round 4

- **OPERATOR DECISION (slow outage): "Per-pass time budget"** — D-55. Rejected: an in-memory
  breaker (R-22); no bound (R-23).
- **OPERATOR REOPEN P-3 (D-16): "session-S fetch first"** — D-56.
- **OPERATOR REOPEN P-4 (D-38): "done_at on the run row"** — D-57.
- **OPERATOR DECISION (finality risk O-28): "Require an automated check"** — D-58. The manual
  comparison alone is rejected (R-24). O-28 stays open until the check is designed; it adds a job
  kind, a comparison store and an alert path to this feature.
- Open for round 5: O-28 (design of the automated check), O-40, O-41, O-42 (text).

## Session 2026-11-28T11:20Z — sdd-design round 5 and its gate

- Round 5 run on the final consolidated design (lenses: register-diff audit, the automated finality
  check, the pass budget, a last spec-author pass). Adversary verdict: sound, approvable with text
  fixes; no further design round. Register: D-59 to D-62 settled in the round, R-25 locked, O-40 and
  O-41 closed. No Floor breach, no C-16 regression, no rejected alternative reintroduced.
- **OPERATOR DECISION (drift alert): "Metric + documented Grafana rule"** — D-63. Rejected: an
  untargeted notify alert (R-26); an alert targeted at each admin (R-27).
- **OPERATOR SIGN-OFF (finality constants): "Sign as fixed invariants"** — D-64.
- **OPERATOR DECISION (requeue rule): "Accept"** — D-65.
- Correction of record: the round-5 proposal said the operator had asked for an "admins only"
  alert. The operator's words on D-58 were "Require an automated check"; the audience was decided
  only now (D-63).
- All 42 objections are closed. Next: write design.md from the register with the round-5 text
  fixes, show the operator the exact spec amendments, then the approval gate.

## Session 2026-11-28T12:10Z — sdd-design, design.md written (approval pending)

- design.md written from the register with the round-5 text fixes, then checked on disk by a
  verification pass: register-diff clean, all 14 text fixes present, 17 text defects found (8
  major, none a Floor breach) and applied.
- Proposed amendments written to product-spec.md (FR-1 to FR-14) and acceptance.feature
  (`@AC-1` to `@AC-66`, `@AC-49` unused; 16 existing scenarios amended, 42 added). They are
  proposed text until the operator approves the design; the pre-amendment versions are in git
  (commit `ce488d6d` and earlier).
- Author addition, not an operator statement: retry passes, the pass budget and run completion are
  stated as a new FR-14 rather than folded into FR-5 and FR-10.
- Still to confirm at the approval gate: the implementation constants as one sign-off item
  (design.md § 12); D-22's rule that a missed session gets no run; the `merge-order.md` rows
  (368 after 367, 369 after 368).

## Session 2026-11-28T12:40Z — sdd-design (approved)

- **OPERATOR DECISION (design gate): "Approve design"** after round 5 and the on-disk verification.
- **OPERATOR SIGN-OFF (implementation constants): "Sign as fixed invariants"** — D-66.
- **OPERATOR DECISION (missed session): "Confirm: no catch-up run"** — D-67. Rejected: running
  missed sessions on recovery (R-28).
- **OPERATOR DECISION (merge order): "Add both rows"** — `docs/roadmap/features/merge-order.md`
  gains "368 after 367" and "369 after 368".
- Phase 0 Recon: wrote recon.md (services: analysis, marketdata, ingest, portfolio, config; key
  reuse patterns: the `_ensure_prune` shape, `GetDataCoverage` gaps, the 061 seed shape).
- Phase 1 Grilling: 5 rounds (full). Chosen approach: a run row per session with up to 4 passes of
  universe job → shards of 500 → one data job per symbol; the data job fetches the session bar and
  unconfirmed history through marketdata `BackfillBars` and writes holes, coverage and the bar
  record in one transaction; filings on a per-symbol schedule; a next-morning finality check on a
  sample of 50. Rejected: ingest in the bar path, a fetch child, an outage breaker, a notify alert,
  a Python calendar (28 locked alternatives in debate.md).
- Constitution rules touched: C-03, C-04, C-05, C-07, C-08, C-09, C-10, C-11, C-13, C-14, C-15,
  C-16, C-18, P-01 to P-06, F-01, F-04, F-06, F-07, F-11. Floor breaches: none in any round.
- C-16: one signed CHANGE (twelve marketdata scenarios pinned to `vendor`, D-15).
- Product spec and acceptance scenarios amended as shown to the operator at the gate: FR-1 to
  FR-14; `@AC-1` to `@AC-66` (`@AC-49` unused). Affected services are now analysis, marketdata and
  config; ingest and portfolio are read without code change.
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- Vendor finality is measured on a daily sample, not proven — staging verification step.
- The Grafana drift rule must be created at launch — docs step and launch checklist.
- Throughput ceiling on the slowest vendor plan; shared vendor budget — measured in 369's shadow run.
- `BackfillFundamentals` duration unmeasured — staging verification step.
- Deploy order: marketdata before analysis, or captured bars are NULL — spec must state it.
- Missed session, abandoned run, missed finality check — 369's design must tolerate them.

## Session 2026-11-28T09:30Z — sdd-spec

- Generated implementation-spec.md with 30 steps. Status → implementation-ready. Timestamp is the
  system clock at write time.
- Tree: ccr-d10c1761-fxpr1d@b37b95de = origin/main-dev@bc497728 plus docs-only commits.
  `origin/main-dev` is one docs-only commit ahead (`df9532c8`); it was not merged. Same deviation
  from `docs/sdd/tree-freshness.md` as the earlier phases (the feature directory exists only on the
  harness branch). No source file differs from `origin/main-dev`.
- Discovery was done inline (no `codebase-discovery` subagents): recon.md's map was reused and only
  what it did not cover was searched.
- Step order: proto (1-2), marketdata (3-9), config and reader (10-12), analysis `032` (13), seams
  (14-17), job kinds (18-25), ensure (26-27), wiring (28-29), docs (30). Three atomic units:
  Steps 1+2, Steps 7+8, Steps 10+11+12.
- Key codebase findings:
  - Next numbers: config `062` (`061_analysis_pipeline_keys` is the latest), analysis `032`
    (`031_pipeline_job_graph` is the latest).
  - `scripts/migration-rerun.py:1114` hard-codes the analysis tip `31`; Step 13 changes it.
  - `tests/test_config_read_classification.py:62-66` (`FR3_KEYS`) and
    `tests/test_config_zero_clamps.py:70-74` (`AC6_ROWS`) must gain
    `pipeline.data_stage_delay_minutes` (Step 12).
  - The marketdata `BackfillBars` handler wraps every service error as `Internal`
    (`internal/handler/marketdata_handler.go:124-127`), so the `return_bars` 7-day cap is checked in
    the handler beside `symbols required` (spec decision S-6).
  - Probe, reverted: flipping `snapshotSource()`'s default alone panics the `internal/service` test
    package at `TestFundamentals_ProviderFollowsLiveConfig_AC7`; the code flip and the test pins are
    one unit. The shared builder to pin is `enabledCfg` (`marketdata_service_test.go:340`, 32 call
    sites).
  - Probe, reverted: flipping only the stored `default_value` of `fundamentals.snapshot_source` in
    `scripts/config-wiring-stored.json` keeps `check-config-wiring.mjs --final` at exit 0, so the
    code default (Step 7) and the seeded default (Step 10) may land in separate commits.
  - `FakeJobRepo` has no `list_by_run`; `BoundedTxn` has no `executemany`; the handler contract
    forbids `db_pool` names and an `asyncio.timeout` around a `.db(` block in `app/jobs/`.
  - No descriptor-parity guard covers `Bar`, `BackfillBarsRequest` or `BackfillBarsResponse`.
  - `buf` is not installed in this sandbox; `xstockstrat-config` has no `node_modules`.
- Spec-time decisions (implementation-spec.md § Spec-time decisions, S-1 to S-12), each open to
  challenge at `/sdd-review impl-spec`: kind names and key helpers live in
  `app/jobs/data_stage.py`; a `DataStageRuns` class holds the run-row statements so the ensure can
  be tested on a virtual clock; `GetLastClosedSession` with no `as_of` uses the server time; a woken
  universe or shard job returns `Succeeded`; `timeout` is passed to a stub only when set.
- Open points for the operator (not decided):
  - O-1: the stored description of `fundamentals.snapshot_source` will still say "fail-safe to
    vendor" after the code default changes. Default in the spec: leave it (design § 13 changes
    `default_value` only).
  - O-2: `feature/symbol-data-stage` does not exist on `origin` yet; the proto verification
    compares against it.
- Launch checklist items that are not steps: the 3-session staging verification (design § 9.7) and
  creating the Grafana drift rule.

## Session 2026-11-28T13:40Z — sdd-review impl-spec (advisory, round 1)

- Result: 10 failures (one defect repeated), 14 warnings (advisory — did not block). No Floor risk.
  Citations sampled in every step resolved; every new file is marked as created.
- Unresolved ✗ / ⚠ carried into execution:
  - Steps 3, 5, 14, 16, 18, 20, 22, 24, 26, 28: each service step precedes its test step with no
    `**Lands with**`, so the test's RED cannot be captured (P-06, C-08; ledger 2026-11-04
    enforce-config-key-wiring) — [ ] unaddressed
  - Step 22 (data job, 12 instruction items) and Step 23 (about 40 cases) are too large for one
    unit; Step 18 combines universe job, shard job, retention and the snapshot writer (C-18) — [ ] unaddressed
  - Step 8: Files omit the sibling marketdata test files that use `enabledCfg` / `fakeCfg`
    (`backfill_outcome_test.go`, `bar_hold_test.go`, `bars_miss_test.go`, `etf_flags_test.go`) (F-08) — [ ] unaddressed
  - Step 2: Files lists directories, not files — [ ] unaddressed
  - Steps 4, 6, 8: `GOWORK=off` is set on a variable assignment and not on the `go` commands — [ ] unaddressed
  - Step 26: defaults of `now` / `monotonic` on `DataStageEnsure` unstated; Step 28 passes four
    positional arguments — [ ] unaddressed
  - Step 29: the header-guard test drives only the universe handler; the data job's marketdata
    calls carry two internal-caller values and are not held to the guard — [ ] unaddressed
  - Step 30: `docs/patterns/inter-service-mtls.md` (marketdata grant list) not updated for the
    `BackfillBars.ledger_quiet` grant (C-10) — [ ] unaddressed
  - Steps 10, 12: need a database (stored-set regeneration) and `pnpm install`; blocked per P-03
    if neither is available at execute — [ ] unaddressed (environment, not a spec defect)
- Overlap findings: no FAIL-level collision. Analysis `032`, config `062`, `BackfillBarsRequest` 6
  and `BackfillBarsResponse` 5 are free. Shared files to sequence at merge:
  `scripts/config-wiring-stored.json` and `docs/patterns/config-governance.md` (330, 345, 322);
  `services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature` `@AC-1`,
  `@AC-2` (320 amends the same scenarios); `packages/proto/marketdata/v1/marketdata.proto` (322, a
  different message). `origin/main-dev` gained `df9532c8` and `2d802133` (SSO code in ui, agent,
  identity; feature 370): no file 368 touches.
- Open points from `/sdd-spec` for the operator: O-1 (the stored description of
  `fundamentals.snapshot_source` still says "fail-safe to vendor"); O-2 (`feature/symbol-data-stage`
  is created by `/sdd-execute`).
