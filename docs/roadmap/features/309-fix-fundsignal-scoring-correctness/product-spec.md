# Product Spec: fix-fundsignal-scoring-correctness

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md`, `docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md`, `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md`, `docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### Formula-path fundamentals producer scores absent metrics as 0.0, giving P/B and D/E a top score (SEV-2)

- **Observed**: the formula path builds its input from raw proto3 scalars and ignores `missing_metrics`, so
  absent metrics reach `ExecuteFormula` as 0.0; in `value_quality` `pb_ratio`/`debt_to_equity` 0.0 score
  1.0 and `pe_ratio`/`roe`/`eps` 0.0 score 0.0. Partial rows get a composite fabricated from wire zeros.
  Only reachable when `analysis.fundsignal.scoring_formula_id` is set (seeded empty).
- **Expected**: absent metrics are omitted from the formula input, as the strategy path does; the formula
  averages only present sub-parts.
- Report: [`docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md`](../../../reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md)

### Fundamentals producer labels a lone scored symbol "buy" whatever its score (SEV-2)

- **Observed**: `_map_directions` uses a nearest-rank quantile over the run's scores; with one scored symbol
  both cuts equal its score and `s >= buy_cut` is tested first, so a 0.05 score emits `buy`. 2–4 symbol
  sets collapse similarly.
- **Expected**: direction reflects the score, not only its rank in a degenerate cross-section; a lone low
  score is not `buy`.
- Report: [`docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md`](../../../reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md)

### A signal with conviction 0.0 is read back as neutral 0.5 by the signal scorer (SEV-2)

- **Observed**: ingest stores conviction 0.0 as NULL and reads it back as 0.0; `compute_signal_score`
  treats any non-positive conviction as unknown and substitutes 0.5, so screener and backtest weight a
  deliberate 0.0 as mid-conviction. Feature 246 FR-2 plus the default `min_conviction_to_emit` 0.0 makes
  0.0 emissions reachable.
- **Expected**: a stored conviction of 0.0 is scored as 0.0, distinct from "conviction not given".
- Report: [`docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md`](../../../reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md)

### Fabricated 0.5 fundamentals signals already stored in ingest are never retracted (SEV-2)

- **Observed**: signals emitted before feature 246 for data-less symbols sit in `ingest.newsletter_signals`
  with conviction 0.5, `user_id='system'`, `valid_until` = emit + `valid_days` (default 90), and keep
  feeding the live blend universe, `ListOpportunities` (`/insights/opportunities`, MCP
  `list_opportunities`), and fundamentals-weighted screeners/backtests. Dev and production.
- **Expected**: every stored fundamentals-source signal emitted for a data-less symbol is expired, so no
  reader sees it as active.
- Report: [`docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md`](../../../reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md)

## Reproduction Steps

1. Wire zeros: set `analysis.fundsignal.scoring_formula_id` to the system `value_quality` formula; run a
   cycle over a symbol with `pe_ratio, pb_ratio, roe, debt_to_equity, eps` in `missing_metrics` and
   `dividend_yield` 0.013 → `ExecuteFormula` receives five 0.0 keys; pb and de sub-scores are 1.0.
2. Lone symbol: `analysis.fundsignal.universe_source=explicit` with one low-scoring symbol (pe_ratio 40,
   roe 0.0, eps -1); non-dry-run cycle → emitted `direction="buy"`.
3. Zero conviction: ingest `ExternalSignal{direction="buy", conviction=0.0}`; run a screener/backtest that
   weights the source → `compute_signal_score` adds 0.5 × weight to `buy_conviction`.
4. Not retracted: on an environment where the producer ran pre-246, query `ingest.newsletter_signals` for
   `user_id='system'`, `source='fundamentals'`, `conviction=0.5` → rows for SPY/VOO/QQQ with future
   `valid_until`, still present after 246.

## Root Cause Hypothesis

proto3 doubles have no wire presence, so 0.0 doubles as "absent" on both the producer's formula input and
signal conviction (INGEST-4 sentinel); the direction mapping has no minimum cross-section size or absolute
floor; feature 246 was producer-side only and stored signals have no retraction path. Current sites
(main-dev @ 0fecb24d):

- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:565-590` `_score_via_formula` — input dict
  at `:571-578`; only the all-missing case is skipped (`:579`).
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:592-608` `_map_directions` (now also folds
  the day's stored `reference_scores` into the cross-section, which does not help a first/lone run);
  `_quantile` `:793-802`.
- `services/xstockstrat-analysis/app/services/scoring.py:31` — `> 0 else 0.5`.
- `services/xstockstrat-ingest/app/handlers/servicer.py:1055` (0.0 → NULL on write), `:1301` (NULL → 0.0 on read).
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:282` `valid_days`; `:277,290` `min_conv` gate.
- `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py:146,174` (pb/de bands).
- Durable `services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47`
  (`@AC-8 @FR-5 @FR-6 @feature-201`) pins the current wire-zero partial-row behaviour.

## Affected Services

- xstockstrat-analysis (producer formula input, direction mapping, signal scorer)
- xstockstrat-ingest (conviction storage/read-back; stored-signal retraction)
- xstockstrat-indicators (`value_quality` formula semantics for absent keys)
- Consumer surfaces: `/insights/opportunities` (xstockstrat-ui) and MCP `list_opportunities` (xstockstrat-agent) read the affected signals

## Fix Scope

- Proto changes: **possibly** — telling an explicit conviction 0.0 from "not given" over a proto3 `double` may need field presence (`optional`) or another sentinel (report 3); none needed for reports 1, 2, 4.
- DB migrations: **yes (data, not schema)** — report 4 needs a one-off per-environment expiry of stored fabricated signals (`valid_until = now()`); report 3 may also need a storage change so 0.0 is not written as NULL.
- Config key changes: **possibly** — a minimum cross-section size or absolute `buy` floor (report 2) would be a new `fundsignal.*` key under no-hardcoded-values.

## Open Questions

1. **C-16 signed off 2026-11-10 (operator):** durable `@AC-8 @feature-201` (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47`) is rewritten so the producer also omits absent metrics — the strategy composite then **matches** the producer on a partial row instead of differing from it.
2. Report 2: minimum cross-section size, an absolute score floor for `buy`, or both — and the values (config-seeded?).
3. Report 3: how is explicit 0.0 distinguished from absent — proto `optional`, a changed INGEST-4 sentinel, or another mechanism — and how are existing NULL-conviction rows interpreted?
4. Report 4 — **retraction approved in principle 2026-11-10 (operator, as DBA + ingest owner)**; still open for `/sdd-design`: operator SQL run once per environment vs a numbered migration; how each candidate is confirmed data-less (marketdata fundamentals cache vs operator review, amendment a); and whether an opportunity recompute is triggered or the reader lag is accepted (amendment b).
5. Report 4 precheck: was `analysis.fundsignal.scoring_formula_id` ever set in an environment (if so, formula-path wire-zero rows are also retraction candidates)?
6. Report 4 residual (c): partial-row wrong-score signals outside the 0.5 predicate — in scope or left to expire via `valid_days`?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- A new ingest RPC to expire system-owned signals — report 4 calls it overbuilding for a one-off cleanup.
- The data-less 0.5 emission itself — fixed by feature 246.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
