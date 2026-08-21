/**
 * P&L pattern attribution fixture (feature 042) — a QueryPnLPatternsResponse for AAPL.
 *
 * Connect-JSON camelCase, shaped after `xstockstrat.analysis.v1.QueryPnLPatternsResponse`. Field
 * values are deliberately distinct (factor names, ranges, sample counts, impacts) so a spec asserts
 * which field the UI reads (fixture-distinguishability, insights.md 2026-07-27). Consumed by the
 * mock backend's `queryPnLPatterns` handler and `e2e/insights/pnl-patterns.spec.ts`.
 */
export const PNL_PATTERNS_AAPL = {
  positiveFactors: [
    {
      factorName: 'RSI',
      factorType: 1, // FACTOR_TYPE_INDICATOR
      valueRangeLow: 20,
      valueRangeHigh: 32,
      sampleCount: 7,
      avgPnlImpact: 142.5,
    },
    {
      factorName: 'unusual_whales',
      factorType: 2, // FACTOR_TYPE_SIGNAL
      valueRangeLow: 0,
      valueRangeHigh: 0,
      sampleCount: 6,
      avgPnlImpact: 61.25,
    },
  ],
  negativeFactors: [
    {
      factorName: 'RSI',
      factorType: 1, // FACTOR_TYPE_INDICATOR
      valueRangeLow: 68,
      valueRangeHigh: 79,
      sampleCount: 8,
      avgPnlImpact: -97.4,
    },
  ],
};
