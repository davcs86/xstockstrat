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
