# Design: opportunity-composite-score

**Created**: 2026-09-20
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-09-20
**Grounded in**: recon.md

---

## Chosen Approach

Persist one nullable `composite_score` per opportunity row (`user × symbol_norm × strategy_id`) that
fuses **exactly two evidence axes** — readiness and directional signal — via a breadth-aware
empirical-Bayes shrinkage, computed on the existing opportunity-refresh write path and surfaced,
unchanged in meaning, on all three consumer surfaces.

**Scope — two axes, not four (FR-5 changed with sign-off).** Only two evidence axes exist at the
opportunity-materialization point: readiness `conviction` and `signal_axis`
(`servicer.py:4094`, recon.md:78). Fundamentals value+quality is **not** a distinct axis in this path
— it re-enters generically as `ExternalSignal`s feeding `signal_axis`, so fusing it again would
double-count. Technical signal is **not** in this path at all (`compute_signal_score`/`combine_score`
are screener/backtest-only behind the explicit boundary `servicer.py:667`). FR-5 was changed from
"all four" to "the two available axes" with explicit user sign-off (recorded in context.md,
2026-09-20); `@AC-4`/`@AC-6` were amended to the two-axis reality (C-15/C-16 correct order: FR change
first, acceptance follows).

**Fusion formula (inline EB, not a refactor of `_aggregate_cells`).**
`composite = (Σ wᵢ·sᵢ + 0.5·k) / (Σ wᵢ + k)`, `Σw ≤ 0 → None` (persist NULL). The one-line EB shape
is reused *by shape* from feature 065 (`_aggregate_cells`, `servicer.py:5202-5210`) but **inlined** in
a new pure `_composite_score` — not extracted — because the two call sites weight by different
quantities (065 = trading-days `int`; composite = dimensionless axis weights `float`) and the 065 path
is the ANALYSIS-2 binding grade (recon.md, round-2 objection D).

**Readiness sub-score — identity map.** `s_readiness = readiness["conviction"]` (a copy of the ordinal
from `evaluator.py:739`; recon.md:66). The readiness ordinal is used **directly** as the `[0,1]`
readiness sub-score; no `0.5+0.5·conviction` one-sided rescale (that was rejected — it inflated weak
setups and compressed the range). This discharges the `fails.md:313` trap not by asserting
`ordinal = probability` but by **declaring the composite an ordinal ranking device** (see the cardinal
guard below), so the identity map preserves the ordinal's full `[0,1]` discrimination (a 1/10 setup
scores ~0.1, not ~0.55). It reads a copy and never re-derives the persisted `conviction` column, so
`@AC-1/@AC-10 @feature-190` stay PRESERVE.

**Signal sub-score — direction-scoped multiplicative attenuation.**
`s_signal = clamp(max_agree, 0, 1) · (1 − clamp(max_conflict, 0, 1))`, over **decayed**
`effective_conviction` (`_signal_decay`, `servicer.py:4947`): `max_agree` = max effective among signals
whose `direction == c["best_direction"]`; `max_conflict` = max effective among the opposing tradeable
direction (`buy`↔`sell`; `hold`/unset contribute to neither, so `max_conflict = 0`). `best_direction`
stays chosen from **raw** conviction (`servicer.py:4095-4097`, unchanged). Operands are clamped because
`source_weights.get(..., 1.0)` (`servicer.py:4081`) can exceed 1 under an operator override.
**Semantic contract (load-bearing — do not "fix"):** the composite is the *directional-actionable-edge*
axis. A strong-but-contested symbol (max_agree≈max_conflict) is correctly pulled toward neutral here —
its raw activity is *not* lost, because the direction-agnostic MAX magnitude still floats high on the
sibling `signal_axis` column (`servicer.py:4094`). Multiplicative was chosen over: linear cancellation
`max_agree − max_conflict` (parity cliff → 0), ratio `a/(a+c)` (scale-free, discards magnitude), and
`scoring.py`'s `(net+1)/2` fold (0.5-neutral sum/count basis, incommensurable with the MAX-based
`signal_axis` sibling).

**k and weights (config defaults).** `k = 1.0`, `w_readiness = w_signal = 1.0`. Rationale: the
pseudo-count equals exactly one axis-weight, so a single-axis maxed row lands at `0.750` (the midpoint
of prior 0.5 and 1.0) while a corroborated both-present row reaches `0.833` — a meaningful 0.083
corroboration gap that stops a one-legged row masquerading as two-legged. Operating band `[0.167, 0.833]`.
A present-but-contradicted row (both-mixed `(1,0)`) computes `(1·1 + 1·0 + 0.5·1)/(1+1+1) = 0.500`,
correctly **below** a strong-readiness-no-signal row (`0.750`) — missing evidence → neutral prior;
present-but-contradictory evidence → active pull-down. All three are `get_float_present` config keys so
an operator may retune (e.g. asymmetric weights) without a code change; a configured `0` honestly
disables an axis.

