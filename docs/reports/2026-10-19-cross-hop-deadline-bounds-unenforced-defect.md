# Defect: Cross-hop read deadline ordering is not enforced by config bounds

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: config-validation-gap
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-analysis
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Latent bugs ("Cross-hop deadline ordering…"); `docs/context-constitution.md` PLAT-13; `services/xstockstrat-config/docs/context-constitution-findings.md:24`; `services/xstockstrat-portfolio/docs/context-constitution-findings.md:15`

## Observed
PLAT-13 requires each hop's worst case to stay inside its caller's deadline, and the registry's own
comments state the invariants (portfolio quote deadline > marketdata cold budget + warm read;
analysis B+3.05+E < 30s). But `SCALAR_BOUNDS_REGISTRY` bounds each key independently:
- `portfolio.marketdata.quote_timeout_ms` `[500,8000]` overlaps `marketdata.quotes.batch_timeout_ms` `[500,5000]`.
- `analysis.opportunity.live_enrich_timeout_ms` min `500` is below `marketdata.price.batch_timeout_ms` max `2500`.
Two individually valid `SetConfig` writes can invert the ordering; the result is silently unpriced
positions / unenriched opportunities (the inner fetch outlives its caller), not an error.

## Expected
`SetConfig` rejects writes that break the documented cross-key ordering, or the bounds are made
non-overlapping.

## Reproduction
1. `SetConfig portfolio.marketdata.quote_timeout_ms = 1000` (accepted).
2. `SetConfig marketdata.quotes.batch_timeout_ms = 5000` (accepted).
3. Request portfolio positions with cold quotes; portfolio's 1s deadline expires before marketdata's
   cold fetch completes, and positions come back without live prices.

## Evidence
`services/xstockstrat-config/src/grpc/configServiceImpl.ts:134-136`
> // feature 229: retention floor (31d) must stay above the lookback ceiling (720h); the portfolio quote
> // deadline (default 4000) must exceed the marketdata cold budget (2500) plus the warm read.
> 'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 },

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:138`
> 'marketdata.quotes.batch_timeout_ms': { minValue: 500, maxValue: 5000 },

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:131-132`
> 'analysis.opportunity.live_enrich_timeout_ms': { minValue: 500, maxValue: 4000 },
> 'marketdata.price.batch_timeout_ms': { minValue: 500, maxValue: 2500 },

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:397`
> qctx, cancel := context.WithTimeout(ctx, s.quoteTimeout())

## Root cause hypothesis
The bounds registry has only per-key min/max validation; cross-key invariants live in comments.

## Confidence
high
