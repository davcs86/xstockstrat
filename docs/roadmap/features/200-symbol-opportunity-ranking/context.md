# Context: symbol-opportunity-ranking

**Feature**: `docs/roadmap/features/200-symbol-opportunity-ranking/feature.md`
**Product Spec**: `docs/roadmap/features/200-symbol-opportunity-ranking/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/200-symbol-opportunity-ranking/implementation-spec.md`

---

## Session 2026-09-20 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.

### Why this feature exists (origin)

Split out of feature 199 (opportunity-composite-score). During 199's design the user confirmed their
real goal is **comparing which SYMBOL to trade**, with two concrete examples:
1. A symbol with 2 opportunities at 0.80 conviction + full readiness must rank ABOVE a symbol with 1
   opportunity at 1.00 conviction. → breadth/corroboration, NOT the current MAX-over-opportunities
   partition (`opportunities.py:35`) which ranks a symbol by its single best opportunity.
2. A symbol whose opportunity set includes `fundamental_macd_blend` must rank ABOVE a symbol with the
   same count but without it. → per-strategy weighting.

199 (per-opportunity composite) is necessary but NOT sufficient for symbol comparison, so 200 is the
symbol-level roll-up layer that consumes 199's `composite_score`.

### Decided design forks (operator answered before /sdd-story)

- **Vehicle**: new feature 200, layered on 199 (not expanding 199, not pivoting it).
- **Strategy weighting**: feature-065 derived grade (A–F → numeric) × operator per-strategy config
  override (default override 1.0).
- **Breadth aggregation**: diminishing-returns sum (2 moderate > 1 strong, with saturation so N weak
  do not run away). Exact saturating function is a design-phase decision (Open Question).

### Formula (shape)

`symbol_score = diminishing-returns-sum over the symbol's opportunities of (composite_score × strategy_weight)`,
`strategy_weight = grade_weight(feature-065 StrategyScore) × operator_override`.

### Ledger traps to carry (P-05)

- `fails.md:313`/`:418` — `symbol_score` is another ranking ordinal; must NEVER become a cardinal
  sizing/alert input. Extend feature-199's cardinal-guard invariant to `symbol_score`.
- Feature-190 MAX-partition sort (`opportunities.py:35`) is exactly what this replaces for symbol
  comparison; preserve the existing per-opportunity `conviction`/`expiry` sorts and the
  "client does not re-sort" guarantee (`@AC-15 @feature-190`) — a new default symbol ordering would be
  a CHANGE to `@AC-10 @feature-190` needing sign-off.
- `insights.md:543` (feature-097) — the opportunity path is lazy-materialize + valid_until +
  stale-while-revalidate + daily refresh; if `symbol_score` is persisted it rides that same path.

### Dependency / merge-order

Depends on **feature 199** (`Opportunity.composite_score` column + proto field). 199 is
`design-approved`, not merged. 200 must not merge before 199; both touch the analysis opportunity path
(soft rebase overlap with 199 and in-flight 187/193/188). Reserve migration NNN + proto field at
/sdd-spec against the merged tree.

### Consumer surfaces (C-14)

UI `/insights` (SymbolGroupCard orderable by symbol_score) + Agent (`list_opportunities` / symbol-compare projection).

## Session 2026-09-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Result: PASS WITH WARNINGS — 0 blockers.
- Warnings:
  1. Config key `analysis.scoring.strategy_weight_override.<strategy_id>` uses a non-standard 4-segment (dynamic-suffix) form — no 4-segment precedent in the analysis namespace (all ~40 keys are 3-segment). Already an Open Question; resolve at design (per-strategy dynamic keys vs one structured JSON value). (C-05)
  2. Migration up/down pairing (C-07) implied not restated in the conditional persisted branch — confirm at design if symbol_score is persisted.
