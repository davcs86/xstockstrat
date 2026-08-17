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

/**
 * A single-symbol (feature 125) resolved row carrying the per-criterion `criterionRawValues`/
 * `criterionPassed` maps the Symbol-page Screening section reads — never `score`/`criterionScores`,
 * which collapse to a content-free 0.5 on a one-symbol scan. Keyed by ref_name (`c1` by default).
 */
export function criterionDetailRow(symbol: string, raw: number, passed: boolean, refName = 'c1') {
  return {
    symbol,
    // score/criterionScores are intentionally left at their proto defaults (0 / {}) — the
    // single-symbol section must not read them.
    score: 0,
    passed,
    status: 1,
    criterionRawValues: { [refName]: raw },
    criterionPassed: { [refName]: passed },
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

/**
 * Bug fix (feature 144): an OK-status row where every configured criterion had no usable data
 * for this candidate (e.g. an ETF with no P/E ratio) — `scoreUnavailable: true` flags its `score`
 * as the engine's neutral placeholder, not a real result. Distinct from `fundamentalsPendingRow`
 * (status 2, retry-eligible): this row is `status: 1` and is not polled for a later re-check.
 */
export function noCriteriaDataRow(symbol: string) {
  return { symbol, score: 0.5, passed: false, status: 1, scoreUnavailable: true };
}