**Presence predicate (correctness — round-4 finding).** An axis contributes its weight iff its
**evidence exists**, never by sub-score magnitude: readiness present iff `readiness["total_conditions"] > 0`;
signal present iff signal evidence exists (`_best_sig_conv >= 0.0` / `sig_contribs` non-empty),
**not** `s_signal > 0`. Multiplicative attenuation can yield `s_signal = 0` from *present* evidence
(all-hold, full-conflict, fully-decayed) — that must be an active pull-down (`w_signal` counted,
`s_signal = 0`), never a dropped term that drifts the row to the neutral prior. A `sym_unavailable`
row (both axes zeroed at `servicer.py:4332/4334`) forces both weights to 0 → `Σw = 0` → NULL, computed
against the real `readiness`/`c` **before** the zeroing, so "unavailable ≠ evaluated-low" is preserved.

**Compute site + heal parity.** `_composite_score` is called inside `_row_for` (`servicer.py:4253`)
after the `sym_unavailable` stamp and before the axis-zeroing. A new `_composite_sig_contribs`
accumulator on the candidate dict (init `servicer.py:3968`, appended in the existing fold at
`servicer.py:4092`) carries `(direction, effective_conviction)` to `_row_for` (the local `sig_contribs`
is not visible there). The self-heal path (`replace_symbols` UPDATE, `opportunities.py:104`, driven by
`_retry_unavailable_symbols`, `servicer.py:3671`) recomputes + repersists the composite through the
**same** `_composite_score` (deriving `best_direction` from raw conviction to match the main path), so a
recovered row never shows a stale/NULL composite (EXTEND `@AC-8`). Persisted as one added column on the
`replace_for_user` INSERT (`opportunities.py:81-84`).

**Consumer surfaces (C-14).** Additive `optional double composite_score = 21` on `Opportunity`
(`analysis.proto`, non-breaking). It reaches: `/insights` opportunities queue (`OpportunityRow` third
metric cell, `page.tsx:483-492`; mobile `SignalRow`) and `/trader` per-symbol `OpportunitySection`
(`positions/[symbol]/page.tsx:934-991`), colored via the existing `scoreColor` (`scoreDisplay.ts:13-17`)
with a new 3-decimal formatter, rendering **em-dash on NULL** (never `0.000`, EXTEND `@AC-11`); and the
`list_opportunities` MCP tool via the explicit `_opportunity_to_dict` projection (`client.py:747`),
pinned by the descriptor-parity test (`test_opportunity_projection.py:50`) + `mcp-tools.md:857`, all in
the same PR (the additive field is not optional to project — EXTEND `@AC-10 @feature-185`). The BFF
`listOpportunities` is a raw passthrough (`insightsBff.ts:54`), so the field auto-flows to the typed
client after regen.

**Cardinal guard (MUST-FIX, promoted from Open Risk — round 4).** `composite_score` is the most
attractive future instance of the `fails.md:313` trap (a single named 0–1 "score", already rendered and
projected). Two durable, blocking instruments land in the implementation: **(a)** a proto field-21
doc-comment mirroring `conviction`'s "NOT a probability" note (`analysis.proto:555-557`) — stating the
field is a shrunk ranking ordinal, never a cardinal sizing/alert/risk input, NULL = nothing to fuse;
**(b)** a new `ANALYSIS-N` invariant in `services/xstockstrat-analysis/docs/context-constitution.md`
naming `ExternalSignal.conviction` (`ingest.proto:110`) as the correct confidence-to-size producer.
Not an `@AC` scenario (a negative future guard has no consumer to assert against yet).

## Rejected Alternatives

- Fuse all four evidence types — rejected: fundamentals already folds into `signal_axis` (double-count)
  and technical is out-of-path behind `servicer.py:667` (new per-symbol RPC, breaks `@AC-6..9/191`
  latency); FR-5 changed to two axes with sign-off.
- One-sided readiness transform `0.5 + 0.5·conviction` — rejected: inflates weak setups (0.1→0.55),
  discards the ordinal's discriminating lower half, and (with k=4) compressed the score to ~0.667 max.
- `k = 4.0` (inherited from feature-065) — rejected: dimensionally wrong for two unit weights; the prior
  would dominate the evidence and cap a perfect setup at 0.667.
- Linear-cancellation direction discount `max_agree − max_conflict` — rejected: hard parity cliff
  (0.70/0.70 → 0) discards the strong-vs-weak distinction exactly in the contested region.
- Ratio/share direction discount `a/(a+c)` — rejected: scale-free, makes weak-clean ≡ strong-clean,
  fatal for a ranking score.
- `scoring.py` `(net+1)/2` net-agreement fold — rejected: 0.5-neutral sum/count basis inconsistent with
  the MAX-based `signal_axis` sibling; re-introduces an incommensurable scale.