- Overlap findings: no FAIL-class collision (200 has reserved no concrete field/migration/key yet). HARD merge-order dependency on 199 (consumes composite_score; buf breaking/golang-migrate can't see 199's uncommitted claims). Blocking row added to merge-order.md. Soft same-file rebase overlap on servicer.py _compute_opportunities, opportunities.py ORDER BY, insights/opportunities/page.tsx, agent list_opportunities — shared with 199/187/193/188.
- Verified against code: feature-065 _grade A-F at servicer.py:5174-5184 (strategy grade source real); current MAX-partition sort default at opportunities.py:35 (the behavior FR-2 replaces); composite_score does not yet exist in source (199 spec-only → merge-order dep confirmed).
- Fixed stale label: product-spec said 199 "design-approved" → now implementation-ready (both pre-merge).

## Session 2026-09-20 — sdd-design (IN-FLIGHT, PAUSED by operator — NOT approved)

- Operator stopped the debate after 3 rounds: "review the design and plan once 199 gets done."
  Status stays **spec-ready** (no design.md written, no lifecycle flip). Rationale: 200's key
  unknowns are post-199 facts (composite_score column shape, ANALYSIS-10, proto field/migration
  numbers) — resume round 4 + write design.md against the MERGED 199 tree, not 199's spec text.
- Phase 0 Recon: recon.md written (committed). Phase 1 Grilling: rounds 1-3 run, verdict SOUND /
  APPROVABLE (no Floor breach) — but NOT approved (paused before the gate).

### Converged design so far (resume from here — do NOT re-derive)

- **Roll-up**: symbol_score computed app-side in `_compute_opportunities` after the candidates dict
  (servicer.py:3962), one scalar per symbol group stamped on every row; persisted per-row column.
- **Fold (UNBOUNDED, operator decision)**: `symbol_score = Σ_i γ^i · t_(i)`, terms `t = composite_score
  × strategy_weight` sorted DESC, `γ = analysis.scoring.symbol_score_decay` (0.5). NULL composite →
  term skipped; no surviving term → symbol_score NULL. Raw unbounded scalar (can exceed 1.0).
- **strategy_weight** = `affine(overall_score) × override`, `affine(x) = floor + (1-floor)·x`,
  `floor = analysis.scoring.strategy_weight_floor` (0.5). Grade from `self._strategies.get(strategy_id)`
  ∩ owned ids (servicer.py:2260,2273). **Provisional/absent/unattributed → floor (0.5) = proven
  grade-F** (operator decision; drops the separate provisional_weight key; unproven can never outrank
  an evidenced strategy). Overrides = one structured JSON value `analysis.scoring.strategy_weight_overrides`
  (malformed → ignored, never crash). **SUPERSEDED at round-4 design (2026-09-21): the override moved onto the strategy entity (`StrategyDefinition.rank_weight_override`), not a config blob — see design.md.**
- **Sort**: opt-in `OPPORTUNITY_SORT_SYMBOL_SCORE = 3` (analysis.proto:541) → `_SORT_ORDER_BY[3] =
  MAX(o.symbol_score) OVER (PARTITION BY o.symbol) DESC NULLS LAST, o.symbol ASC, o.opportunity_key ASC`
  (opportunities.py:33). Default stays CONVICTION (no @AC-10 CHANGE, no sign-off).
