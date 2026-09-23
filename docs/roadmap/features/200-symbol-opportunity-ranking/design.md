# Design: symbol-opportunity-ranking

**Created**: 2026-09-21
**Rounds**: 6 (full; termination: approved. Rounds 1–3 converged pre-merge; round 4 resumed against the built feature-199 tree; round 5 pressure-tested the round-4 override decision → deferred the override; round 6 pressure-tested the grade-only shape → verified the mandated orderings + owned_ids cover, added the γ read-clamp, and corrected the "unbounded" framing to "bounded".)
**Approved by**: user @ 2026-09-21 (round-4 gate: override on the strategy entity; round-5 gate: **defer the operator override to a follow-up feature — v1 is grade-only**)
**Grounded in**: recon.md

---

## Chosen Approach

A symbol-level roll-up computed **entirely inside `xstockstrat-analysis`'s existing opportunity
write/read path**, layered on feature-199's per-row `composite_score` (proto `= 21`, column via
migration `024`, projected in `read()`). No new inter-service edge, no new fetch/RPC/bars — it reuses
already-drained rows, preserving the `@AC-6..9 @feature-191` latency bound.

**Fold.** `symbol_score = Σ_i γ^i · t_(i)`, terms `t = composite_score × strategy_weight` sorted
DESC, geometric rank-decay `γ = 0.5`, **read-clamped to `[0, 0.99]`** at the config read. The clamp is
load-bearing: a decay `γ ≥ 1` degenerates the fold to a plain (or growing) sum and **inverts the @AC-3
saturation ordering** — PENNY (6×0.30) would overtake AAPL (2×0.80) — so the clamp makes that mandated
ordering un-breakable by operator config without a config-service bounds-registry entry. The result is a
**bounded** ordinal scalar: with the override deferred `strategy_weight ≤ 1.0`, so `symbol_score <
2·max_composite` (`< 2.0`) for any `γ < 1` — not a `[0,1]` probability, but bounded, not unbounded.
A NULL-composite row contributes no term; a symbol with no surviving term → `symbol_score = NULL`.
Two new **module-level pure helpers** in `servicer.py`, beside `_composite_score`/`_composite_signal_subscore`
(`servicer.py:5216,5236`):
- `_strategy_weight(overall_score, provisional, floor)` → `floor` when the grade is `None`/provisional,
  else `floor + (1−floor)·clamp01(overall_score)`. **v1 has no override term** (see Deferred below);
  the affine map alone realizes FR-3's grade weighting. The input is the **continuous cached
  `overall_score` (∈[0,1]) + `provisional`** from the feature-065 `StrategyScore` (`_row_to_score`,
  `servicer.py:5665`) — NOT the A–F letter grade; a strategy with no cached `StrategyScore` (score `None`,
  `servicer.py:2237`) maps to floor. Because grade-A (`overall ≥ 0.8`) and grade-C (`overall ∈ [0.5,0.65)`)
  ranges are disjoint, `w_A ≥ 0.9 > w_C < 0.825` strictly → @AC-4 (`fundamental_macd_blend` grade-A
  outranks grade-C) holds by construction, no override needed.
- `_symbol_score(terms, gamma)` → `None` on empty terms, else `Σ_i gamma**i · t` over
  `sorted(terms, reverse=True)`.

**Single shared fold path (compute + heal call the SAME builder — parity by construction).** Both
paths call one shared helper `_symbol_score_for_group(rows, grade_lookup, cfg)` that builds
`terms = [r["composite_score"] · _strategy_weight(grade_lookup(r["strategy_id"]), …) for r in group
if r["composite_score"] is not None]` and folds via `_symbol_score`. Because v1's `strategy_weight`
depends only on the **grade** (from `self._strategies`, available to both compute and heal) and the two
config floats — not on any per-row-persisted override — heal and compute have the identical inputs at
fold time, so the heal-parity test (RAW table == full compute pass) holds structurally. (Round 5
showed that an entity-persisted override would have broken this — heal's `symbol_composite_terms`
carries no override; deferring the override removes that parity hazard entirely.)