- Extract a shared `_eb_shrink` from `_aggregate_cells` — rejected: touches the ANALYSIS-2 binding grade
  path for a one-line formula whose two callers weight by different quantities (`int` days vs `float`
  weights); inline is the lower-risk, least-mechanism choice.
- Asymmetric axis weights as the default — rejected: equal weights keep the composite maximally distinct
  from the standalone `conviction` column and the queue's `signal_rank_weight=0.3` sort; asymmetry is a
  config change, not a design change.
- Config-ui seed migration for the three keys — rejected: matches the un-seeded sibling `analysis.scoring.*`
  keys; they are pure tuning constants (code-default-only via `get_float_present`).

## Open Risks

- [ ] Heal-path direction parity — the heal recompute must derive `best_direction` from **raw** conviction
  (matching `servicer.py:4095`), and the heal-parity test must cover a **mixed-direction** symbol
  (buy+sell present), not just single-direction. To be addressed at the analysis service+test steps (/sdd-spec).
- [ ] Anchor/measure split — `best_direction` is chosen on raw conviction while agree/conflict magnitudes
  use decayed effective_conviction (a stale-strong-raw-buy + fresh-strong-sell → low edge). Intended, not a
  bug; document in the analysis test step so a future reviewer doesn't "fix" it.
- [ ] `@AC-14` determinism — holds by construction (composite computed at write time, before read-time
  `_enrich_opportunities_live`), but /sdd-spec must carry an **executable** determinism assertion, not prose.
- [ ] Rebase re-derivation — re-confirm proto field `= 21` and migration `= 024` against the merged tree at
  /sdd-spec (soft same-file overlap with features 187/193/188, recon.md:85).

## Constitution Rules Touched

- `C-05` — honored: three new keys `analysis.scoring.composite_shrinkage_k`/`composite_weight_readiness`/`composite_weight_signal`, `<service>.<category>.<key>` form, code-default via `get_float_present`, documented in analysis CLAUDE.md.
- `C-07` — honored: new migration `024` (disk tip `023`; CLAUDE.md's 026/027/028 are drift), up+down, nullable column, no edit to an applied migration.
- `C-08`/`P-06` — honored: analysis service step paired with a red-before-green unit-test step covering the fusion math, NULL boundary, presence predicate, direction discount, and heal parity.
- `C-09` — honored: additive-only proto field, `buf lint`+`buf breaking` pass, `buf-gen.sh` regen commits `gen/`.
- `C-10`/`C-14` — honored: composite surfaced on `/insights` + `/trader` + `list_opportunities`, each an implementation step; agent descriptor-parity test enforces same-PR projection.
- `C-16` — CHANGE to FR-5 signed off (context.md); `@AC-4`/`@AC-6` amended; all other opportunity `@AC-*` guarantees PRESERVED/EXTENDED (see below).
- `C-18` — honored: two-axis (no dead fundamentals/technical scaffolding), inline EB (no premature extraction), multiplicative discount with no new config key, symmetric weights as least-mechanism default; trade-offs recorded above.
- `F-01`/`F-04`/`F-06`/`F-07` — honored: new migration (no applied edit); all cited paths real; no new DB pool / no per-symbol RPC (compute is in-path arithmetic); config via `WatchConfig`/`get_float_present`, no hardcode.

## Business Rules Touched (C-16)

- CHANGE FR-5 (product-spec) "all four evidence types" → "the two available axes (readiness + signal)"; signed off by user @ 2026-09-20 (context.md). `@AC-4`/`@AC-6` amended accordingly.
- PRESERVE `@AC-10/@AC-1/@AC-2/@AC-3 @feature-190` (opportunities-server-side-filters) — composite is a new column, not the sort key or the floor axis; readiness copy never re-derives `conviction`.
- PRESERVE `@AC-1/@AC-2/@AC-5 @feature-185` (opportunity-compute-robustness) — data-unavailable → NULL composite (computed before axis-zeroing), sentinel survives round-trip.
- PRESERVE `@AC-6..9 @feature-191` (latency), `@AC-1 @feature-176` (concurrency) — compute is in-path arithmetic, no new RPC, deterministic under fan-out.
- PRESERVE `@AC-15 @feature-190` (UI) — display only; no client-side re-sort by composite.
- EXTEND `@AC-8 @feature-185` — heal path also recomputes+repersists the composite.
- EXTEND `@AC-11 @feature-095` (UI) — NULL composite renders em-dash, never `0.000`.
- EXTEND `@AC-9/@AC-10 @feature-155` (UI) — composite rendered on desktop `SymbolGroupCard` + mobile `SignalRow` without regressing grouping.
- EXTEND `@AC-10/@AC-15 @feature-185/095` (agent) — projection adds `composite_score` (descriptor-parity), omits/em-dashes NULL rather than fabricating.
