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
