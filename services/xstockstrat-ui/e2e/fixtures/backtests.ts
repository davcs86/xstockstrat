/**
 * Canonical backtest coverage-gap fixtures.
 *
 * Shape source: `xstockstrat.analysis.v1.CoverageGap` + `BacktestResult`
 * (packages/proto/analysis/v1/analysis.proto).
 *
 * Feature 071 changed what a gap *means* for a windowed run. A backtest given an explicit
 * `range.start` loads bars from before that start to warm its indicators, so when history is
 * too short the reported gap covers the **pre-window** span — earlier than, and disjoint from,
 * the window the user asked for. `insufficientDataResult` models that: `requestedRange` is the
 * caller's window and `gap` is the pre-window span, and the two are deliberately different so a
 * consumer that backfills the wrong one is caught.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

/** Trading-day-ish seconds; only the ordering and disjointness matter to the UI. */
const DAY = 86400;

export const BACKTEST_GAP_SYMBOL = 'AAPL';
// BigInt(...) rather than a literal: the e2e tsconfig targets below ES2020.
export const BACKTEST_GAP_BARS_HAVE = BigInt(3);
export const BACKTEST_GAP_BARS_NEED = BigInt(52);

/** How far before the requested start the warm-up prefix reaches, in the mock. */
export const BACKTEST_PREFIX_DAYS = 75;

type Ts = { seconds: bigint; nanos: number };
type Range = { start?: Ts; end?: Ts } | undefined;

/**
 * The pre-window span a windowed run reports when history is too short: it ends at the
 * requested start and begins `BACKTEST_PREFIX_DAYS` earlier.
 *
 * With no requested range (the rolling-default path) there is no prefix to report, so the
 * requested range is echoed back unchanged — matching the pre-071 behavior the server keeps
 * for callers that send no `start`.
 */
export function prefixGapRange(requested: Range): Range {
  const start = requested?.start;
  if (!start) return requested;
  return {
    start: { seconds: start.seconds - BigInt(BACKTEST_PREFIX_DAYS * DAY), nanos: 0 },
    end: { seconds: start.seconds, nanos: 0 },
  };
}

/** A BACKTEST_STATUS_INSUFFICIENT_DATA result whose gap is the pre-window span. */
export function insufficientDataResult(strategyId: string, symbols: string[], range: Range) {
  const symbol = symbols[0] ?? BACKTEST_GAP_SYMBOL;
  return {
    backtestId: 'bt-e2e-1',
    strategyId,
    status: 2, // BACKTEST_STATUS_INSUFFICIENT_DATA
    totalTrades: 0,
    trades: [],
    coverageGaps: [
      {
        symbol,
        timeframe: 4, // TIMEFRAME_1DAY
        requestedRange: range,
        barsHave: BACKTEST_GAP_BARS_HAVE,
        barsNeed: BACKTEST_GAP_BARS_NEED,
        gap: prefixGapRange(range),
      },
    ],
  };
}