**Compute wiring.** In `_compute_opportunities`, read the two config values once per pass (alongside
the composite reads, `servicer.py:~4013`); after `rows = [_row_for(...) ...]` (`servicer.py:~4515` —
`composite_score` is finalized inside `_row_for` at `~4512`), group `rows` by `symbol`, fold once per
group via the shared helper, and stamp the single scalar (or `None`) onto **every** row in the group
(symbol-uniform, incl. NULL-composite / muted / data-unavailable rows).

**Owner-scoped grade (no extra query — IDOR-safe).** `strategy_weight` reads the feature-065 grade
from the in-memory `self._strategies` cache (`servicer.py:2319`), **global, keyed by bare
`strategy_id`**. Gate every grade read on the owner's id set (`fails.md:1153/1532` IDOR trap).
`owned_ids` is derived from rows **already drained this pass** — the union of watchlist-binding
`strategy_id`s and `list_live_enabled(user_id)` rows (`servicer.py:~4053`) — because every attributed
row's `strategy_id` comes from one of those. A `strategy_id ∉ owned_ids` (or unattributed `""`) → floor
weight, never a cross-user grade. **Confirmed complete (round 6, grep):** every non-`""` candidate
`strategy_id` comes only from the owner's watchlist bindings or `list_live_enabled(user_id)` — including
the fundamentals-blend, which fires only when the user owns a live blend strategy — so there is no fourth
attribution path and no explicit `list(user_id)` fallback is needed (see Open Risks).

**Persist + sort.** Additive nullable `DOUBLE PRECISION symbol_score` column (migration `025`), added
to `replace_for_user` INSERT (`opportunities.py:82`), `replace_symbols` UPDATE (`opportunities.py:132`),
and the `read()` SELECT (`opportunities.py:187`); `_row_to_opportunity` maps it with the
explicit-presence pattern (`servicer.py:~5303`) → proto `Opportunity.symbol_score = 22`. Opt-in sort
`OPPORTUNITY_SORT_SYMBOL_SCORE = 3` adds `_SORT_ORDER_BY[3] = MAX(o.symbol_score) OVER (PARTITION BY
o.symbol) DESC NULLS LAST, o.symbol ASC, o.opportunity_key ASC` (`opportunities.py:33`). **Default sort
stays CONVICTION** — no `@AC-10 @feature-190` change, no sign-off.

**Heal.** A disposition-free `symbol_composite_terms(user_id, symbol)` read feeds the **same** shared
fold helper → `stamp_symbol_score(user_id, symbol, score)` symbol-wide UPDATE of all rows. The
heal-parity test asserts against the RAW table that every row (incl. dismissed) carries the identical
score AND equals a full compute pass.

