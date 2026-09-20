# Recon: opportunity-composite-score

**Created**: 2026-09-20
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, packages/proto, xstockstrat-ui, xstockstrat-agent, xstockstrat-config

---

## Objective

Persist a single 0–1 composite score per opportunity row (`user × symbol_norm × strategy_id`) that
fuses the available evidence types via breadth-aware empirical-Bayes shrinkage, computed on the
existing opportunity-refresh write path in `xstockstrat-analysis` and surfaced on the `/insights`
queue, `/trader` per-symbol page, and the `list_opportunities` MCP tool — alongside, never replacing,
the existing `conviction` and `signal_axis` axes (never-fold invariant preserved).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Opportunity materialization: `AnalysisServicer._compute_opportunities` — `app/handlers/servicer.py:3861`
  - Per-row build: `_row_for` — `servicer.py:4253`; action int stored `:4304`
  - `signal_axis` MAX-over-decayed-signals: `servicer.py:4094`; per-signal decay `_signal_decay` — `servicer.py:4926` (`effective = conviction·source_weight·exp(−ln2/half_life·age)`, `:4944-4947`); half_life read `:3885`
  - Readiness ordinal: `_conviction_ordinal` / `_readiness_from_evals` — `app/services/evaluator.py:739,762` (passing/total leaves nudged by distance-to-threshold; `total==0 → 0.0`)
  - Direction/thesis from **highest raw conviction** signal: `servicer.py:4095-4099`; action mapping `_action_for` `:4891`, `_resolve_action_tag` `:4960`
  - Persistence: `app/repositories/opportunities.py` — INSERT cols `:81-84` (`…conviction, readiness_json, signal_axis, provenance, thesis, valid_until`), whole-user replace `replace_for_user:68-102`, heal-only `replace_symbols:104`, read blend/ORDER BY `:35-36`
  - Empirical-Bayes helper (feature 065, REUSE candidate): `_aggregate_cells` — `servicer.py:5187` (`overall=(Σwᵢ·sᵢ+0.5·k)/(Σwᵢ+k)`, `Σw==0 → None`, `:5202-5226`); `_score_from_metrics:5145`, `_grade:5174`
  - Config-read: `get_float_present` — `app/config/watcher.py:132` (returns stored `0.0`); mirror sites `signal_decay_half_life_hours` `:3885`, `shrinkage_days` via `get_int` `:2082`
  - Last migration on disk: `023_opportunity_compute_state.up.sql`; `analysis.opportunities` DDL created by `011_opportunities.up.sql` (conviction `:14`, signal_axis `:16`, PK `(user_id, opportunity_key)` `:21`)
- **`xstockstrat-ui`** (Next.js)
  - `OpportunityRow` conviction bar: `src/app/insights/opportunities/page.tsx:454,483-492`; `SymbolGroupCard` "N signals" header `:417-419`; mobile map `:183`
  - Trader per-symbol `OpportunitySection`: `src/app/trader/positions/[symbol]/page.tsx:934-991` (Conviction `:949`, Edge(BT) `:977-985`)
  - Score display: `scoreColor` — `src/lib/scoreDisplay.ts:13-17`; `ratingVariant:6-11` (NO 3-decimal formatter — only `formatSymbolYears` `.toFixed(1)`)
  - BFF: `listOpportunities` raw passthrough — `src/lib/insightsBff.ts:54` (new field auto-flows after regen); TS `Opportunity` type from generated proto (`page.tsx:30`)
  - Fixtures: `e2e/fixtures/opportunities.ts:54-226` + `INVENTORY.md:28`
- **`xstockstrat-agent`** (Python MCP)
  - `list_opportunities` tool: `app/tools.py:1229` (passthrough); gRPC call `app/client.py:819`; **explicit field-by-field projection** `_opportunity_to_dict` — `app/client.py:747` (base dict `:754-768`, HasField-gated optionals `:770-798`) — **NOT MessageToDict, needs a code edit**
  - Descriptor-parity guard: `tests/test_opportunity_projection.py:50` (asserts projection == full `Opportunity` descriptor) + `_full_opportunity` builder `:18`
  - Return-shape doc: `docs/runbooks/mcp-tools.md:857`
