# Product Spec: mpt-portfolio-optimization

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Use Markowitz mean-variance optimization to compute the theoretically optimal allocation weights across the portfolio's candidate positions. The analysis service would output expected returns and a covariance matrix; a new optimizer would solve for the minimum-variance or maximum-Sharpe frontier; the resulting weights would drive position sizing in the trading service.

## Why It Seems Valuable

- MPT is the academic gold standard for portfolio construction, covered in every finance curriculum.
- It provides a mathematically principled reason for why capital is allocated a certain way.
- The analysis service already produces per-signal scores — these look like expected return proxies.
- It makes the platform sound rigorous and defensible to external stakeholders.

## Why It Is Not Worth Building

**1. Expected returns cannot be estimated reliably.**
MPT requires as inputs: a vector of expected future returns per asset and a covariance matrix. The expected return estimate is the dominant source of portfolio instability. Small errors in the return vector (which is structurally unknowable in advance) produce wildly different "optimal" weights. Michaud (1989) and numerous successors showed that MPT portfolios constructed from sample estimates are optimization error maximizers — they overweight assets with estimation errors in the positive direction and underweight those with negative errors.

**2. The covariance matrix is numerically unstable in small-sample regimes.**
Robust covariance estimation requires on the order of N² / 2 observations for N assets, where observations must span multiple market regimes. A 10-asset portfolio needs ~50 observations minimum; 50 assets needs ~1,250. With daily returns, that is 5 years of history — and the covariance matrix from 2019–2024 is not the same as the one that will govern 2025–2026. In practice, the inverse covariance matrix (required for the optimization) becomes ill-conditioned and the resulting weights are numerically meaningless.

**3. MPT portfolios concentrate in low-variance assets and collapse in correlated crashes.**
The optimizer systematically overweights low-variance assets. In a market crash (March 2020, 2022 rate shock), correlations across all equity assets converge toward 1.0 — the very moment when diversification benefit is most needed, the MPT portfolio fails to provide it. This is not a known limitation to be engineered around; it is a fundamental property of mean-variance optimization on equity data.

**4. The analysis service scores are not expected returns.**
MPT requires expected return estimates in the same unit (e.g., annualized percentage return). The platform's signal confidence scores (0.0–1.0, output of the analysis scoring loop) are ordinal conviction measures, not return estimates. Treating them as expected returns would produce an undefined optimization with no theoretical foundation.

**5. Feature 023 (position-sizing-engine) already solves the practical problem.**
The actual need is: "don't put too much capital in any one trade." The position sizing engine (feature 023) solves this with: per-trade risk cap (% of equity), concentration limit (% of equity per position), and ATR-based stop distance. These are interpretable, debuggable, and robust. MPT adds mathematical complexity and false precision without improving the practical outcome.

## Better Alternatives Already Planned or Implementable

- **Feature 023 — position-sizing-engine**: ATR + equity risk cap + concentration limit. Directly solves the capital allocation problem without unstable estimation.
- **Risk parity** (equal risk contribution per position): simpler than MPT, more robust, does not require return estimates. Can be added as a V2 extension to feature 023 if needed.
- **Equal-weight with concentration cap**: the simplest defensible allocation — equal weight across N open positions, capped at `max_concentration_pct`. Often outperforms MPT in out-of-sample tests due to estimation error avoidance.

## Conditions Under Which This Should Be Reconsidered

- A robust alternative data source provides reliable forward-return estimates (e.g., analyst consensus with demonstrated accuracy over 3+ years).
- The portfolio has grown to 30+ simultaneous open positions where correlation management becomes material.
- A dedicated quantitative researcher implements and validates a shrinkage estimator (e.g., Ledoit-Wolf) or Black-Litterman extension that addresses the estimation instability problem — as a research project, not a platform feature.

## Affected Services

_Not applicable — demoted before any design._