- **Surfaces**: per-row `Opportunity.symbol_score` field (next-free after 199's composite_score=21 →
  22, re-derive vs merged tree); UI = plain 3-decimal number (NOT scoreColor — unbounded), rendered
  only under the server-applied symbol_score sort; agent = raw float via _opportunity_to_dict + omit on
  NULL + descriptor-parity. Migration 025 (after 199's 024, re-derive).
- **Cardinal guard**: feature-199's composite guard landed as **ANALYSIS-11**, so 200 adds a companion
  **ANALYSIS-12** for symbol_score + a symbol_score proto doc-comment
  ("unbounded ordinal RANKING scalar … NOT a probability/expected-return/sizing input").
- **Heal (corrected, round 3)**: new disposition-free `OpportunitiesRepository.symbol_composite_terms
  (user_id, symbol)` (no opportunity_actions join / no valid_until / no floor) → re-fold the whole
  symbol via the SHARED `_symbol_score` helper (recovered rows' fresh composite + others' persisted)
  → `stamp_symbol_score(user_id, symbol, score)` symbol-wide UPDATE of ALL rows (NOT replace_symbols).
  Heal-parity test asserts against the RAW table (not read()) that every row incl. dismissed carries
  the identical score AND equals a full compute pass. Requeue-full-recompute rejected (latency +
  never-resurrect). Main compute already path-independent (candidates has no disposition filter).

### Mandatory acceptance orderings (worked, verified)

- @AC-2: AAPL 2×0.80 → 1.20 > MSFT 1×1.00 → 1.00 (flips legacy MAX). @AC-3: AAPL 2×0.80 → 1.20 >
  PENNY 6×0.30 → 0.591 (geometric cap 2×top-term). @AC-4: grade-A 0.919 > grade-C 0.814. @AC-7:
  floor 0.5 > 0 contributes; unproven never outranks evidenced. (@AC-9 to be updated to unbounded
  values 1.20/0.75 when design.md is written.)

## Post-199 sync (2026-09-21) — facts re-grounded against what feature 199 BUILT

Feature 199 (opportunity-composite-score) is `code-completed` (PR #1157). Re-grounded against the
landed code on this branch — these were the "resolve against the merged tree" unknowns:

- **composite_score is a real, queryable column.** `analysis.opportunities.composite_score`
  `DOUBLE PRECISION` NULL (migration `024`); `read()` SELECTs `o.composite_score`;
  `_row_to_opportunity` maps it (explicit presence). NOT in `readiness_json`. → 200's roll-up reads
  it straight off the row / `read()` — no JSONB extraction, no re-fold from readiness.
- **Reserved surface numbers (re-derived, confirmed free):** proto `Opportunity.symbol_score = 22`
  (after landed `composite_score = 21`); `OPPORTUNITY_SORT_SYMBOL_SCORE = 3` (OpportunitySort max = 2);
  analysis migration `025` (after landed `024`); invariant `ANALYSIS-12` (after landed `ANALYSIS-11`).
- **NULL-composite fold contract (nail it in the heal-parity test):** the main compute persists
  `composite_score = NULL` exactly when `Σw ≤ 0` (`_composite_score([...], k) is None`). 200's fold
  must **skip** a NULL-composite term (never coerce it to 0), so heal (persisted universe) and compute
  (candidates dict) agree. The composite fold anchors `best_direction` on RAW conviction; 200's
  strategy-weight layer is orthogonal to that and does not touch it.
- **Reusable fusion helpers 200 layers beside** (module-level in `servicer.py`):
  `_composite_score(scored, k)`, `_composite_signal_subscore(contribs, best_direction)`. 200's
  `_symbol_score` is a NEW helper (geometric rank-decay fold), not an extension of these.

**Still open for /sdd-design round 4** (design decisions, NOT facts about 199): the order-insensitive
fold internal sort, the concurrency mitigation (FOR-UPDATE-txn / advisory lock), the floor=0.5
collapse rationale, and the config-key names/read-semantics — see the checklist below.

## Open Threads (resolve at round 4)

- [x] **Post-199 coupling** — RESOLVED by the sync above: composite_score is a queryable column;
  proto field 22 / sort value 3 / migration 025 / ANALYSIS-12 re-derived and free.
- [x] **NULL-composite fold semantics** — RESOLVED: 199 persists NULL on `Σw ≤ 0`; 200's fold skips
  NULL terms (contract captured above for the heal-parity test).
- [ ] **Order-insensitive fold**: `_symbol_score` must sort terms internally so heal (persisted
  universe) and compute (candidates dict) are byte-identical regardless of input row order.
- [ ] **Concurrency residual** (adversary ruled acceptable/self-healing, NOT must-fix): decide at
  round 4 whether to MANDATE the FOR-UPDATE-txn / per-user advisory-lock mitigation or leave to /sdd-spec.
- [ ] **floor=0.5 collapses proven-grade-F and provisional** into one weight — record as deliberate in
  design.md Rejected Alternatives (operator decision).
- [ ] **Config**: assign real 3-segment key names + decide floor=0 / decay=0 read semantics
  (get_float_present vs get_float zero-trap) + declare defaults in analysis CLAUDE.md.
- [ ] **Round 4 focus**: the post-199 facts are now known (sync above), so `/sdd-design
  symbol-opportunity-ranking` round 4 can run against the built 199 code on this branch — write
  design.md + flip to design-approved, then `/sdd-spec 200`. (Merge still sequences after 199 via
  merge-order.md; the design no longer waits on 199's shape being unknown.)

## Session 2026-09-21 — sync with what feature 199 built

Operator: "sync feature 200 with what 199 built." Feature 199 (opportunity-composite-score) is now
`code-completed` (PR #1157). Re-grounded 200's dependency facts against the landed 199 code (all on
`claude/symbol-consolidation-scoring-7kgk9t`):

- recon.md: corrected the migration tip (`024` composite LANDED, not `023`; killed the stale
  "024–028 drift" note — those are config-service seed migrations), the proto next-free field
  (`symbol_score = 22` after landed `composite_score = 21`), the sort value (`= 3`, OpportunitySort
  max 2), the dependency block (199 BUILT, composite_score is a queryable column), the Risks
  "composite_score not landed" → LANDED, and the cardinal-guard id (`ANALYSIS-11` landed → 200 =
  `ANALYSIS-12`).
- context.md: added the "Post-199 sync" fact block; marked the Post-199-coupling and NULL-fold Open
  Threads RESOLVED (composite is a real column read via `read()`; NULL on `Σw ≤ 0` → 200 skips NULL
  terms); updated the cardinal-guard line to ANALYSIS-11→ANALYSIS-12; re-pointed the round-4 thread
  (design can now run against the built code).

Status unchanged (`spec-ready`) — this is a fact re-grounding, NOT the design resume. Next: run
`/sdd-design symbol-opportunity-ranking` round 4 to write design.md and flip to design-approved,
then `/sdd-spec 200`. Merge still sequences after 199 (merge-order.md unchanged).

## Session 2026-09-21 — sdd-review product-spec (re-review post-sync)

- Result: **PASS WITH WARNINGS** — 0 blockers, no Floor breach. Overlap: **CLEAN** (proto `symbol_score
  = 22`, `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`, migration `025`, `ANALYSIS-12`, and the new
  `analysis.scoring.*`/`analysis.opportunity.*` keys all free and uncontested; 199's landed claims
  consistent, no double-claim; merge-order row already present).
- Warnings:
  1. **[FIXED now]** Stale dependency label — product-spec called 199 `implementation-ready`; updated
     to `code-completed` (PR #1157), and the migration note to "199 landed `024` → next-free `025`".
  2. 4-segment config key `analysis.scoring.strategy_weight_override.<strategy_id>` (C-05) — already an
     Open Question; converged design collapses it to the 3-segment structured
     `analysis.scoring.strategy_weight_overrides`. Resolve in design.md.
  3. Migration up/down pairing (C-07) not restated in the conditional persisted branch — confirm at
     design (converged design persists + reserves `025`).
  4. Open Questions still `- [ ]` — legitimately design-deferred; resolve when design.md is written.
- Warnings 2–4 are carried into the `/sdd-design` round-4 run (next); status stays `spec-ready`.

## Session 2026-09-21 — sdd-design (round 4, APPROVED → design-approved)

- Phase 0 Recon: recon.md already current (synced against merged 199 earlier this session); services:
  analysis, packages/proto, xstockstrat-ui, xstockstrat-agent, xstockstrat-config. Key reuse: 199's
  `composite_score` column + `read()` projection; the `self._strategies` grade cache + owner-intersect;
  the `_SORT_ORDER_BY` branch map; `_row_to_opportunity` explicit-presence mapping.
- Phase 1 Grilling: round 4 (full) — proposer produced the final design, adversary returned
  SOUND-WITH-RISKS (no Floor breach). design.md written.
- **Chosen approach**: geometric rank-decay fold `Σ γ^i·(composite × strategy_weight)` (γ=0.5), one
  SHARED compute/heal fold helper (determinism parity by construction), owner-scoped grade derived
  from drained bindings∪live-enabled (no extra `list(user_id)` query), unbounded scalar, persisted
  `symbol_score = 22` (migration `025`) + opt-in `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`, `ANALYSIS-12`
  cardinal guard, plain 3-decimal UI (NOT scoreColor).
- **Operator-decision (gate)**: the per-strategy override is moved **onto the strategy entity**
  (`StrategyDefinition.rank_weight_override`, mirroring feature-134 `SignalSource.reliabilityWeight`) —
  **supersedes** the earlier converged `analysis.scoring.strategy_weight_overrides` JSON-blob config
  key, which the adversary flagged as a repeat of the deleted `source_weights` anti-pattern
  (`fails.md:1155/1537`). This adds a proto field + strategies-table migration + `ManageStrategy` write
  path + agent `manage_strategy` surface to 200's scope.
- **Config now**: only two 3-segment keys — `analysis.scoring.symbol_score_decay` (0.5) and
  `analysis.scoring.strategy_weight_floor` (0.5), both `get_float_present`.
- Rejected: config-blob overrides; extra owner-list query (YAGNI); FOR-UPDATE heal lock (self-heals);
  persist-pre-weighted-term (shared helper is cheaper); scoreColor on an unbounded scalar.
- Constitution rules touched: C-05, C-07, C-09, C-10, C-14, C-15, C-16, C-18, P-05, F-04, F-06, F-07.
  Floor breaches: none.
- Open risks (also design.md): grade-VALUE collision residual (133 D-2, accepted); owned_ids-from-
  drained-set assumes no 4th attribution path (grep at /sdd-spec); compute/heal shared-helper lockstep
  (heal-parity test guards); `rank_weight_override` scope; soft rebase overlap 187/193/188.
- Status: spec-ready → design-approved. Next: /sdd-spec symbol-opportunity-ranking.

## Session 2026-09-21 — sdd-design round 5 (pressure test) → override DEFERRED

Operator requested one more round. Round 5 (hard cap) aimed the adversary at the round-4
override-on-entity decision, which had NEVER been adversarially tested (it was decided AT the round-4
gate, after that round's adversary ran). Verdict: SOUND-WITH-RISKS, no Floor breach — but the override
mechanism was under-grounded, with four must-fixes for a knob that defaults to a no-op 1.0:
1. **Phantom migration / contradictory persistence** — `analysis.strategies` stores the whole
   `StrategyDefinition` as one JSONB `definition_json` (`migrations/001`); new fields ride the blob
   (no migration, like `denied_symbols`/`signal_eligible`) OR need a discrete column (the
   `SignalSource.reliabilityWeight` shape). design.md conflated both.
2. **Grade-fingerprint wipe (C-16, @AC-5 feature-150)** — a blob-riding override enters
   `_definition_fingerprint`; tuning it would discard the strategy's feature-065 grade evidence →
   grade→floor, the opposite of intent.
3. **Full-replace wipe (feature-148 class)** — the UI's full-definition `ManageStrategy` update omits an
   unset optional → resets the override to 1.0; also not in `_MASKABLE_PATHS`.
4. **Heal/compute parity gap** — the override lives on `definition_json`, but heal's
   `symbol_composite_terms` + the `self._strategies` grade cache don't carry it → heal would fold with
   override=1.0 while compute used the real value.
Plus: "config-ui-visible/bounds-checkable for free" false on a JSONB field; unbounded `symbol_score` +
`override=1e9` dominates; and a genuinely-open owned_ids fourth path (the fundamentals-blend force-run
attributing a non-owned global strategy_id → floor).

**Gate decision: DEFER the override to a follow-up feature; v1 = grade-only** (`strategy_weight =
affine(grade)`, override ≡ 1.0). Removes all four must-fixes + both override objections in one move;
the grade-weighting value (FR-3, @AC-4) and breadth examples (FR-2) ship intact. The override becomes a
named follow-up (`per-strategy-rank-weight-override`), to be built with the reliabilityWeight shape
(column + CHECK bound + maskable write + fingerprint-exclusion) — recorded in design.md § Deferred so
the follow-up starts grounded.

Propagated the descope: design.md rewritten (grade-only, § Deferred, updated Rejected/Open-Risks/
Constitution/Business-Rules, Rounds=5); product-spec FR-3 + config section + affected-services +
override Open Question; `acceptance.feature` `@AC-5` annotated `@deferred-followup` (append-only, not
renumbered). Retained open risks: owned_ids fourth-path (grep at /sdd-spec), grade-value collision
residual, shared-helper lockstep. Status stays `design-approved`. Next: /sdd-spec (v1 scope).

## Session 2026-09-21 — sdd-design round 6 (operator-requested, past 5-round cap) → grade-only VERIFIED

Operator asked for one last round; noted it is past the documented 5-round cap and proceeded on
explicit direction. Round 6 attacked the final GRADE-ONLY shape (round 5 had been consumed by the
override). Verdict: **SOUND-WITH-RISKS, no Floor breach.** All four load-bearing claims verified against
code: owned_ids complete-cover, `overall_score`∈[0,1], migration `025` free, heal-parity inputs.

Addressed before approval:
- **γ read-clamp [0,0.99] (robustness / @AC-3).** `analysis.scoring.symbol_score_decay` had no
  write-time bound; at γ≥1 the geometric fold degenerates to a plain/growing sum and PENNY (6×0.30)
  overtakes AAPL (2×0.80) — inverting the mandated @AC-3 saturation ordering. Chose a **read-side clamp
  to [0,0.99]** in `_compute_opportunities` (cheapest robust fix; no config-service bounds-registry
  diff, stays in-analysis, matches the "code-default only" choice for these keys) over registering a
  SCALAR_BOUNDS_REGISTRY bound. Documented in design.md fold paragraph.
- **"unbounded" → "bounded".** With the override deferred, `strategy_weight ≤ 1.0` ⇒ `symbol_score <
  2·max_composite (<2.0)` for γ<1. Reworded the 4 "unbounded" spots + the `ANALYSIS-12`/proto
  doc-comment framing to "bounded ordinal ranking scalar on a non-[0,1] scale". The NOT-scoreColor
  decision stands (a [0,<2) ordinal still doesn't fit a [0,1] cardinal color scale).
- **grade_lookup clarified**: returns the **continuous** cached `overall_score`+`provisional`
  (`_row_to_score`), floor on `None` — NOT the A–F letter. Grade-A (`overall≥0.8`) vs grade-C
  (`[0.5,0.65)`) ranges are disjoint ⇒ @AC-4 holds by construction without an override.
- **owned_ids RESOLVED at design (not deferred)**: grepped every `_candidate(sym, strat)` site — `strat`
  comes only from owner watchlist bindings or `list_live_enabled(user_id)`; the fundamentals-blend fires
  only when the user owns a live blend strategy ⇒ no fourth path, no `list(user_id)` fallback needed.
- **recon.md stale override refs fixed**: added a round-6 "design.md is authoritative" note + corrected
  the Objective and Config-keys lines (override deferred, not on the entity).

Status stays `design-approved`. Ledger: round-6 confirmed no repeat of fails.md:313/1153/1155. Next:
/sdd-spec (grade-only v1 scope; γ read-clamp + the two mandated orderings pinned at default γ in the
C-15 analysis test step).
