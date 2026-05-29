/**
 * Connect-RPC clients for xstockstrat-insights.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Service descriptors use untyped I/O (`{} as any`) so we get a working
 * client without depending on generated proto stubs. JSON encoding is
 * used over Connect-RPC HTTP.
 */
import { MethodKind } from '@bufbuild/protobuf';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';

function makeTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, httpVersion: '1.1' });
}

// ── Base URLs ──────────────────────────────────────────────────────────────
const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';
const MARKETDATA_BASE_URL =
  process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';
const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';
const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';
const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';

// ── Service descriptors ────────────────────────────────────────────────────

const AnalysisServiceDef = {
  typeName: 'xstockstrat.analysis.v1.AnalysisService',
  methods: {
    runBacktest: { name: 'RunBacktest', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    scoreStrategy: { name: 'ScoreStrategy', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listStrategies: { name: 'ListStrategies', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    getStrategyReport: { name: 'GetStrategyReport', I: {} as any, O: {} as any, kind: MethodKind.Unary },
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

const TradingServiceDef = {
  typeName: 'xstockstrat.trading.v1.TradingService',
  methods: {
    listBrokerAccounts: { name: 'ListBrokerAccounts', I: {} as any, O: {} as any, kind: MethodKind.Unary },
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

// ── Exported clients ───────────────────────────────────────────────────────
// We cast AnalysisServiceDef etc. to `any` for createClient(), which loses
// the per-method `kind` narrowing TypeScript needs to pick the unary
// overload. Cast each exported client to an UntypedClient so call sites
// can pass `(input)` or `(input, options)` without TS routing them to the
// streaming overload (which expects an AsyncIterable input).
type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

export const analysisClient = createClient(
  AnalysisServiceDef as any,
  makeTransport(ANALYSIS_BASE_URL),
) as unknown as UntypedClient;

export const marketDataClient = createClient(
  MarketDataServiceDef as any,
  makeTransport(MARKETDATA_BASE_URL),
) as unknown as UntypedClient;

export const portfolioClient = createClient(
  PortfolioServiceDef as any,
  makeTransport(PORTFOLIO_BASE_URL),
) as unknown as UntypedClient;

export const tradingClient = createClient(
  TradingServiceDef as any,
  makeTransport(TRADING_BASE_URL),
) as unknown as UntypedClient;

export const identityClient = createClient(
  IdentityServiceDef as any,
  makeTransport(IDENTITY_BASE_URL),
) as unknown as UntypedClient;

// ── Connect-Code → HTTP status helper ──────────────────────────────────────
// Shared by every route that catches ConnectError so upstream failures
// surface with a meaningful HTTP status instead of a blanket 500.
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
