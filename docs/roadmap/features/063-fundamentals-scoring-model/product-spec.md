# Product Spec: fundamentals-scoring-model

**Created**: 2026-06-26
**Priority Bucket**: P2 — The scoring math behind the fundamentals signal (6 of 6); depends on 059

---

## Problem Statement

Feature 062 can publish a fundamentals signal, but "what makes a symbol a `buy`?" is undefined. We
need a concrete, transparent, tunable scoring model that maps raw fundamentals (P/E, P/B, ROE,
dividend yield, debt/equity, EPS) into one comparable 0–1 score — without hardcoding opinions in
service code.

## User Story

As a **quant author**, I want a default value+quality fundamental score I can inspect and retune, so
that the fundamentals signal reflects a defensible, adjustable model rather than a black box.

## Functional Requirements

FR-1. Ship a **default "value+quality composite" formula**, registered as a public formula
(`is_public=true`, system author) via `RegisterFormula`, that the 062 producer references by
`scoring_formula_id`.

FR-2. **Reuse the sandbox**: the formula receives a single symbol's fundamentals as the sandbox `data`
variable (analysis puts them in `ExecuteFormula.input_data` — `input_data` is an arbitrary Struct, so
**no sandbox change and no new injected variable**), and tunables (sub-weights, bands) as `params`
(typed Feature-052 parameters).

FR-3. **Composite definition** (v1): `composite = value_weight × value_subscore + quality_weight ×
quality_subscore`, each sub-score the normalized average of its inputs:
  - *Value*: low P/E, low P/B, high dividend yield.
  - *Quality*: high ROE, low debt/equity, positive EPS.
  - Output: `{ "value": 0..1, "quality": 0..1, "composite": 0..1 }`.

FR-4. **Per-symbol absolute scoring (v1 normalization choice):** each metric maps to 0–1 via **fixed
sane bands** (below), clamped to [0,1], so the formula is a **pure per-symbol function** with no
dependency on the rest of the universe. *(Cross-sectional peer normalization is a documented
enhancement done in 062's orchestration, not the formula.)*

  **Default bands** (resolves OQ-063-a — anchored on Benjamin Graham for value, ROE/Piotroski
  conventions for quality; see Research Basis):

  | Sub-score | Metric | Dir. | → 1.0 (good) | → 0.0 (bad) | Special handling |
  |---|---|---|---|---|---|
  | Value | `pe_ratio` | lower | ≤ 10 | ≥ 35 | P/E ≤ 0 (lossmaking) → 0.0 |
  | Value | `pb_ratio` | lower | ≤ 1.0 | ≥ 5.0 | negative book → 0.0 |
  | Value | `dividend_yield` | triangular | peak 1.0 at ~4% | 0.0 at 0% and ≥ 10% | trap-aware: rise 0→4%, fall 4→10% |
  | Quality | `roe` | higher | ≥ 25% | ≤ 5% | cap at 25% so leverage can't run it up |
  | Quality | `debt_to_equity` | lower | ≤ 0.3 | ≥ 2.0 | negative equity → 0.0 |
  | Quality | `eps` (sign) | binary | EPS > 0 → 1 | EPS ≤ 0 → 0 | Piotroski-style profitability gate |

  Default weights: `value_weight = 0.5`, `quality_weight = 0.5`. `beta` and `market_cap` are available
  from Feature 059 but **excluded** from the value+quality composite (beta → future low-vol/risk
  factor; market_cap → size factor / liquidity filter).

FR-5. **Missing-data robustness:** a metric absent for a symbol (e.g. no dividend) contributes
**neutrally** (drops out of its sub-average) rather than erroring or zeroing the whole score; the
formula always returns a valid result.

FR-6. **Tunable, no-deploy:** sub-weights and band endpoints are formula `params`, so retuning the
model is a parameter change, not a code change.

## Research Basis

- **Value (Benjamin Graham):** "fair" ceilings P/E 15 and P/B 1.5 (Graham Number = √(22.5·EPS·BVPS));
  strict screen P/E ≤ 9, P/B ≤ 1.2. Graham's P/E is rate-dependent — current low yields justify
  stretching toward ~25–30, hence the band's 0.0 endpoint at 35 and 1.0 at 10 (Graham 15 ≈ 0.80).
- **Quality (ROE / Piotroski):** ROE 15–20% is "good," <10% weak (band: 5%→0, 25%→1; 15% ≈ 0.50).
  D/E healthy 0.5–1.5, ~1.0 neutral, ≥2.0 high (band: 0.3→1, 2.0→0). EPS sign = Piotroski-style 1/0.
- **Dividend yield (convention):** 2–4% healthy income; >6–8% often a yield trap — hence the
  triangular (non-monotonic) band peaking at ~4%.
- Sources: Cabot Wealth (Graham criteria), Investing Engineer (Graham Number), GrahamValue
  (rate adjustment), Corporate Finance Institute (ROE), Towerpoint Wealth (D/E), StableBread &
  Wikipedia (Piotroski F-Score).

## Out of Scope

- The producer/scheduler/budget/ingest plumbing (Feature 062).
- Growth and momentum factors (value+quality first; additive later).
- Cross-sectional/peer normalization beyond the documented hook (lives in 062).
- The direction/conviction mapping (062 owns quantiles).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-indicators` — the default formula registration + sandbox execution.
- `xstockstrat-analysis` — consumes composite + sub-scores.

## Proto Contract Changes

- [x] No proto changes required (reuses `RegisterFormula` / `ExecuteFormula` / typed parameters).

## Config Key Changes

- `analysis.fundsignal.value_weight` (float, `0.5`) and `analysis.fundsignal.quality_weight`
  (float, `0.5`) — **or** carried as formula params (decided at impl-spec; no new keys if params chosen).

## Database Changes

- [x] No schema changes (the formula persists in `indicators.formulas` via existing
  formula-management, Feature 003).

## Feature Workflow Notes

Branch to create: `feature/fundamentals-scoring-model` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-indicators`)
- [ ] No proto / migration gates

**Depends on** 059 (the metric fields exist) and the existing formula-parameters infra (Feature 052).

## Acceptance Criteria

1. Given a symbol's fundamentals as `input_data`, the default formula returns `{value, quality,
   composite}` all in 0–1.
2. A cheap, high-quality, low-debt dividend payer scores high `composite`; an expensive, high-debt,
   negative-EPS name scores low.
3. A symbol missing dividend yield still returns a valid score (neutral contribution), not an error.
4. Changing `value_weight`/`quality_weight` (params) shifts the composite without redeploying any service.
5. Wired into Feature 062, the composite drives directions that match intuition on a small labeled sample.

## Resolved Decisions

- [x] **Default bands** (OQ-063-a): the table in FR-4, anchored on Graham (value) + ROE/Piotroski
  (quality) + dividend-trap convention.
- [x] **Value + quality only for v1** (OQ-063-b): income/growth additive later.
- [x] **Weights/bands as formula `params`** (OQ-063-c): retune with no deploy (reuse Feature 052).
- [x] **Per-symbol absolute bands in the formula** (OQ-063-d): peer-relative normalization, if wanted,
  lives in 062's orchestration so the formula stays a pure per-symbol function.

## Open Questions

- [ ] None — all resolved during design (see Resolved Decisions). Bands are tunable params, so any
  later refinement (e.g. tightening P/E toward Graham's strict ≤ 9) is a config change, not a re-spec.