- **`packages/proto`**: `Opportunity` message `analysis/v1/analysis.proto:558-593`; `conviction=3` `:561`; max field `data_unavailable=20` `:592` → **next free = 21** (`optional double composite_score = 21` fits the optional-double presence convention used by `signal_confidence=19`)

## Patterns to REUSE

- Shrinkage fusion → **reuse the feature-065 empirical-Bayes shape** `_aggregate_cells` (`servicer.py:5187`), incl. its `Σw==0 → None` degenerate handling (maps directly to FR-3 / AC-10 NULL). Do not re-invent the formula.
- Direction/agreement scoring → **reuse `scoring.compute_signal_score` normalization semantics** (`app/services/scoring.py:10`) and `buy_threshold` transform rather than a new normalizer (ledger `insights.md:1135`). NOTE: these are screener/backtest-only today (`servicer.py:667` boundary) — reuse the *transform*, not necessarily the call site.
- Config reads → **reuse `get_float_present`** (`watcher.py:132`) for every `analysis.scoring.composite_*` key so a configured `0` disables an evidence type honestly.
- UI coloring → **reuse `scoreColor`** (`scoreDisplay.ts:13-17`); add a 3-decimal formatter (none exists).
- Persistence → **reuse `replace_for_user` / `replace_symbols`** write path and best-effort try/except (`hydrate_scores`-style, `insights.md:973`); composite is one more column on the same INSERT.
- Agent projection → **extend `_opportunity_to_dict`** (`client.py:747`) + its parity test + `mcp-tools.md:857` in the same PR.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-10 @feature-190` "Conviction sort is the default ordering" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`) — composite is a new column, NOT the queue sort key (Out-of-Scope: rank blend + `signal_rank_weight` unchanged).
- **PRESERVE** `@AC-1 @feature-190` "Min-conviction floor is server-side" — the floor stays on `conviction`; composite must not displace it.
- **PRESERVE** `@AC-2/@AC-3 @feature-190` "muted/data-unavailable row survives a raised floor" — zeroed-axis sink + floor-exemption must survive; composite must not re-float these rows.
- **PRESERVE** `@AC-1/@AC-2/@AC-5 @feature-185` "data-unavailable ≠ evaluated 0/0; sentinel survives round-trip" (`opportunity-compute-robustness.feature`) — grounds FR-3 missing-vs-low; the new column must not corrupt the sentinel on read-back.
- **EXTEND** `@AC-8 @feature-185` "surgical self-heal restores both conviction and signal_axis" — the heal write must **also recompute + repersist the composite**, else a healed row shows a stale/NULL composite.
- **EXTEND** `@AC-14 @feature-095` "folding in the live quote does not leak look-ahead into ranking" (`opportunity-live-market-enrichment.feature`) — composite must be identical with/without live quote (grounds FR-6 determinism).
- **PRESERVE** `@AC-6..9 @feature-191` (`opportunities-latency-fix.feature`) — composite math runs on this write path; add **no per-symbol GetBars / serial drain / TTL-misaligned** regression.
- **PRESERVE** `@AC-1 @feature-176` (`analysis-concurrency-offload.feature`) — deterministic set + rank order under concurrent fan-out.
- **PRESERVE** `@AC-15 @feature-190` (UI) "client renders server order verbatim, no client-side sort" — display the composite but do NOT client-sort by it.
- **PRESERVE** `@AC-3 @feature-185` (UI) "Decide queue renders unavailable explicitly (C-17)" — composite display must not mask the unavailable cue.
- **EXTEND** `@AC-11 @feature-095` (UI) "unavailable value is em-dashed, never fabricated" — a NULL composite renders em-dash, never `0.000`.
- **EXTEND** `@AC-9/@AC-10 @feature-155` (UI) "mobile groups by symbol + shows tags" — render composite alongside existing tags on desktop `SymbolGroupCard` AND mobile `SignalRow` without regressing grouping (C-14 both surfaces).
- **EXTEND** `@AC-10 @feature-185` (agent) "list_opportunities projects data_unavailable + descriptor-parity test" — the additive composite field MUST be added to the projection in the same PR or the parity test fails.
- **EXTEND** `@AC-15 @feature-095` (agent) "omit absent value, don't fabricate zero" — map a NULL composite following omit-rather-than-fabricate discipline.
- No **CHANGE** verdicts → no C-16 sign-off required, **provided** the design normalizes a *copy* of `conviction` and does not re-derive/re-scale the persisted `conviction` column (that would flip `@AC-1/@AC-10 @feature-190` to CHANGE).

