/**
 * Canonical ScreenResult scenario rows for the Screener e2e suite.
 *
 * Shape source: `xstockstrat.analysis.v1.ScreenResult`
 * (packages/proto/analysis/v1/analysis.proto). `status: 2` is
 * `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`; `status: 1` is `SCREEN_RESULT_STATUS_OK`. A `gap`
 * distinguishes the two pending causes the Screener UI tells apart (feature 118 design.md):
 * absent → fundamentals-pending; present → bars-insufficient.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

/** A pending row whose fundamentals data source is unavailable (no `gap`). */
export function fundamentalsPendingRow(symbol: string) {
  return { symbol, score: 0, passed: false, status: 2 };
}

/** A pending row with too few bars for a technical criterion (carries a `gap`). */
export function barsInsufficientRow(symbol: string) {
  return {
    symbol,
    score: 0,
    passed: false,
    status: 2,
    gap: { symbol, timeframe: 4, barsHave: '0', barsNeed: '2' },
  };
}

/** A resolved (OK) row with an explicit score/criterionScores. */
export function resolvedRow(
  symbol: string,
  score: number,
  criterionScores?: Record<string, number>,
) {
  return {
    symbol,
    score,
    passed: true,
    status: 1,
    criterionScores: criterionScores ?? { c1: score },
  };
}
