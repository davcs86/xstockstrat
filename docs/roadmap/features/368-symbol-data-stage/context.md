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
