# Context: strategy-eval-projection

**Feature**: `docs/roadmap/features/369-strategy-eval-projection/feature.md`
**Product Spec**: `docs/roadmap/features/369-strategy-eval-projection/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/369-strategy-eval-projection/implementation-spec.md`

---

## Session 2026-11-28T04:30Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Program context: `docs/roadmap/program-job-graph-analysis-pipeline.md`. This is feature 3 of 9.
  It depends on 368 `symbol-data-stage` (bar record, universe snapshot, coverage record) and on
  367 `pipeline-job-graph` (on `main-dev`, `bc497728`).
- Tree: ccr-d10c1761-fxpr1d ≡ origin/main-dev@bc497728 (0 ahead, 0 behind at story time).
- Operator decisions that bind this feature (program plan): D-2, D-3, D-4, D-5, D-7, D-10, D-12, D-13.
- **OPERATOR DECISION (read switch): "Legacy reads, switch at cutover"** — FR-8. The projection
  read path is built behind `analysis.projection.read_source`, default `legacy`. Rejected:
  switching reads in this feature; building no read path until cutover.
- **OPERATOR ANSWER (parity report surface), verbatim: "Could be in the logs? Otherwise, Agent MCP
  tool, user-scoped"** — FR-9. Author reading: logs and telemetry are the surface; the agent tool
  is the fallback only if `/sdd-design` shows logs cannot carry the report. C-14 box "None".
- **OPERATOR DECISION (outbox): "Outbox + dry-run dispatcher"** — FR-6, FR-7. Rejected: outbox rows
  with no dispatcher; delivering real ledger events in shadow.
- **OPERATOR DECISION (strategy set): "All active, parity on overlap"** — FR-2, FR-9. Rejected:
  live-enabled only; mirroring the legacy universe.
- **OPERATOR DECISION (sequencing): "Stories now, then design 2 before 3"** — this feature's design
  starts only after 368's design is approved.
- Author inferences, not operator statements:
  - `analysis.pipeline.evaluation_enabled` defaults to `true` (open question in product-spec.md).
  - The shadow path keeps its own position state and never touches `analysis.strategy_cooldowns` (FR-4).
  - `analysis.pipeline.outbox_delivery` is seeded now with the single value `suppress` so that
    cutover changes a value, not a schema. C-18 may challenge a one-value key at design.
  - A definition change is picked up at the next bar; targeted re-evaluation is program feature 5.
- Recon facts recorded for the design (unverified digests, re-ground in Phase 0):
  - Live-loop state is in memory (`_last_state`, throttle, cursor); `in_position` is rebuilt by replay.
  - `StrategyEvaluator` is shared and calls indicators per component, per strategy.
  - Analysis has no outbox; `notify.email_outbox` is the only outbox pattern in the repo.
  - 367 deferred to this feature: shadow-run measurements, hazards H1/H2, executor-thread handlers.
- Known traps from the ledger: C-10(b) parity across read paths; 2026-08-01 "a hand-maintained
  projection must be pinned by an executable parity test"; the feature-100 bool zero-value trap.

## Session 2026-11-28T04:50Z — sdd-review product-spec (FAIL, round 1)

- Tree: ccr-d10c1761-fxpr1d@ad8df6ef = origin/main-dev@bc497728 plus one docs-only commit.
  Deviation from `docs/sdd/tree-freshness.md`: the tree was not switched to `main-dev`, because
  the feature directory exists only on the harness branch until its docs PR merges.
- Overlap: CLEAN. Analysis `033` and config `063` are free and follow 368's `032` and `062`.
  Recommended merge-order row: 369 after 368.
- Criteria: FAIL on criterion 6 (`projection.read_source` had no reader symbol) and criterion 9
  (one unchecked Open Question). No Floor breach.
- **OPERATOR DECISION (evaluation default): "On by default"** — `analysis.pipeline.evaluation_enabled`
  defaults to `true`.
- **OPERATOR DECISION (parity surface reading): "Yes, logs unless design says no"** — confirms the
  author reading recorded at story time.
