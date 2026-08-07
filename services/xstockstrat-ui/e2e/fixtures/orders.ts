/**
 * Canonical Order fixtures for the mock trading backend. Centralized (feature 096) because a
 * second consumer appeared: the `listOrders` mock (Orders list / per-symbol Orders & fills) and
 * the `getOrder` mock (single-Order ticket page) now share these objects (C-13).
 *
 * Shape source: `xstockstrat.trading.v1.Order` (packages/proto/trading/v1/trading.proto).
 * Enums are numeric: side 1=BUY / 2=SELL; orderType 2=LIMIT; status 1=NEW / 3=FILLED;
 * tradingMode 1=PAPER. Note: specs that need a bespoke order set (orders.spec.ts,
 * order-parity.spec.ts) still `page.route()` their own inline literals — these fixtures back the
 * shared mock-backend handlers, not those scenario overrides.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
import { BROKER_ACCOUNT_ALPACA } from './accounts';

/** A fully-filled AAPL buy — terminal, so the ticket page shows no Edit/Cancel. */
export const ORDER_FILLED = {
  orderId: 'mock-order-001',
  symbol: 'AAPL',
  side: 1, // BUY
  orderType: 2, // LIMIT
  status: 3, // FILLED
  qty: 10,
  filledQty: 10,
  limitPrice: 176.0,
  stopPrice: 0,
  filledAvgPrice: 175.5,
  timeInForce: 'day',
  strategyId: 'momentum-breakout-v4',
  accountId: BROKER_ACCOUNT_ALPACA.id,
  brokerOrderId: 'brk-aapl-0001',
  tradingMode: 1, // PAPER
};

/** A working TSLA sell (NEW, unfilled) — the ticket page shows Edit + Cancel. */
export const ORDER_WORKING = {
  orderId: 'mock-order-002',
  symbol: 'TSLA',
  side: 2, // SELL
  orderType: 2, // LIMIT
  status: 1, // NEW
  qty: 5,
  filledQty: 0,
  limitPrice: 250.0,
  stopPrice: 0,
  filledAvgPrice: 0,
  timeInForce: 'gtc',
  strategyId: 'trailing-exit-atr',
  accountId: BROKER_ACCOUNT_ALPACA.id,
  brokerOrderId: '',
  tradingMode: 1, // PAPER
};

/**
 * A working order whose platform-side command outcome is unknown (feature 101,
 * intentState 4=UNKNOWN per trading.proto's IntentState enum: UNSPECIFIED=0/PENDING=1/
 * COMPLETED=2/REJECTED=3/UNKNOWN=4) — the ticket page must render `IntentStateBadge`'s
 * "Uncertain — verify with broker" text distinctly from OrderStatus.
 */
export const ORDER_UNKNOWN_INTENT = {
  orderId: 'mock-order-003',
  symbol: 'MSFT',
  side: 1, // BUY
  orderType: 1, // MARKET
  status: 1, // NEW
  qty: 3,
  filledQty: 0,
  limitPrice: 0,
  stopPrice: 0,
  filledAvgPrice: 0,
  timeInForce: 'day',
  strategyId: 'momentum-breakout-v4',
  accountId: BROKER_ACCOUNT_ALPACA.id,
  brokerOrderId: 'brk-msft-0003',
  tradingMode: 1, // PAPER
  intentState: 4, // UNKNOWN
};

/** The orders the mock ListOrders returns (Orders list / per-symbol Orders & fills). */
export const ORDERS = [ORDER_FILLED, ORDER_WORKING, ORDER_UNKNOWN_INTENT];

/** Lookup used by the mock GetOrder handler; defaults to the filled order. */
export function orderForId(orderId: string | undefined) {
  return ORDERS.find((o) => o.orderId === orderId) ?? ORDER_FILLED;
}
