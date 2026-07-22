/**
 * Canonical Portfolio fixtures, keyed to the broker-account fixtures.
 *
 * Shape source: `xstockstrat.portfolio.v1.Portfolio`
 * (packages/proto/portfolio/v1/portfolio.proto). Money fields are proto
 * `double`, so the canonical JSON form is a number (not a string) — use these
 * objects verbatim in page.route() bodies and mock-backend handler returns.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
import { BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_IBKR } from './accounts';

export const PORTFOLIO_ALPACA = {
  portfolioId: 'port-001',
  accountId: BROKER_ACCOUNT_ALPACA.id,
  equity: 50000.0,
  cash: 20000.0,
  buyingPower: 40000.0,
  dayPnl: 150.0,
  dayPnlPct: 0.003,
  totalPnl: 1500.0,
  positions: [{ symbol: 'AAPL', unrealizedPnl: 100.0 }],
};

export const PORTFOLIO_IBKR = {
  portfolioId: 'port-002',
  accountId: BROKER_ACCOUNT_IBKR.id,
  equity: 30000.0,
  cash: 10000.0,
  dayPnl: -50.0,
  dayPnlPct: -0.0017,
  totalPnl: 800.0,
  positions: [],
};

/** One portfolio per broker account in BROKER_ACCOUNTS. */
export const PORTFOLIOS = [PORTFOLIO_ALPACA, PORTFOLIO_IBKR];
