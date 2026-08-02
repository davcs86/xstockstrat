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
import { BROKER_ACCOUNT_ALPACA } from './accounts';

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

/** The open positions the mock ListPositions returns (Exposure list). */
export const POSITIONS = [POSITION_AAPL, POSITION_MSFT];

/** Lookup used by the mock GetPosition handler; defaults to AAPL. */
export function positionForSymbol(symbol: string | undefined) {
  return POSITIONS.find((p) => p.symbol === (symbol ?? '').toUpperCase()) ?? POSITION_AAPL;
}
