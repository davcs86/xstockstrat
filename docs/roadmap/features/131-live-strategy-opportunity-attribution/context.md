# Context: live-strategy-opportunity-attribution

**Feature**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/feature.md`
**Product Spec**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/implementation-spec.md`

---

## Session 2026-08-13T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 131 (created immediately after 130-signal-source-reliability-weight in
  the same session — recomputed `max(NNN)+1` fresh before this directory, not reused from a stale
  count).
- Story originated from conversational design-scouting. The user's initial framing — "all symbols
  are evaluated against all live strategies in the live loop" — was corrected during scouting:
  `strategy_symbols()` (`live_loop.py:37-47`) shows each live-enabled strategy evaluates only its
  own explicit `signal_params.symbols` list; strategies with no symbols are skipped entirely. The
  product spec is written against the corrected mechanism, not the original framing.
- Confirmed by direct code read (not docs): `main.py` constructs `live_loop` and never hands the
  servicer a reference to it (`servicer._live_loop` does not exist, unlike
  `servicer._fundsignal_loop = fundsignal_loop` at `main.py:149`) — so reaching into the live loop's
  private in-memory state was ruled out as the FR-5 direction before design even started; an
  independent re-trace (mirroring the existing watchlist-attribution pattern) was chosen as the
  scoped approach instead. This is recorded as a design constraint in the spec (FR-5), not left for
  `/sdd-design` to rediscover.
- Confirmed no proto change is needed: `Opportunity.provenance` (`analysis.proto:458`) is already
  `repeated string`, so a new `"live_strategy"` origin tag needs no proto edit.
- Ledger checked (fails.md/insights.md): flagged the 023-position-sizing-engine
  ordinal-vs-cardinal `Opportunity.conviction` trap in Open Questions as a guardrail, though this
  feature does not touch the conviction formula itself.

## Session 2026-08-13T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS. Warnings: (1) both Open Questions remain unchecked —
  reviewer judged both legitimately deferred to `/sdd-design` rather than spec gaps, but recommends
  making OQ1's deferral as explicit as OQ2's phrasing already is; (2) FR-2's citation
  (`servicer.py:2144-2168`, labeled "attribution/trace step") covers only the attribution/provenance
  code — the actual `evaluate_conditions_traced` call is at `servicer.py:2205-2209`; tighten this
  citation at `/sdd-spec` time (C-01); (3) AC-2/AC-6 are qualitative rather than quantitative —
  acceptable per the criteria's WARN allowance, but design/spec phase should pin down exact test
  assertions.
- Overlap findings: none. Confirmed CLEAN against all 9 other active-status features scanned;
  `125-unified-symbol-page` shares `xstockstrat-analysis` and even reads `ListOpportunities`, but
  only as a read-only consumer — it never touches `_compute_opportunities` or `StrategiesRepository`.

## Session 2026-08-13T00:30:00Z — fix review warnings

- Fixed all three advisory warnings from the sdd-review pass:
  - FR-2's citation split into the correct two ranges: `servicer.py:2144-2168` now labeled
    specifically as the attribution/provenance-building step, with the actual
    `evaluator.evaluate_conditions_traced` call site cited separately at `servicer.py:2205-2209`.
  - AC-2 and AC-6 rewritten to be quantitative: AC-2 now states `passing_conditions`/
    `total_conditions` must reflect real evaluated leaves (not `0/0`) and `total_conditions` must
    equal the strategy's entry-rule leaf count exactly; AC-6 now states byte-identical
    `strategy_id`/`passing_conditions`/`total_conditions`/`provenance` before/after a live-loop
    restart, given unchanged market data.
  - OQ1 (the `023-position-sizing-engine` guardrail) reworded to explicitly say it's a guardrail
    check to carry into `/sdd-design` and re-confirm, not a decision to resolve now — mirrors OQ2's
    already-explicit "decide at `/sdd-design`" phrasing per the reviewer's suggestion.

## Session 2026-08-14T00:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis only; key reuse patterns:
  `watchlist_by_symbol`'s index shape, `strategy_symbols()`, `_add_provenance`/`_candidate`).
  Surfaced a nuance not in the product spec: `curated` classification is keyed on
  `is_watchlist`/`is_held`, not attribution — a held position with live-strategy coverage is
  *already* curated today, it just isn't traced. FR-6's real scope is narrower than its text implies
  (only changes outcomes for signal-only candidates).
