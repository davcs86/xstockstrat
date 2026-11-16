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

// Feature 339 (@AC-1) — the reported LYFT market cap; `asOf` is the Connect-JSON RFC3339 form, so
// this is a page.route body only (not a mock-backend message init).
export const FUNDAMENTALS_LYFT = {
  symbol: 'LYFT',
  marketCap: 6726553623.93,
  peRatio: 41.2,
  pbRatio: 3.1,
  dividendYield: 0,
  eps: 0.4,
  beta: 1.95,
  roe: 0.12,
  debtToEquity: 0.85,
  price: 16.42,
  yearHigh: 19.8,
  yearLow: 9.66,
  extraMetrics: {},
  currency: 'USD',
  source: 'fmp',
  stale: false,
  asOf: '2026-11-13T21:00:00Z',
};

// Feature 220 — sentinel symbol whose GetFundamentals never answers (stalled upstream), so the
// trader BFF's bounded deadline must surface the card's error branch instead of loading forever.
export const FUNDAMENTALS_STALL_SYMBOL = 'STALL';
