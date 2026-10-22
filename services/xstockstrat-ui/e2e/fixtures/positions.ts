/**
 * Canonical Position fixtures for the Book → Exposure surface and the single-Position page
 * (feature 096). Centralized here because a second consumer appeared: the `listPositions` mock
 * (Exposure list) and the `getPosition` mock (Position page) now share these objects (C-13).
 *
 * Shape source: `xstockstrat.portfolio.v1.Position`
 * (packages/proto/portfolio/v1/portfolio.proto). Money fields are proto `double` → JSON numbers;
 * `flag` is the numeric `PositionRiskFlag` enum (3 = STOP_NEAR). AAPL's `unrealizedPnl` is 100.0
 * to match `PORTFOLIO_ALPACA` (C-10(b) valuation parity — one authoritative source).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
import { BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE } from './accounts';

export const POSITION_AAPL = {
  symbol: 'AAPL',
  qty: 10,
  avgEntryPrice: 180.0,
  currentPrice: 189.8,
  marketValue: 1898.0,
  // Valuation parity with PORTFOLIO_ALPACA's AAPL position (100.0).
  unrealizedPnl: 100.0,
  unrealizedPnlPct: 0.056,
  costBasis: 1800.0,
  accountId: BROKER_ACCOUNT_ALPACA.id,
  tradingMode: 1,
  // feature 083 risk/factor fields — a resting stop within the near threshold (flag STOP_NEAR).
  stopPrice: 178.0,
  riskAtStop: 118.0,
  stopDistancePct: 0.062,
  factor: 'Tech',
  flag: 3, // POSITION_RISK_FLAG_STOP_NEAR
  exitRule: 'Stop @ $178.00',
  // feature 030 — resting bracket leg order IDs, sourced from trading's order.bracket_updated
  // ledger event. POSITION_MSFT omits these to exercise the em-dash "no active bracket" fallback.
  stopOrderId: 'ord-stop-778',
  takeProfitOrderId: 'ord-tp-779',
};

/** Short position with no risk metadata → Position page renders the em-dash / no-stop fallbacks. */
export const POSITION_MSFT = {
  symbol: 'MSFT',
  qty: -5,
  avgEntryPrice: 420.0,
  currentPrice: 410.0,
  marketValue: -2050.0,
  unrealizedPnl: 50.0,
  unrealizedPnlPct: 0.024,
  costBasis: -2100.0,
  accountId: BROKER_ACCOUNT_ALPACA.id,
  tradingMode: 1,
};

/**
 * Offline positions carrying feature-240 mark provenance (AC-16/AC-31/AC-32). `markSource` is the
 * numeric `MarkSource` enum (1 QUOTE, 2 LAST_CLOSE, 4 NONE); `markAsOf` is the Connect-JSON
 * RFC3339 form, so these are page.route() bodies only (not mock-backend message inits).
 */
export const POSITION_OFFLINE_AAPL = {
  symbol: 'AAPL',
  qty: 100,
  avgEntryPrice: 150.0,
  currentPrice: 163.0,
  marketValue: 16300.0,
  unrealizedPnl: 1300.0,
  unrealizedPnlPct: 0.0867,
  costBasis: 15000.0,
  dayPnl: 300.0,
  dayPnlPct: 0.0188,
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  tradingMode: 1,
  source: 1, // POSITION_SOURCE_ORDERS
  markSource: 1, // MARK_SOURCE_QUOTE
  markAsOf: '2026-10-19T14:00:00Z',
};

/** Marked at the 2026-10-16 daily close (no live quote) → "Last close 2026-10-16" badge. */
export const POSITION_OFFLINE_XYZ = {
  symbol: 'XYZ',
  qty: 10,
  avgEntryPrice: 20.0,
  currentPrice: 22.0,
  marketValue: 220.0,
  unrealizedPnl: 20.0,
  unrealizedPnlPct: 0.1,
  costBasis: 200.0,
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  tradingMode: 1,
  source: 1,
  markSource: 2, // MARK_SOURCE_LAST_CLOSE
  markAsOf: '2026-10-16T04:00:00Z',
};

/** No quote and no daily bar → unpriced: listed with its qty, "No price", no value or P&L. */
export const POSITION_OFFLINE_ZZZZ = {
  symbol: 'ZZZZ',
  qty: 5,
  avgEntryPrice: 30.0,
  costBasis: 150.0,
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  tradingMode: 1,
  source: 1,
  markSource: 4, // MARK_SOURCE_NONE
};

/** AC-31 Saturday read: a short marked at Friday's close, Day P&L 50, unrealized +200 (+10%). */
export const POSITION_OFFLINE_TSLA_SHORT = {
  symbol: 'TSLA',
  qty: -10,
  avgEntryPrice: 200.0,
  currentPrice: 180.0,
  marketValue: -1800.0,
  unrealizedPnl: 200.0,
  unrealizedPnlPct: 0.1,
  costBasis: -2000.0,
  dayPnl: 50.0,
  dayPnlPct: 0.027,
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  tradingMode: 1,
  source: 1,
  markSource: 2, // MARK_SOURCE_LAST_CLOSE
  markAsOf: '2026-10-16T04:00:00Z',
};

/** The open positions the mock ListPositions returns (Exposure list). */
export const POSITIONS = [POSITION_AAPL, POSITION_MSFT];

/** Lookup used by the mock GetPosition handler; defaults to AAPL. */
export function positionForSymbol(symbol: string | undefined) {
  return POSITIONS.find((p) => p.symbol === (symbol ?? '').toUpperCase()) ?? POSITION_AAPL;
}
