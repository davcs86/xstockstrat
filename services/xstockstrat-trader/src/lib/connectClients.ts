/**
 * Connect-RPC clients for xstockstrat-trader.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses manual service descriptors (not generated stubs) to avoid proto-loader
 * dependency. All calls are made via Connect-RPC HTTP (ports 8051, 8052, etc.)
 * using JSON encoding.
 */
import { MethodKind } from '@bufbuild/protobuf';
import { createClient } from '@connectrpc/connect';
import { createNodeHttpTransport } from '@connectrpc/connect-node';

function makeTransport(baseUrl: string) {
  return createNodeHttpTransport({ baseUrl, httpVersion: '1.1' });
}

// ── Base URLs ──────────────────────────────────────────────────────────────
const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';
const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';
const NOTIFY_BASE_URL =
  process.env.NOTIFY_HTTP_ENDPOINT ?? 'http://xstockstrat-notify:8059';

// ── Service descriptors ────────────────────────────────────────────────────

const TradingServiceDef = {
  typeName: 'xstockstrat.trading.v1.TradingService',
  methods: {
    placeOrder: { name: 'PlaceOrder', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    cancelOrder: { name: 'CancelOrder', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getOrder: { name: 'GetOrder', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listOrders: { name: 'ListOrders', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    streamOrderUpdates: {
      name: 'StreamOrderUpdates',
      I: {} as any,
      O: {} as any,
      kind: MethodKind.ServerStreaming,
    },
  },
} as const;

const PortfolioServiceDef = {
  typeName: 'xstockstrat.portfolio.v1.PortfolioService',
  methods: {
    getPortfolio: { name: 'GetPortfolio', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getPosition: { name: 'GetPosition', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listPositions: { name: 'ListPositions', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getPnl: { name: 'GetPnl', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

const NotifyServiceDef = {
  typeName: 'xstockstrat.notify.v1.NotifyService',
  methods: {
    emitAlert: { name: 'EmitAlert', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listAlerts: { name: 'ListAlerts', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    acknowledgeAlert: {
      name: 'AcknowledgeAlert',
      I: {} as any,
      O: {} as any,
      kind: MethodKind.Unary,
    },
  },
} as const;

// ── Exported clients ───────────────────────────────────────────────────────
export const tradingClient = createClient(
  TradingServiceDef as any,
  makeTransport(TRADING_BASE_URL),
);

export const portfolioClient = createClient(
  PortfolioServiceDef as any,
  makeTransport(PORTFOLIO_BASE_URL),
);

export const notifyClient = createClient(
  NotifyServiceDef as any,
  makeTransport(NOTIFY_BASE_URL),
);
