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

## Session 2026-08-13T00:40:00Z — sdd-review product-spec (round 3, overlap findings)

- Overlap re-scan (round 3): the 022↔130 `merge-order.md` row is present and correctly shaped. New
  finding: `131-live-strategy-opportunity-attribution` (also `spec-ready`) restructures the same
  `_compute_opportunities` candidate-creation/signals-merge block (`servicer.py:2144-2168`) that
  contains the `signal_axis` line (`:2163`) 022/130 already coordinate on — a three-way
  same-function overlap, not previously recorded.
- Added a second `merge-order.md` row: 022 must also wait for 131, with a recommended landing
  order **130 → 131 → 022** (130's factor addition first since simplest/earliest spec-ready; 131's
  structural candidate-loop change next; 022's decay factor composes last on the combined
  expression). This row governs 022's ordering relative to 131 — 131 itself has no dependency here
  (confirmed clean in its own overlap scan).
- Criteria re-review (round 3) in progress; awaiting result.

## Session 2026-08-13T00:45:00Z — sdd-review product-spec (round 3, criteria FAIL — self-introduced bug)

- Criteria re-review (round 3) FAIL: my own round-2 fix introduced a genuine internal
  contradiction. FR-5 required the decay multiplier (written at FR-1's site, `servicer.py:2163`,
  inside the signals-merge loop `servicer.py:2152-2166`) to use `session_end_seconds` as its
  reference clock — but `session_end_seconds` is declared `= 0` at `servicer.py:2184`, inside a
  **later** per-candidate bar-fetch loop that runs after the signals-merge loop, and is a
  bars-derived running max (used only for `valid_until`), not a wall-clock timestamp at all. FR-1's
  write-site literally cannot read a variable that doesn't exist yet at that point in the function.
- Root cause: I pattern-matched the original 2026-05-26 spec's "determinism" concern (backtest
  window's `now` vs. wall clock) onto the wrong variable in the new target function, without
  tracing the actual order of operations in `_compute_opportunities` before citing it.
- Fixed: FR-5 rewritten to require a single `now_utc` read at the **start** of
  `_compute_opportunities` (a new local variable, not yet present in the function) reused for every
  signal's `age_hours` in that pass — explicitly distinguished from `session_end_seconds`. AC-3
  updated to match. Also fixed two advisory items from the same round: the "Known trap" Open
  Question item moved out of checklist (`- [ ]`) format since it's a guardrail note, not an
  unresolved decision (was tripping Criterion 9's literal checkbox rule); `feature.md`'s Summary and
  Reviewers table updated to match the retargeted spec (was still describing the pre-097 premise,
  flagged as stale/informational by the reviewer).
- Re-running `/sdd-review signal-time-decay product-spec` (round 4) next.

## Session 2026-08-13T00:50:00Z — sdd-review product-spec (round 4, FAIL — arithmetic error)

- Round 4 confirmed the FR-1/FR-5 contradiction is genuinely fixed (verified against
  `servicer.py:2083-2242`'s real control flow: `now_utc` read at the top of the function is in
  scope at the `:2163` write-site; `session_end_seconds` correctly identified as a distinct,
  later-declared variable). Overlap re-scan also clean — both merge-order rows still accurate.
- One new, previously-uncaught defect: AC-1's worked example was arithmetically wrong. "48 hours
  ago, 24-hour half-life → half the weight" is incorrect — two half-lives elapsed means
  `0.5^(48/24) = 0.25`, a quarter, not a half (contradicted AC-5's own correct `t=half_life ⇒ ≈0.5`
  statement in the same spec).
- Fixed: AC-1 now states the correct `0.25`/quarter result explicitly, with the exponent shown.
- Re-running `/sdd-review signal-time-decay product-spec` (round 5) next.

## Session 2026-08-13T00:55:00Z — sdd-review product-spec (round 5, PASS)

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS, zero blockers, zero warnings. Reviewer independently re-derived every
  Acceptance Criterion's arithmetic from FR-1's formula and re-traced `_compute_opportunities`'s
  real control flow line-by-line to re-confirm FR-1/FR-5 compatibility — both hold.
- Overlap verdict: CLEAN. Both `merge-order.md` coordination rows (022 waits for 130; 022 waits
  for 131) re-confirmed accurate against current trunk and current sibling-feature state.
- Five review rounds total this session, each catching a distinct real defect: (1) missing
  Consumer Surface + unresolved Open Questions, (2) a stale premise targeting code feature 097 had
  already retired, (3) an FR-1/FR-5 internal contradiction (a cited variable that didn't exist yet
  at the write-site), (4) an AC-1 arithmetic error. This is the pipeline working as designed — a
  dormant, unreviewed 2026-05-26 draft had accumulated all four defects silently; nothing caught
  them until this review pass actually ran.
- Next: `/sdd-spec signal-time-decay`, but only after `130-signal-source-reliability-weight` and
  `131-live-strategy-opportunity-attribution` land (merge-order.md dependency).
