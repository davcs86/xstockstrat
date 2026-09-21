# Design: symbol-opportunity-ranking

**Created**: 2026-09-21
**Rounds**: 4 (full; termination: approved — round 4 resumed against the merged/built feature-199 tree after rounds 1–3 converged pre-merge)
**Approved by**: user @ 2026-09-21 (override-mechanism gate answered: override on the strategy entity)
**Grounded in**: recon.md

---

## Chosen Approach

A symbol-level roll-up computed **entirely inside `xstockstrat-analysis`'s existing opportunity
write/read path**, layered on feature-199's per-row `composite_score` (proto `= 21`, column via
migration `024`, projected in `read()`). No new inter-service edge, no new fetch/RPC/bars —
it reuses already-drained rows, preserving the `@AC-6..9 @feature-191` latency bound.

**Fold.** `symbol_score = Σ_i γ^i · t_(i)`, terms `t = composite_score × strategy_weight` sorted
DESC, geometric rank-decay `γ = 0.5`. An **unbounded** raw scalar (override and multi-term sums can
exceed 1.0). A NULL-composite row contributes no term; a symbol with no surviving term →
`symbol_score = NULL`. Two new **module-level pure helpers** in `servicer.py`, beside
`_composite_score`/`_composite_signal_subscore` (`servicer.py:5216,5236`):
- `_strategy_weight(overall_score, provisional, override, floor)` → `floor·override` when the grade
  is `None`/provisional, else `(floor + (1−floor)·clamp01(overall_score))·override`.
- `_symbol_score(terms, gamma)` → `None` on empty terms, else `Σ_i gamma**i · t` over
  `sorted(terms, reverse=True)`.

**Single shared fold path (compute + heal call the SAME builder — parity by construction).** The
must-fix from round 4 is that heal must fold the *weighted* term, not raw `composite_score`, or heal
`symbol_score` ≠ compute `symbol_score` (a `@AC-1/@AC-6 @feature-176` determinism regression). Both
paths therefore call one shared helper `_symbol_score_for_group(rows, grade_lookup, cfg)` that builds
`terms = [r["composite_score"] · _strategy_weight(grade_lookup(r["strategy_id"]), …) for r in group
if r["composite_score"] is not None]` and folds via `_symbol_score`. Parity is structural (one code
path), not a re-derivation two sites must keep in lockstep.

**Compute wiring.** In `_compute_opportunities`, read the two new config values once per pass
(alongside the composite reads, `servicer.py:~4013`); after `rows = [_row_for(...) ...]`
(`servicer.py:~4515` — `composite_score` is finalized inside `_row_for` at `~4512`, not on the raw
candidate), group `rows` by `symbol`, fold once per group via the shared helper, and stamp the
single scalar (or `None`) onto **every** row in the group (symbol-uniform, including
NULL-composite / muted / data-unavailable rows).

**Owner-scoped grade (no extra query — IDOR-safe).** `strategy_weight` reads the feature-065 grade
from the in-memory `self._strategies` cache (`servicer.py:2319`), which is **global, keyed by bare
`strategy_id`**. Gate every grade read on the owner's id set (`fails.md:1153/1532` IDOR trap: 200 was
specced before ownership could be assumed). `owned_ids` is derived from rows **already drained this
pass** — the union of watchlist-binding `strategy_id`s and `list_live_enabled(user_id)` rows
(`servicer.py:~4053`) — because every attributed row's `strategy_id` comes from one of those; an
owned-but-unbound/non-live strategy never attributes to a row, so its grade is never read. A
`strategy_id ∉ owned_ids` (or unattributed `""`) → floor weight, never a cross-user grade. This drops
the proposer's extra `list(user_id)` query (YAGNI); `/sdd-spec` must grep-confirm no fourth
attribution path before relying on it.

**Operator override on the strategy entity (user decision, not a config blob).** The per-strategy
override is a field on the strategy entity — an additive `optional double rank_weight_override` on
`StrategyDefinition`, persisted on the strategies table (new migration) and settable through the
existing `ManageStrategy` write path — mirroring feature-134's `SignalSource.reliabilityWeight`. It is
config-ui-visible, bounds-checkable, and per-user-scoped for free. `_strategy_weight` reads the
override off the owned strategy row (default `1.0` when unset). This deliberately does **not** ship a
`strategy_weight_overrides` JSON config blob (see Rejected Alternatives).