- **OPERATOR DECISION (outbox key): "Drop it, cutover adds it"** — `analysis.pipeline.outbox_delivery`
  removed from this feature; the dispatcher always suppresses (FR-7).
- **OPERATOR OVERRIDE: "I override the design rounds cap. Getting a sound high quality design is
  more important."** — the 5-round hard cap of `/sdd-design` does not apply to this feature. The
  no-progress detector and the approval gate still apply.
- Fixed after the review: config readers cited; FR-7, FR-9 and FR-12 tightened; `@AC-6`, `@AC-10`,
  `@AC-11`, `@AC-14`, `@AC-23` reworded (IDs unchanged); `@AC-24` to `@AC-29` added.

## Session 2026-11-28T05:05Z — sdd-review product-spec (round 2)

- Product spec approved. Status: draft → spec-ready.
- Warnings: advisory scenario wording and accessor naming, fixed in the spec after the verdict.
- Overlap findings: none (round-1 scan reused; only this program's two feature directories changed).
- Recommended design depth: full (DB migration, new effect path and read path, depends on 368).
- Pending operator confirmation (shared file, not yet written): a `merge-order.md` row
  `strategy-eval-projection` (369) after `symbol-data-stage` (368).

## Session 2026-11-28T14:30Z — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (services: analysis, config). Tree:
  ccr-d10c1761-fxpr1d@cfa6a43f = origin/main-dev@bc497728 + docs-only commits (same recorded
  deviation from `docs/sdd/tree-freshness.md`: the feature directory exists only on the harness branch).
- Mode: full; round cap lifted (operator override above).
- Input contract: feature 368's approved design (`design.md` § 17). It differs from what this
  feature's story assumed: bar records arrive over up to 4 passes; "run done" is `done_at`; a
  symbol can end `fetch_failed` or `no_vendor_data` with no bar record; users are strategy owners;
  a session can have no run.
- Recon findings that reach the product spec, to be settled in the debate and put to the operator:
  - The live loop records nothing per evaluated pair and evaluates the forming bar, so parity on
    transitions is observable only through cooldown rows or ledger events after the close (FR-9).
  - Legacy opportunities are universe membership for live-enabled strategies, with fields derived
    from signals, positions and grades; an evaluation row supplies only part of them (FR-8).
  - "Bars and built-in indicators computed once per job" has no existing mechanism; the evaluator
    makes one indicators call per component per strategy (FR-2).
  - Reading a year of bars for the whole universe marks it warm in marketdata (368 D-23, D-57).
  - The fundamentals guard and the blend-strategy universe restriction vs "every active strategy on
    every universe symbol" (FR-2).

## Session 2026-11-28T14:45Z — sdd-design, pre-debate gate

- **OPERATOR DECISION (read scope): "Readiness now, opportunities at cutover"** — D-1. Narrows FR-8
  to the two readiness RPCs. Rejected: both read paths here (R-1); no read path here (R-2).
- **OPERATOR DECISION (bar reads): "Add a non-warming bars read"** — D-2. Marketdata becomes an
  affected service with an additive proto change. Rejected: accept the warm set growing (R-3).
- **OPERATOR DECISION (parity source): "Observe only, no live-loop change"** — D-3. Rejected: a
  decision log in the live loop (R-4).
- Standing choice from 368 applies by analogy (author reading, to be confirmed at the first gate):
  run rounds while they make progress, each with a different lens, and return at the approval gate
  or when a round needs a product decision.

## Session 2026-11-28T15:40Z — sdd-design round 1

- Round 1 run (lenses: code-claim verification, operator on a bad day). Register: +9 decisions
  (D-4 to D-12), +4 rejected (R-5 to R-8), 18 objections raised (3 blocking: O-1 silent degradation
  made permanent, O-2 no recovery of a session after an outage, O-3 snapshot fundamentals read for
  the whole universe). No Floor breach, no register violation, no C-16 regression under `legacy`.
- Needs the operator: recovery after an outage (O-2), the result key (O-8, FR-3), point-in-time vs
  current fundamentals and sector (O-3, FR-5), the job grain (FR-1).
