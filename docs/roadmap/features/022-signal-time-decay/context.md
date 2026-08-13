# Context: signal-time-decay

**Feature**: `docs/roadmap/features/022-signal-time-decay/feature.md`
**Product Spec**: `docs/roadmap/features/022-signal-time-decay/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/022-signal-time-decay/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 022.
- No proto or schema changes. Single config key + analysis scoring loop change.
- Key design decision captured: use `ingested_at` (not source publication time) as age reference.
- Two open questions deferred to /sdd-spec: age reference confirmation, and whether to add a max-age floor to drop ancient signals entirely.

## Session 2026-08-13T00:20:00Z — sdd-review product-spec (round 1, FAIL)

- `/sdd-review signal-time-decay product-spec` returned FAIL:
  - C-14 blocker: no `## Consumer Surface(s)` section at all — this dormant spec predates that
    template requirement (it was written 2026-05-26, before `130-signal-source-reliability-weight`
    established the current pattern for this scoring pipeline).
  - P-03 blocker: both Open Questions were unresolved `- [ ]` items ("confirm at impl-spec time" /
    "decision deferred to impl-spec") rather than settled or explicitly routed to a design-phase
    fork.
- No files were modified per the review-gate's FAIL rule (feature stayed `draft`).

## Session 2026-08-13T00:25:00Z — fix + re-review prep

- Added `## Consumer Surface(s)` to product-spec.md: `/insights` UI, grounded by direct code read
  (not inferred) — `BacktestDiagnostics.tsx:153` renders `bar.conviction` per row, which is
  downstream of the `signal_score` this feature decays (`combine_score()`'s input); second-order,
  `StrategyScore.overall_score`/`rating` (`analysis.proto:170,172`) on the same strategy detail
  page reflects the resulting entry/exit decisions via feature 065's evidence aggregation.
- Resolved OQ1: `ingested_at` — checked off, since FR-4 already committed to this; the question was
  closed, not actually open.
- Resolved OQ2: no max-age floor in V1 — checked off with rationale (exponential decay is
  self-limiting; a floor is a DB-query-perf optimization, not a correctness requirement; named as a
  future follow-up against ingest's signal-retention story if it's ever needed, not silently
  dropped). Added a corresponding line to `## Out of Scope` for consistency.
- This is a design decision made without a live human sign-off on OQ2 specifically (OQ1 merely
  restates an already-committed FR). Surfaced to the user in the session response rather than
  left implicit only in this file.