**Consumer surfaces (C-14).** UI `/insights`: a `symbol_score` value rendered **only under the
server-applied `symbol_score` sort**, as a plain 3-decimal number — **NOT `scoreColor`** (it is a bounded
`[0, <2)` ordinal ranking scalar on a non-`[0,1]` scale; `scoreColor`'s `[0,1]` cardinal thresholds do not
apply — the recon's `scoreColor` suggestion is a bug and must not reach the impl-spec).
Agent `list_opportunities`: raw float via `_opportunity_to_dict` (`client.py:747`) with omit-on-NULL +
descriptor-parity test + `mcp-tools.md` — same-PR (`fails.md:1151`, `@AC-10 @feature-185`).

**Cardinal guard.** Companion invariant `ANALYSIS-12` + a `symbol_score` proto doc-comment
("bounded (`< 2·max_composite` for γ<1) ordinal RANKING scalar on a non-`[0,1]` scale; NOT a
probability/expected-return/sizing/alert input") — mirrors landed `ANALYSIS-11` and discharges
`fails.md:313/:418`.

## Deferred to a follow-up feature (named, C-14)

**Per-strategy operator rank-weight override** — deferred to its own follow-up feature, tentatively
`per-strategy-rank-weight-override`. v1 ships `strategy_weight = affine(grade)` with the override ≡ 1.0
(a no-op), so the grade-weighting requirement (FR-3, `@AC-4`) and the breadth examples (FR-2) are fully
delivered. The round-5 pressure test showed the override — a knob that defaults to no-op — carries four
must-fixes that the follow-up must build correctly (they are recorded here so the follow-up starts
grounded):
- `analysis.strategies` stores the whole `StrategyDefinition` as one JSONB `definition_json`
  (`migrations/001_strategies.up.sql:4`; `strategies.py:22-32`); new fields either **ride the blob**
  (like `denied_symbols`/`signal_eligible`, no migration) or need a **discrete column** (the
  `SignalSource.reliabilityWeight` shape: column + `CHECK` bound + repo setter + read-overlay). Pick one.
- If it rides `definition_json` it enters `_definition_fingerprint` (`servicer.py:5643,5658`), so a
  tuning change would **wipe the strategy's feature-065 grade evidence** (ANALYSIS-3) — the override
  must be added to `_FINGERPRINT_EXCLUDED_KEYS` (it is non-scoring).
- The full-replace `ManageStrategy` update path (`servicer.py:2545`) and the UI wizard would **wipe an
  unset optional back to 1.0** (feature-148 replace-wipe class); it must join `_MASKABLE_PATHS` +
  a full-replace preservation guard (or be column-authoritative).
- An **unbounded** `symbol_score` means an unvalidated override (e.g. `1e9`) dominates all ranking —
  the follow-up needs an explicit bound + write-time validation (`reliabilityWeight` got
  `CHECK (BETWEEN 0 AND 1)`), plus a named config-ui/agent write surface.

## Rejected Alternatives

- **Keep the operator override in v1 (either persistence variant)** — deferred: the round-5 pressure
  test exposed four must-fixes (phantom vs real migration, grade-fingerprint wipe, full-replace wipe,
  heal-parity) for a knob that defaults to a no-op; the grade-weighting value ships without it.
- **`strategy_weight_overrides` JSON-blob config key** — rejected (round 4): reincarnates the deleted
  `analysis.signals.source_weights` per-entity-weights-in-a-config-blob anti-pattern (`fails.md:1155/1537`).
- **Extra `list(user_id)` query per pass for `owned_ids`** — rejected: YAGNI; derivable from rows already
  drained this pass with zero quality loss.
- **Persist a pre-weighted term / `symbol_score_terms` JSONB** — rejected: extra storage; the shared
  fold helper gives structural compute/heal parity more cheaply.
- **Mandate a FOR-UPDATE / advisory lock on the heal symbol-wide UPDATE** — rejected: single idempotent
  statement; converges by the next read/recompute (feature-097/185 stale-while-revalidate tolerance).
- **`scoreColor` for the UI value (recon line 38)** — rejected: `symbol_score` is a bounded `[0,<2)`
  ordinal on a non-`[0,1]` scale; a `[0,1]` cardinal color scale is the `fails.md:313/:418`
  ordinal-as-cardinal bug. Plain 3-decimal number instead.
- **Read-time (non-persisted) computation** — rejected: the geometric fold is a rank-dependent ordered
  fold, not a SQL window aggregate; must be computed app-side and persisted to be sortable.

## Open Risks

- [x] **`owned_ids`-from-drained-set — RESOLVED (grepped the compute, round 6).** Every non-`""` candidate
  `strategy_id` originates from exactly two owner-scoped sources: the user's watchlist bindings
  (`_drain_watchlist_bindings(user_id)` → `watchlist_by_symbol`) and the user's live-enabled rows
  (`list_live_enabled(user_id)` → `live_by_symbol`, `servicer.py:4053`, explicitly owner-scoped per
  `:4037`). The **fundamentals-blend force-run** (feature 168/193) contributes rows ONLY through that
  `live_rows` loop and ONLY when the user owns a live blend strategy
  (`blend_active = … any(r["strategy_id"] == blend_id for r in live_rows)`, `:4060`, `:4066-4084`) — so
  there is **no fourth path** attributing a non-owned `strategy_id`. Signals merge into existing
  candidates or create an unattributed `(sym, "")` row (`:4191-4195`); held falls back to `""` (`:4157`).
  ⇒ derived `owned_ids = bindings ∪ live_rows` is a **complete cover**; the grade read is always
  owner-owned (no IDOR); **no explicit `list(user_id)` fallback needed**. (The grade-VALUE collision
  residual below still applies — the cache is keyed by bare `strategy_id`.)
- [ ] **Grade-*value* collision residual (accepted).** `strategy_scores` is global, keyed by bare
  `strategy_id`; two users owning the same `strategy_id` share one cached grade (last-scorer-wins,
  accepted at feature-133 D-2). v1 promotes that value into a ranking input. Accepted: the weight is an
  ordinal ranking aid, not a security boundary.
- [ ] **Compute/heal shared-helper lockstep** — parity holds only while both paths call the one shared
  fold helper; the heal-parity test (RAW == full compute) is the guard. (Simpler in v1 than it would have
  been with an override, since only the grade + two config floats feed the weight.) Target: analysis test step.
- [ ] **Soft rebase overlap** with in-flight 187/193/188 on `servicer.py` `_compute_opportunities`,
  `opportunities.py` ORDER BY, `insights/opportunities/page.tsx`, agent `list_opportunities` — re-anchor
  lines at `/sdd-spec`/execute.

## Constitution Rules Touched

- `C-05` — honored by: two 3-segment `analysis.scoring.*` keys (`symbol_score_decay`,
  `strategy_weight_floor`); no override config key (deferred).
- `C-07` — honored by: one new migration pair `025_opportunity_symbol_score.{up,down}.sql` (no strategies
  migration in v1 — the override that would have needed one is deferred).
- `C-09` — honored by: additive proto only (`Opportunity.symbol_score = 22`, `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`);
  no `StrategyDefinition` change in v1; `buf breaking` passes; regen + commit `gen/`.
- `C-10` / `C-14` — honored by: both named consumer surfaces (UI `/insights`, Agent `list_opportunities`)
  get their own steps; the deferred override points at a **named** follow-up feature (not a vague "later").
- `C-15` / `C-16` — honored by: `acceptance.feature` `@AC-*` traced to test steps; `@AC-5` (override) marked
  deferred to the follow-up; PRESERVE/EXTEND set below.
- `C-18` — honored by: one shared fold helper (compute + heal); reuse of the grade cache + sort-branch map.
- `P-05` — honored by: this design + open risks written to `context.md` as they land.
- `F-04` — honored by: every symbol/path cited to `recon.md`; the phantom strategies migration is removed
  (the override that implied it is deferred).
- `F-06` — honored by: no new pool, no new query (derived `owned_ids`).
- `F-07` — honored by: `γ`/`floor` via `get_float_present` (code-default, like the sibling `composite_*` keys).

## Business Rules Touched (C-16)

- PRESERVE `@AC-10 @feature-190` "Conviction sort is the default" — `symbol_score` is opt-in sort `3`.
- PRESERVE `@AC-15 @feature-190` (UI) "client does not re-sort" — ordering computed server-side.
- PRESERVE `@AC-8/@AC-9/@AC-13 @feature-190` (grouping / contiguity / stable paging) — branch 3 keeps the
  `PARTITION BY o.symbol` group key + `o.opportunity_key ASC` tiebreak.
- PRESERVE `@AC-1/@AC-6 @feature-176` (deterministic + rank-stable; per-user owner scoping) — shared-helper
  order-insensitive fold + owner-scoped grade reads.
- PRESERVE `@AC-1/@AC-2 @feature-185` (unavailable ≠ evaluated 0/N) — NULL-composite rows contribute no term.
- EXTEND `@AC-10 @feature-185` (agent descriptor-parity) — `symbol_score` projected + covered, same PR.
- EXTEND `@AC-9/@AC-10 @feature-155` (UI mobile grouping / tags) — mobile row may carry `symbol_score`.
- No existing (promoted) `@AC-*` is CHANGED. This feature's own `@AC-5` (operator override) is **deferred to
  the follow-up** (the override is descoped from v1); FR-3's grade-weighting stays covered by `@AC-4`.