**Persist + sort.** Additive nullable `DOUBLE PRECISION symbol_score` column (migration `025`), added
to `replace_for_user` INSERT (`opportunities.py:82`), `replace_symbols` UPDATE (`opportunities.py:132`),
and the `read()` SELECT (`opportunities.py:187`); `_row_to_opportunity` maps it with the
explicit-presence pattern (`servicer.py:~5303`) → proto `Opportunity.symbol_score = 22`. Opt-in sort
`OPPORTUNITY_SORT_SYMBOL_SCORE = 3` adds `_SORT_ORDER_BY[3] = MAX(o.symbol_score) OVER (PARTITION BY
o.symbol) DESC NULLS LAST, o.symbol ASC, o.opportunity_key ASC` (`opportunities.py:33`) — keeps the
symbol-partition group key + `opportunity_key` paging tiebreak (`@AC-8/@AC-9/@AC-13 @feature-190`).
**Default sort stays CONVICTION** — no `@AC-10 @feature-190` change, no sign-off.

**Heal.** A disposition-free `symbol_composite_terms(user_id, symbol)` read feeds the **same** shared
fold helper → `stamp_symbol_score(user_id, symbol, score)` symbol-wide UPDATE of all rows. The heal
re-derives `strategy_weight` from the same `owned_ids` gate + `self._strategies` + config as compute
(structural parity, above). The heal-parity test asserts against the RAW table that every row (incl.
dismissed) carries the identical score AND equals a full compute pass.

