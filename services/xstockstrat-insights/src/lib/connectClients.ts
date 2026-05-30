/**
 * Connect-RPC clients for xstockstrat-insights.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses raw fetch with Connect-RPC JSON protocol instead of createClient() to
 * avoid the normalize() instanceof check that throws TypeError when method.I
 * is not a proper constructor (generated connect-es v1 + protobuf-es v2 mismatch).
 */
import { ConnectError, Code } from '@connectrpc/connect';

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

type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

// Maps Connect-RPC JSON error code strings to Code enum values.
function codeFromString(codeStr: string): Code {
  switch (codeStr) {
    case 'canceled': return Code.Canceled;
    case 'unknown': return Code.Unknown;
    case 'invalid_argument': return Code.InvalidArgument;
    case 'deadline_exceeded': return Code.DeadlineExceeded;
    case 'not_found': return Code.NotFound;
    case 'already_exists': return Code.AlreadyExists;
    case 'permission_denied': return Code.PermissionDenied;
    case 'resource_exhausted': return Code.ResourceExhausted;
    case 'failed_precondition': return Code.FailedPrecondition;
    case 'aborted': return Code.Aborted;
    case 'out_of_range': return Code.OutOfRange;
    case 'unimplemented': return Code.Unimplemented;
    case 'internal': return Code.Internal;
    case 'unavailable': return Code.Unavailable;
    case 'data_loss': return Code.DataLoss;
    case 'unauthenticated': return Code.Unauthenticated;
    default: return Code.Unknown;
  }
}

async function connectPost(url: string, input: unknown, headers?: Headers): Promise<unknown> {
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headers) {
    headers.forEach((value, key) => { reqHeaders[key] = value; });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(input ?? {}),
  });
  if (res.ok) return res.json();
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* ignore parse error */ }
  const msg = typeof body.message === 'string' ? body.message : 'RPC error';
  const code = typeof body.code === 'string' ? codeFromString(body.code) : Code.Unknown;
  throw new ConnectError(msg, code);
}

function makeClient(
  baseUrl: string,
  typeName: string,
  methods: Record<string, string>,
): UntypedClient {
  const client: UntypedClient = {};
  for (const [methodName, rpcName] of Object.entries(methods)) {
    client[methodName] = (input?: unknown, options?: { headers?: Headers }) =>
      connectPost(`${baseUrl}/${typeName}/${rpcName}`, input, options?.headers);
  }
  return client;
}

// ── Exported clients ───────────────────────────────────────────────────────

export const analysisClient = makeClient(
  ANALYSIS_BASE_URL,
  'xstockstrat.analysis.v1.AnalysisService',
  {
    runBacktest: 'RunBacktest',
    scoreStrategy: 'ScoreStrategy',
    listStrategies: 'ListStrategies',
    getStrategyReport: 'GetStrategyReport',
  },
);

export const marketDataClient = makeClient(
  MARKETDATA_BASE_URL,
  'xstockstrat.marketdata.v1.MarketDataService',
  {
    getBars: 'GetBars',
    getLatestQuote: 'GetLatestQuote',
    listAssets: 'ListAssets',
    backfillBars: 'BackfillBars',
  },
);

export const portfolioClient = makeClient(
  PORTFOLIO_BASE_URL,
  'xstockstrat.portfolio.v1.PortfolioService',
  {
    getPortfolio: 'GetPortfolio',
    getPosition: 'GetPosition',
    listPositions: 'ListPositions',
    getPnl: 'GetPnl',
    listPortfolios: 'ListPortfolios',
  },
);

export const tradingClient = makeClient(
  TRADING_BASE_URL,
  'xstockstrat.trading.v1.TradingService',
  {
    listBrokerAccounts: 'ListBrokerAccounts',
  },
);

export const identityClient = makeClient(
  IDENTITY_BASE_URL,
  'xstockstrat.identity.v1.IdentityService',
  {
    authenticateUser: 'AuthenticateUser',
    validateToken: 'ValidateToken',
    refreshToken: 'RefreshToken',
    revokeToken: 'RevokeToken',
  },
);

// ── Connect-Code → HTTP status helper ──────────────────────────────────────
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
