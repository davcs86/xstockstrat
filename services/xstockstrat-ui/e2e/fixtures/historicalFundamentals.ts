/**
 * Data Explorer (feature 204) Connect-JSON **wire** fixtures for `page.route` stubs.
 *
 * Timestamps are RFC3339 strings and int64 (`volume`) is a string — the shape Connect's JSON codec
 * puts on the wire, which the browser client parses back to `{seconds,nanos}` / bigint (see
 * `e2e/insights/backtest-coverage.spec.ts` for the wire-vs-message note). `missing_metrics` values
 * are the snake_case metric names the UI checks against (MARKETDATA-11) — the Q1-2024 period omits
 * `pe_ratio` so its table cell renders `—` and the chart gaps (AC-22).
 *
 * Shape source: `xstockstrat.marketdata.v1.{GetBarsResponse, GetFundamentalsResponse,
 * GetHistoricalFundamentalsResponse}`. Registered in e2e/fixtures/INVENTORY.md.
 */

export const DE_ASSETS_WIRE = {
  assets: [
    { symbol: 'AAPL', exchange: 'NASDAQ', assetClass: 'us_equity' },
    { symbol: 'MSFT', exchange: 'NASDAQ', assetClass: 'us_equity' },
  ],
};

export const DE_BARS_AAPL_PAGE1 = {
  bars: [
    {
      symbol: 'AAPL',
      time: '2024-01-02T00:00:00Z',
      open: 187.2,
      high: 188.9,
      low: 186.5,
      close: 188.1,
      volume: '42000000',
      timeframe: '1d',
      source: 'alpaca',
    },
    {
      symbol: 'AAPL',
      time: '2024-01-03T00:00:00Z',
      open: 188.1,
      high: 190.5,
      low: 187.8,
      close: 189.8,
      volume: '45000000',
      timeframe: '1d',
      source: 'alpaca',
    },
  ],
  page: { nextPageToken: 'de-bars-p2' },
};

export const DE_BARS_AAPL_PAGE2 = {
  bars: [
    {
      symbol: 'AAPL',
      time: '2024-01-04T00:00:00Z',
      open: 189.8,
      high: 192.0,
      low: 189.0,
      close: 191.2,
      volume: '38000000',
      timeframe: '1d',
      source: 'alpaca',
    },
  ],
  page: { nextPageToken: '' },
};

export const DE_BARS_EMPTY = { bars: [], page: { nextPageToken: '' } };

export const DE_SNAPSHOT_AAPL = {
  fundamentals: {
    symbol: 'AAPL',
    marketCap: 3.02e12,
    peRatio: 31.4,
    pbRatio: 47.2,
    dividendYield: 0.0044,
    eps: 6.05,
    beta: 1.28,
    roe: 1.47,
    debtToEquity: 1.95,
    price: 189.8,
    yearHigh: 199.62,
    yearLow: 164.08,
    asOf: '2024-05-01T00:00:00Z',
    currency: 'USD',
    source: 'fmp',
    stale: false,
    missingMetrics: [],
  },
};

export const DE_HIST_AAPL_PAGE1 = {
  periods: [
    {
      symbol: 'AAPL',
      fiscalPeriod: 'Q1-2024',
      periodType: 'quarterly',
      periodEnd: '2024-03-31T00:00:00Z',
      filedDate: '2024-05-01T00:00:00Z',
      marketCap: 2.9e12,
      pbRatio: 45.0,
      dividendYield: 0.0045,
      eps: 1.52,
      beta: 1.27,
      roe: 1.4,
      debtToEquity: 1.9,
      price: 171.5,
      yearHigh: 199.0,
      yearLow: 160.0,
      currency: 'USD',
      source: 'edgar',
      missingMetrics: ['pe_ratio'], // AC-22 — renders `—` in the table, a gap in the chart
    },
    {
      symbol: 'AAPL',
      fiscalPeriod: 'Q2-2024',
      periodType: 'quarterly',
      periodEnd: '2024-06-30T00:00:00Z',
      filedDate: '2024-08-01T00:00:00Z',
      marketCap: 3.0e12,
      peRatio: 30.2,
      pbRatio: 46.0,
      dividendYield: 0.0044,
      eps: 1.4,
      beta: 1.28,
      roe: 1.42,
      debtToEquity: 1.92,
      price: 186.0,
      yearHigh: 199.6,
      yearLow: 164.0,
      currency: 'USD',
      source: 'edgar',
      missingMetrics: [],
    },
  ],
  pagination: { nextPageToken: 'de-hist-p2' },
};

export const DE_HIST_AAPL_PAGE2 = {
  periods: [
    {
      symbol: 'AAPL',
      fiscalPeriod: 'FY2023',
      periodType: 'annual',
      periodEnd: '2023-09-30T00:00:00Z',
      filedDate: '2023-11-02T00:00:00Z',
      marketCap: 2.8e12,
      peRatio: 28.0,
      pbRatio: 44.0,
      dividendYield: 0.005,
      eps: 6.13,
      beta: 1.29,
      roe: 1.5,
      debtToEquity: 1.95,
      price: 171.2,
      yearHigh: 198.2,
      yearLow: 124.1,
      currency: 'USD',
      source: 'edgar',
      missingMetrics: [],
    },
  ],
  pagination: { nextPageToken: '' },
};
