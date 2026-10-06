# Defect: Opportunity composite score is coloured with strategy-grade thresholds, so neutral reads as bearish

**Recorded**: 2026-10-06
**Severity**: SEV-3
**Impact type**: misleading-signal-display
**Environment**: dev (staging)
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no

## Observed

Every AXP opportunity (three strategies, conviction 100, readiness 1/1) shows composite `0.500` in
red on the Decide queue and the trader position page. 0.500 is the neutral point of the composite
(readiness 1.0 with a zero signal sub-score), yet it renders as `text-destructive`.

## Expected

Composite colour reflects the composite's own scale: it is a k=1 empirical-Bayes shrinkage toward
0.5 whose reachable range is roughly 0.25–0.83 (one maxed axis caps at 0.750, two at 0.833). The
operator chose **centred diverging bands**: muted around the neutral point, colour only on the
tails, with thresholds calibrated to that reachable range rather than to strategy grades.

## Reproduction

1. Have any opportunity with full readiness and a decayed/absent-weight signal (composite 0.500).
2. Open `/insights/opportunities` or `/trader/positions/<symbol>`.
3. Composite renders red (`text-destructive`); no reachable composite value ever renders green
   except the ≥0.8 two-axis tail.

## Evidence

`services/xstockstrat-ui/src/lib/scoreDisplay.ts:13-17`
> if (score >= 0.8) return 'text-buy'; if (score >= 0.6) return 'text-paper'; return 'text-destructive';

`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:982`
> scoreColor(opportunity.compositeScore),

`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:560`
> scoreColor(o.compositeScore),

`services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx:192`
> className={cn('font-mono text-[11px] tabular-nums', scoreColor(s.compositeScore))}

`services/xstockstrat-analysis/app/handlers/servicer.py:5596`
> return (sum(w * s for w, s in scored) + 0.5 * k) / (total_w + k)

## Root cause hypothesis

Feature 199 deliberately reused the strategy-grade `scoreColor` for the composite
(`docs/roadmap/features/199-opportunity-composite-score/context.md:28`, asserted by its `@AC-8`).
Those thresholds assume a [0,1] grade scale, not a 0.5-centred shrunk ordinal. The fix changes a
launched acceptance scenario (`@AC-8`) and must be carried as a C-16 CHANGE.

## Confidence

high
