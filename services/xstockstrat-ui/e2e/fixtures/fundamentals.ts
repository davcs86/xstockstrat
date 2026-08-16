/**
 * Canonical Fundamentals fixture for the unified symbol page's Fundamentals section (feature 125,
 * FR-7). Centralized here on day one because it has two consumers immediately: the `getFundamentals`
 * mock (`e2e/mock-backend.ts`) and the Fundamentals e2e (`e2e/trader/position-detail.spec.ts`) — C-12.
 *
 * Shape source: `xstockstrat.marketdata.v1.Fundamentals`
 * (packages/proto/marketdata/v1/marketdata.proto). All ratio fields are proto `double` → JSON
 * numbers; `stale` is the past-TTL flag (FR-4). The mock wraps this in a `GetFundamentalsResponse`
 * (`{ fundamentals: FUNDAMENTALS_AAPL }`).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
export const FUNDAMENTALS_AAPL = {
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
  extraMetrics: {},
  currency: 'USD',
  source: 'fmp',
  stale: false,
};