## Dependencies

- Proto/RPC: additive `optional double composite_score = 21` on `Opportunity` (`analysis.proto:558-593`); non-breaking. Regen + commit `gen/` (C-09).
- Migration: next number **`024`** for `services/xstockstrat-analysis/migrations/` (disk tip `023`; **CLAUDE.md drift** cites 026/027/028 — do not trust it). Nullable `composite_score` column on `analysis.opportunities`.
- Config keys (new, `analysis` namespace): `analysis.scoring.composite_shrinkage_k` + per-evidence `composite_weight_*` — set finalized by the debate (see Risks: the "four" set is contested).
- Inter-service edges: none new **if** fusion uses only in-path evidence. Adding a distinct fundamentals axis would require a new per-symbol read to indicators `ExecuteFormula` or the fundsignal cache; adding technical would require per-opportunity component-series assembly (marketdata/indicators) — both new edges/cost.
- New env vars/ports: none.

## Risks / Not-found

- **SCOPE-COLLISION (biggest) — "all four evidence types" (FR-5) vs the code.** Only **two** axes exist at `_compute_opportunities`: readiness `conviction` and `signal_axis`. **Fundamentals value+quality is NOT a distinct axis in the opportunity path** — it is produced by `fundsignal_loop.py`, emitted as `ExternalSignal`s, and re-enters generically as active signals feeding `signal_axis` (`servicer.py:4094`). Folding fundamentals as a 4th sub-score would **double-count** it. **Technical signal is NOT in the opportunity path at all** — `compute_signal_score`/`combine_score` are screener/backtest-only behind an explicit boundary (`servicer.py:667`). Pulling either in is net-new plumbing + cost, not a v1 given. **Must be resolved with the user in the debate.**
- **NORMALIZATION (ledger `fails.md:313`/`:418`)** — `conviction` is a deterministic ordinal, explicitly "NOT a probability" (`analysis.proto:555-557`); `signal_axis` derives from a real 0–1 confidence. The shrinkage prior 0.5 assumes commensurable probability-like sub-scores. Design must define + justify an explicit normalization map per sub-score. Downstream-cardinal guard: confirm the composite is never wired into a sizing/alert cardinal path (`platform.feature:102-114`, `wire-signal-confidence-to-position-sizing.feature`).
- **Direction-scoping mechanics (FR-4)** — "contradicting evidence discounts magnitude" is unspecified; reuse `scoring.py` transforms, not a new one.
- **Determinism / latency (PRESERVE @AC-6..9/191, @AC-1/176, @AC-14/095)** — composite math must add no per-symbol RPC, must be identical with/without live quote, and stable under concurrent fan-out.
- **Heal-path parity (EXTEND @AC-8/185)** — `replace_symbols` heal must recompute the composite too.
- **NULL vs 0.5 boundary (FR-3, AC-10)** — `Σwᵢ=0` should persist NULL ("nothing to compute"), distinct from a computed neutral 0.5; UI em-dash (EXTEND @AC-11).
- **Config defaults churn (ledger)** — pick config-service-backed defaults for `k` + weights up front; document in analysis `CLAUDE.md`.
- Soft same-file rebase risks (overlap scan): 187 (`opportunities.py` read ORDER BY), 193 (`_compute_opportunities` body), 188 (`OpportunityRow` markup). Re-derive field 21 / migration 024 from the merged tree at `/sdd-spec`.

## Recommended Scope

Advisory (grilling + `/sdd-spec` refine): (1) proto field 21 + regen; (2) migration 024 nullable column; (3) analysis fusion pure-function (reuse `_aggregate_cells` shape) + config keys + wire into `_compute_opportunities` and the heal path + persistence; (4) analysis unit tests (fusion math, NULL boundary, determinism, heal parity); (5) agent projection + parity test + `mcp-tools.md`; (6) UI render (desktop row + trader section + mobile) + 3-decimal formatter + fixtures; (7) UI e2e. **Gate 0 for the debate:** settle the evidence-set scope (2 present axes vs adding fundamentals/technical) before any of this.
