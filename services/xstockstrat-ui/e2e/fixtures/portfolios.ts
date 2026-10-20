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
import { BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_IBKR, BROKER_ACCOUNT_OFFLINE } from './accounts';

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

/**
 * Offline account portfolio (feature 157): equity derived from positions (no broker balance),
 * with account-grain realized P&L. `realizedPnl` is the proto3 `optional double` — present here
 * (offline), absent on broker portfolios, so the card's Realized P&L Stat renders only for offline.
 */
export const PORTFOLIO_OFFLINE = {
  portfolioId: 'port-offline-001',
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  equity: 0.0,
  cash: 0.0,
  dayPnl: 0.0,
  dayPnlPct: 0.0,
  totalPnl: 0.0,
  realizedPnl: 97.5,
  positions: [],
};

/**
 * Offline account with the full feature-230 P&L (AC-14/AC-20/AC-30): Day / Total P&L with return %,
 * since-snapshot and lifetime realized (gross; net = gross − fees) and both fee scopes. The
 * realized/fee fields are proto3 `optional double` — set on offline portfolios only. Not in
 * PORTFOLIOS (shared defaults stay unchanged); specs inject it via page.route().
 */
export const PORTFOLIO_OFFLINE_FULL_PNL = {
  portfolioId: 'port-offline-002',
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  equity: 16300.0,
  cash: 0.0,
  dayPnl: 300.0,
  dayPnlPct: 0.0188,
  totalPnl: 1300.0,
  totalPnlPct: 0.1238,
  realizedPnl: 600.0,
  feesSinceSnapshot: 3.0,
  realizedPnlLifetime: 900.0,
  feesLifetime: 4.5,
  positions: [{ symbol: 'AAPL', unrealizedPnl: 1300.0 }],
};

/** Broker leg of the AC-30 combined view: Day P&L 120, Total P&L 500, no realized/fee fields. */
export const PORTFOLIO_ALPACA_AC30 = {
  ...PORTFOLIO_ALPACA,
  dayPnl: 120.0,
  totalPnl: 500.0,
};

/** One portfolio per broker account in BROKER_ACCOUNTS. */
export const PORTFOLIOS = [PORTFOLIO_ALPACA, PORTFOLIO_IBKR];