**Consumer surfaces (C-14).** UI `/insights`: a `symbol_score` value rendered **only under the
server-applied `symbol_score` sort**, as a plain 3-decimal number — **NOT `scoreColor`** (unbounded;
the recon's `scoreColor` suggestion is a bug for an unbounded scalar and must not reach the impl-spec).
Agent `list_opportunities`: raw float via `_opportunity_to_dict` (`client.py:747`) with omit-on-NULL +
descriptor-parity test + `mcp-tools.md` — same-PR (`fails.md:1151`, `@AC-10 @feature-185`).

**Cardinal guard.** Companion invariant `ANALYSIS-12` + a `symbol_score` proto doc-comment
("unbounded ordinal RANKING scalar; NOT a probability/expected-return/sizing/alert input") — mirrors
landed `ANALYSIS-11` and discharges `fails.md:313/:418`.

## Rejected Alternatives

- **`strategy_weight_overrides` JSON-blob config key** — rejected: reincarnates the exact
  per-entity-weights-in-a-config-blob anti-pattern feature 134/161 deleted (`analysis.signals.source_weights`
  → moved onto `SignalSource.reliabilityWeight`, `fails.md:1155/1537`); not config-ui scalar/bounds-editable;
  `try/except`-ignore only treats the symptom. Override moved onto the strategy entity instead (user decision).
- **Extra `list(user_id, include_inactive=True)` query per pass for `owned_ids`** — rejected: YAGNI;
  `owned_ids` is derivable from rows already drained this pass (bindings ∪ live-enabled) with zero
  quality loss, since only those strategies can attribute to a row.
- **Persist the pre-weighted term / a `symbol_score_terms` JSONB** — rejected: extra storage; structural
  parity is achieved more cheaply by having compute and heal call one shared fold helper.
- **Mandate a FOR-UPDATE-txn / per-user advisory lock on the heal symbol-wide UPDATE** — rejected: the
  UPDATE is a single idempotent statement; a racing `replace_for_user` DELETE+INSERT converges to a
  correct score by the next read/recompute (the feature-097/185 stale-while-revalidate tolerance), and a
  lock re-introduces the `instance_count:1` fencing the analysis `CLAUDE.md` deliberately avoids.
- **`scoreColor` for the UI value (recon line 38)** — rejected: `symbol_score` is unbounded; a `[0,1]`
  color scale on it is the `fails.md:313/:418` ordinal-as-cardinal bug. Plain 3-decimal number instead.
- **Read-time (non-persisted) computation** — rejected: the geometric fold is a rank-dependent ordered
  fold, not a SQL window aggregate; it must be computed app-side and persisted to be sortable.

## Open Risks

- [ ] **Grade-*value* collision residual (accepted).** `strategy_scores` is global, keyed by bare
  `strategy_id` (`strategy_scores.py` PK; hydrate `servicer.py:2319`); two users owning the same
  `strategy_id` share one cached grade (last-scorer-wins, accepted at feature-133 D-2 for
  `ListStrategies`). 200 newly promotes that value into a cross-symbol ranking input. Accepted: the
  weight is an ordinal ranking aid, not a security boundary — recorded here, not silently inherited.
- [ ] **`owned_ids`-from-drained-set assumes no fourth attribution path** — `/sdd-spec` must grep the
  compute to confirm every attributed row's `strategy_id` originates from a watchlist binding or a
  live-enabled row before relying on the derived set (else fall back to the explicit `list(user_id)`).
- [ ] **Compute/heal shared-helper lockstep** — parity holds only while both paths call the one shared
  fold helper; the heal-parity test (RAW table == full compute pass) is the guard. Target: the analysis
  test step.
- [ ] **`StrategyDefinition.rank_weight_override` scope** — adds a proto field + strategies-table
  migration + `ManageStrategy` write path + agent `manage_strategy` surface; larger than the config-key
  path but the tenancy-correct choice. `/sdd-spec` sequences it before the fold that reads it.
- [ ] **Soft rebase overlap** with in-flight 187/193/188 on `servicer.py` `_compute_opportunities`,
  `opportunities.py` ORDER BY, `insights/opportunities/page.tsx`, agent `list_opportunities` — re-anchor
  lines at `/sdd-spec`/execute.

## Constitution Rules Touched

- `C-05` — honored by: two 3-segment config keys (`analysis.scoring.symbol_score_decay`,
  `analysis.scoring.strategy_weight_floor`); the per-strategy override is an entity field, not a
  non-standard 4-segment/dynamic key.
- `C-07` — honored by: new `025_opportunity_symbol_score.{up,down}.sql` pair (+ the strategies-table
  migration for the override field), `NNN` = last + 1.
- `C-09` — honored by: additive proto only (`Opportunity.symbol_score = 22`, `OPPORTUNITY_SORT_SYMBOL_SCORE = 3`,
  `StrategyDefinition.rank_weight_override`); `buf breaking` passes; regen + commit `gen/`.
- `C-10` / `C-14` — honored by: both named consumer surfaces (UI `/insights` sort+render, Agent
  `list_opportunities`) get their own steps; the agent descriptor-parity + `mcp-tools.md` land same-PR.
- `C-15` / `C-16` — honored by: `acceptance.feature` `@AC-*` traced to test steps; PRESERVE/EXTEND set below.
- `C-18` — honored by: one shared fold helper (compute + heal), reuse of the grade cache and sort-branch
  map; no config-blob repeat.
- `P-05` — honored by: this design + open risks written to `context.md` as they land.
- `F-04` — honored by: every symbol/path cited to `recon.md`; unfound items go to `/sdd-spec` discovery.
- `F-06` — honored by: no new pool and no new direct DB service; the derived-`owned_ids` approach adds
  not even a query. analysis is PgBouncer-pooled.
- `F-07` — honored by: `γ`/`floor` read via `get_float_present` (code-default, like the sibling
  `analysis.scoring.composite_*` keys); no hardcoded values in source.

## Business Rules Touched (C-16)

- PRESERVE `@AC-10 @feature-190` "Conviction sort is the default" — not regressed by: `symbol_score` is
  opt-in sort value `3`; `UNSPECIFIED==CONVICTION` untouched.
- PRESERVE `@AC-15 @feature-190` (UI) "client does not re-sort" — not regressed by: ordering computed
  server-side; the UI renders the server order verbatim.
- PRESERVE `@AC-8/@AC-9/@AC-13 @feature-190` (grouping / contiguity / stable paging) — not regressed by:
  branch 3 keeps the `PARTITION BY o.symbol` group key + `o.opportunity_key ASC` tiebreak.
- PRESERVE `@AC-1/@AC-6 @feature-176` (deterministic + rank-stable under concurrent fan-out; per-user
  owner scoping) — not regressed by: the shared-helper fold (order-insensitive via internal DESC sort)
  + owner-scoped grade reads.
- PRESERVE `@AC-1/@AC-2 @feature-185` (unavailable ≠ evaluated 0/N) — not regressed by: NULL-composite
  rows contribute no term; the symbol-uniform stamp still applies to unavailable rows.
- EXTEND `@AC-10 @feature-185` (agent descriptor-parity) — new case added: `symbol_score` projected +
  covered by the parity guard, same PR.
- EXTEND `@AC-9/@AC-10 @feature-155` (UI mobile grouping / tags) — new case added: the mobile row may
  carry the `symbol_score` under the new sort without regressing symbol grouping.
- No existing `@AC-*` is CHANGED (no sign-off needed).
