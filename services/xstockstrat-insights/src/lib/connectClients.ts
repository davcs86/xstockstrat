/**
 * Connect-RPC clients for xstockstrat-insights.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses @connectrpc/connect v2 with service descriptors from the generated
 * *_pb.ts files (protobuf-es v2 schema-based). In connect v2, createClient
 * does not use instanceof for message normalization, so the runtime TypeError
 * from connect v1 + protoc-gen-es v2 type erasure no longer applies.
 */
import { Code, createClient } from '@connectrpc/connect';
import { createGrpcTransport, createConnectTransport } from '@connectrpc/connect-node';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

// ── gRPC endpoints (host:port, no protocol) ───────────────────────────────
const ANALYSIS_ENDPOINT =
  process.env.ANALYSIS_ENDPOINT ?? 'xstockstrat-analysis:50056';
const MARKETDATA_ENDPOINT =
  process.env.MARKETDATA_ENDPOINT ?? 'xstockstrat-marketdata:50053';
const PORTFOLIO_ENDPOINT =
  process.env.PORTFOLIO_ENDPOINT ?? 'xstockstrat-portfolio:50052';
const TRADING_ENDPOINT =
  process.env.TRADING_ENDPOINT ?? 'xstockstrat-trading:50051';
const IDENTITY_ENDPOINT =
  process.env.IDENTITY_ENDPOINT ?? 'xstockstrat-identity:50058';

function makeTransport(grpcEndpoint: string, httpOverride?: string) {
  if (httpOverride) {
    return createConnectTransport({ baseUrl: httpOverride, httpVersion: '1.1', useBinaryFormat: false });
  }
  return createGrpcTransport({ baseUrl: `http://${grpcEndpoint}` });
}

// ── Exported clients ───────────────────────────────────────────────────────

export const analysisClient = createClient(AnalysisService, makeTransport(ANALYSIS_ENDPOINT, process.env.ANALYSIS_HTTP_ENDPOINT));
export const marketDataClient = createClient(MarketDataService, makeTransport(MARKETDATA_ENDPOINT, process.env.MARKETDATA_HTTP_ENDPOINT));
export const portfolioClient = createClient(PortfolioService, makeTransport(PORTFOLIO_ENDPOINT, process.env.PORTFOLIO_HTTP_ENDPOINT));
export const tradingClient = createClient(TradingService, makeTransport(TRADING_ENDPOINT, process.env.TRADING_HTTP_ENDPOINT));
export const identityClient = createClient(IdentityService, makeTransport(IDENTITY_ENDPOINT, process.env.IDENTITY_HTTP_ENDPOINT));

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
