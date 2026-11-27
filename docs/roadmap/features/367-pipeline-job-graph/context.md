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
