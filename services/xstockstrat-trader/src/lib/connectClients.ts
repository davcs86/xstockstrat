/**
 * Connect-RPC clients for xstockstrat-trader.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses manual service descriptors (not generated stubs) to avoid proto-loader
 * dependency. All calls are made via Connect-RPC HTTP (ports 8051, 8052, etc.)
 * using JSON encoding.
 */
import { MethodKind } from '@bufbuild/protobuf';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';

function makeTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, httpVersion: '1.1' });
}

// ── Base URLs ──────────────────────────────────────────────────────────────
const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';
const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';
const NOTIFY_BASE_URL =
  process.env.NOTIFY_HTTP_ENDPOINT ?? 'http://xstockstrat-notify:8059';
const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
const MARKETDATA_BASE_URL =
  process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';

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
    listBrokerAccounts: { name: 'ListBrokerAccounts', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    registerBrokerAccount: { name: 'RegisterBrokerAccount', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    deregisterBrokerAccount: { name: 'DeregisterBrokerAccount', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

const PortfolioServiceDef = {
  typeName: 'xstockstrat.portfolio.v1.PortfolioService',
  methods: {
    getPortfolio: { name: 'GetPortfolio', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getPosition: { name: 'GetPosition', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listPositions: { name: 'ListPositions', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getPnl: { name: 'GetPnl', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listPortfolios: { name: 'ListPortfolios', I: {} as any, O: {} as any, kind: MethodKind.Unary },
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

const IdentityServiceDef = {
  typeName: 'xstockstrat.identity.v1.IdentityService',
  methods: {
    authenticateUser: { name: 'AuthenticateUser', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    validateToken: { name: 'ValidateToken', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    refreshToken: { name: 'RefreshToken', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    revokeToken: { name: 'RevokeToken', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

const MarketDataServiceDef = {
  typeName: 'xstockstrat.marketdata.v1.MarketDataService',
  methods: {
    getBars: { name: 'GetBars', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getLatestQuote: { name: 'GetLatestQuote', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listAssets: { name: 'ListAssets', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    backfillBars: { name: 'BackfillBars', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

// ── Exported clients ───────────────────────────────────────────────────────
// We cast TradingServiceDef etc. to `any` for createClient(), which loses
// the per-method `kind` narrowing TypeScript needs to pick the unary
// overload. Cast each exported client to an UntypedClient so call sites
// can pass `(input)` or `(input, options)` without TS routing them to the
// streaming overload (which expects an AsyncIterable input).
type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

export const tradingClient = createClient(
  TradingServiceDef as any,
  makeTransport(TRADING_BASE_URL),
) as unknown as UntypedClient;

export const portfolioClient = createClient(
  PortfolioServiceDef as any,
  makeTransport(PORTFOLIO_BASE_URL),
) as unknown as UntypedClient;

export const notifyClient = createClient(
  NotifyServiceDef as any,
  makeTransport(NOTIFY_BASE_URL),
) as unknown as UntypedClient;

export const identityClient = createClient(
  IdentityServiceDef as any,
  makeTransport(IDENTITY_BASE_URL),
) as unknown as UntypedClient;

export const marketDataClient = createClient(
  MarketDataServiceDef as any,
  makeTransport(MARKETDATA_BASE_URL),
) as unknown as UntypedClient;

// ── Connect-Code → HTTP status helper ──────────────────────────────────────
// Shared by every route that catches ConnectError so upstream errors surface
// as a meaningful HTTP status to the browser instead of a blanket 500.
export function connectCodeToHttp(code: Code): number {
  switch (code) {
    case Code.InvalidArgument:
    case Code.FailedPrecondition:
    case Code.OutOfRange:
      return 400;
    case Code.Unauthenticated:
      return 401;
    case Code.PermissionDenied:
      return 403;
    case Code.NotFound:
      return 404;
    case Code.AlreadyExists:
    case Code.Aborted:
      return 409;
    case Code.ResourceExhausted:
      return 429;
    case Code.Unimplemented:
      return 501;
    case Code.Unavailable:
      return 503;
    case Code.DeadlineExceeded:
      return 504;
    default:
      return 500;
  }
}