- Phase 1 Grilling: started `quick` mode (1 mandated round); the mandated round found a real
  unbounded-cost bug (an under-bounded "step 1b" would inject fully-traced candidate rows for every
  symbol any live strategy watches, bypassing `max_universe_size` since `curated` rows are never
  truncated) plus scope creep (refactoring `live_loop.py`'s constructor/wiring for a one-line SQL
  predicate, outside the spec's stated blast radius). **User explicitly upgraded to full mode**
  ("run it in deep mode") rather than accept these as documented risks. Round 2 fixed both: bounded
  the new step to `signals_by_symbol.keys() & live_by_symbol.keys()` only, added per-strategy
  provenance checks (not blanket unions) to the watchlist/held loops, and adopted the safer fallback
  (servicer-only `list_live_enabled()`, `live_loop.py` left untouched). Round 3 closed a remaining
  ambiguity (predicate-parity mechanism — resolved as a shared constant, not a test, since a
  re-declared-string test would prove nothing about `live_loop.py`'s real query) plus two
  documentation-only items. A final verification pass (still round 3) caught two more real gaps by
  re-tracing the combined design against actual code rather than trusting the accumulated prose: a
  missing `_normalize_symbol()` call on `live_by_symbol`'s keys (would silently no-op for
  mixed-case-configured live strategies) and a test-helper (`_list_opps`) incompatible with FR-4's
  multi-strategy-per-symbol requirement. Both folded directly into `design.md` (adversary judged them
  mechanical, not architectural — no round 4 needed).
- Chosen approach: `StrategiesRepository.list_live_enabled()` (servicer-only), a shared
  `LIVE_ENABLED_PREDICATE_SQL` constant imported by both the new repo method and `live_loop.py`'s
  existing inline query (one-line touch, no constructor/wiring change), a new `live_by_symbol` index
  folded into the existing held/watchlist/signals loops via per-strategy provenance checks, bounded
  strictly to `signals_by_symbol.keys() & live_by_symbol.keys()` for the signal-only case. Rejected:
  the full shared-method refactor, pure duplication, a behavioral parity test, an unbounded step.
- Constitution rules touched: C-01, C-08, C-10(b), C-14, P-01, P-02, P-03 — all honored, no Floor
  breach at any round.
- Status: spec-ready → design-approved.
- **Process note**: this debate is a second consecutive case (after 130, same session) where a
  design that read as complete and responsive to the prior round's objection had a real, code-
  verifiable gap only a fresh re-trace against actual source caught — reinforces the
  `insights.md` 2026-08-13 entry rather than needing a new one.

## Session 2026-08-14T00:10:00Z — sdd-design round 4 (reopened by user)

- User asked to "run round 4" ambiguously right after 131's approval; clarified via
  `AskUserQuestion` — user meant reopening 131's already-approved debate for another round, not
  starting 022's design phase.
- Round 4 targeted the two Open Risks design.md had explicitly deferred to `/sdd-spec` rather than
  resolving ("check... not assumed safe" / "confirm at `/sdd-spec`"): insertion-order test fragility
  and the C-12 fixture obligation.
- Proposer resolved both by reading the actual test/UI code rather than reasoning abstractly: (1)
  every existing `TestListOpportunitiesMaterialized` assertion is set/membership/dict-key-based
  except one, whose order comes from an explicit downstream rank-sort decoupled from `candidates`
  dict build order — reorder is safe against the current suite. (2) initially closed C-12 via a
  `provenance`-grep (zero UI consumers) — adversary correctly pushed back that this didn't answer
  whether the UI reads the *other* three newly-populated fields (`strategy_id`/`passing_conditions`/
  `total_conditions`); re-verified and found the real answer: it does render them, but an *existing*
  e2e test (`opportunities.spec.ts:70-72`) already exercises that exact path with non-`0/0` fixture
  values, and the mock is provenance-blind either way — no new fixture needed.
- Adversary verdict: SOUND, with one correction (cite the existing e2e test, not just the grep) and
  one new spec-time note (the `_strat_row` test helper has no `signal_params` support — needed to
  write the new tests this feature requires at all; co-located with the existing `_list_opps`
  test-helper Open Risk as a shared prerequisite, not two independent fixes).
- `design.md` updated in place: two Open Risks marked resolved with full citation trails, `Rounds`
  updated to 4, the two genuinely-still-open risks (test-helper incompatibility, compute fan-out)
  left as-is — confirmed untouched by this round, not implicitly closed by proximity.
- Status: design-approved (unchanged) — round 4 didn't flip lifecycle, it strengthened the existing
  approval's evidence trail.
