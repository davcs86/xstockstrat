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
