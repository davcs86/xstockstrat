/**
 * Signal-performance attribution fixture (feature 029) — a GetAttributionResponse.
 *
 * Connect-JSON camelCase, shaped after `xstockstrat.analysis.v1.GetAttributionResponse`. The two
 * rows carry deliberately distinct trade/win/return/pnl values (and `form4` has the HIGHER win rate)
 * so a spec proves which field the UI reads and that a win-rate sort actually reorders the rows.
 * Consumed by the mock backend's `getAttribution` handler and `e2e/insights/attribution.spec.ts`.
 */
export const SOURCE_ATTRIBUTION = {
  attributions: [
    // Rendered first, but the LOWER win rate — a win-rate desc sort must move it below form4.
    {
      sourceId: 'news',
      sourceName: 'Newsletter',
      tradeCount: 12,
      winCount: 5,
      winRate: 0.4,
      avgReturn: 0.018,
      totalPnl: 320.5,
    },
    {
      sourceId: 'form4',
      sourceName: 'Form 4 Insider',
      tradeCount: 20,
      winCount: 13,
      winRate: 0.65,
      avgReturn: 0.042,
      totalPnl: 1180.25,
    },
  ],
};
