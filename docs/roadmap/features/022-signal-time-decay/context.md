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

## Session 2026-08-13T00:35:00Z — sdd-review product-spec (round 2, FAIL — stale premise found)

- Re-review found the round-1 fix insufficient: the spec's **core premise was stale**, not just
  missing a section. FR-1 targeted "the analysis service scoring loop" — but feature 097
  (`servicer.py:326-331`) retired the signal-confidence blend from `RunBacktest` entirely before
  this dormant 2026-05-26 draft was ever implemented. `combine_score`/`compute_signal_score` only
  survive in `ScreenSymbols` (`screener.py:235,456`), not the backtest/live path FR-1 assumed. The
  Consumer Surface citation chain added in round 1 (`BarDiagnostic.conviction` /
  `StrategyScore.overall_score` via `combine_score`) was consequently code-false — each individual
  citation was real, but `combine_score` is never actually invoked on that path. FR-4 also assumed
  `signal.ingested_at` was available on `ExternalSignal`; it isn't (verified against
  `ingest.proto:106-116`), even though the underlying DB column exists.
- User asked, via `AskUserQuestion`: where should decay now apply, given the original target is
  gone? Options presented: Screener only / `Opportunity.signal_axis` / both / defer entirely into
  130's design phase. **User chose `Opportunity.signal_axis`** — the same expression
  `130-signal-source-reliability-weight` already targets (`servicer.py:2163`).
- Retargeted the spec accordingly:
  - FR-1 now decays `signal_axis`'s `sig.conviction` term directly, with an explicit coordination
    note that 130 and 022 both multiply into the same expression — whichever lands second rebases
    to include both terms.
  - FR-4 now specs the real gap: add `ExternalSignal.ingested_at` (proto field 10, next free after
    `tags=9`), select/populate it in `QuerySignals` — `xstockstrat-ingest` added to Affected
    Services and Proto Contract Changes updated (no longer "no proto changes required").
  - FR-5's backtest-determinism framing dropped (no backtest replay concept applies to a live
    queue compute) — replaced with same-compute-pass reference-timestamp consistency, grounded in
    the real `session_end_seconds` variable at `servicer.py:2179-2185`.
  - Consumer Surface rewritten to the real surface: the Opportunities queue's existing ranking
    display, no new BarDiagnostic/StrategyScore claim.
  - Acceptance Criteria rewritten against `signal_axis`/`QuerySignals`, not backtest scores.
  - Added a "Known trap" Open Question item (023-position-sizing-engine ordinal/cardinal
    conflation) since this feature now touches the same `signal_axis` neighborhood as that trap.
- Added a `docs/roadmap/features/merge-order.md` row: `signal-time-decay` (022) must wait for
  `signal-source-reliability-weight` (130) — same-expression overlap on `servicer.py:2163`, 130
  lands first (already `spec-ready`), 022 rebases the combined formula onto it.
- Re-running `/sdd-review signal-time-decay product-spec` next.
