/**
 * Connect-RPC clients for xstockstrat-trader.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses @connectrpc/connect v2 with service descriptors from the generated
 * *_pb.ts files (protobuf-es v2 schema-based). In connect v2, createClient
 * does not use instanceof for message normalization, so the runtime TypeError
 * from connect v1 + protoc-gen-es v2 type erasure no longer applies.
 */
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

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

function makeTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, httpVersion: '1.1' });
}

// Cast to a generic record so route handlers can call any method with plain
// object inputs without TypeScript routing them through the protobuf-es v2
// message shape types. At runtime, connect v2's JSON serializer reads field
// values from the plain object by name, so this is safe.
type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

// ── Exported clients ───────────────────────────────────────────────────────

export const tradingClient = createClient(
  TradingService,
  makeTransport(TRADING_BASE_URL),
) as unknown as UntypedClient;

export const portfolioClient = createClient(
  PortfolioService,
  makeTransport(PORTFOLIO_BASE_URL),
) as unknown as UntypedClient;

export const notifyClient = createClient(
  NotifyService,
  makeTransport(NOTIFY_BASE_URL),
) as unknown as UntypedClient;

export const identityClient = createClient(
  IdentityService,
  makeTransport(IDENTITY_BASE_URL),
) as unknown as UntypedClient;

export const marketDataClient = createClient(
  MarketDataService,
  makeTransport(MARKETDATA_BASE_URL),
) as unknown as UntypedClient;

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

