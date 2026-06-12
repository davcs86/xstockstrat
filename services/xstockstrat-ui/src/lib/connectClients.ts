import { Code, createClient } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

// ── gRPC endpoints (host:port, no protocol) ───────────────────────────────
const TRADING_ENDPOINT = process.env.TRADING_ENDPOINT ?? 'xstockstrat-trading:50051';
const PORTFOLIO_ENDPOINT = process.env.PORTFOLIO_ENDPOINT ?? 'xstockstrat-portfolio:50052';
const MARKETDATA_ENDPOINT = process.env.MARKETDATA_ENDPOINT ?? 'xstockstrat-marketdata:50053';
const NOTIFY_ENDPOINT = process.env.NOTIFY_ENDPOINT ?? 'xstockstrat-notify:50059';
const IDENTITY_ENDPOINT = process.env.IDENTITY_ENDPOINT ?? 'xstockstrat-identity:50058';
const ANALYSIS_ENDPOINT = process.env.ANALYSIS_ENDPOINT ?? 'xstockstrat-analysis:50056';
const CONFIG_ENDPOINT = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
const INGEST_ENDPOINT = process.env.INGEST_ENDPOINT ?? 'xstockstrat-ingest:50055';
const INDICATORS_ENDPOINT = process.env.INDICATORS_ENDPOINT ?? 'xstockstrat-indicators:50054';
const LEDGER_ENDPOINT = process.env.LEDGER_ENDPOINT ?? 'xstockstrat-ledger:50057';

function makeTransport(endpoint: string) {
  return createGrpcTransport({ baseUrl: `http://${endpoint}` });
}

// ── Exported clients ───────────────────────────────────────────────────────
export const tradingClient = createClient(TradingService, makeTransport(TRADING_ENDPOINT));
export const portfolioClient = createClient(PortfolioService, makeTransport(PORTFOLIO_ENDPOINT));
export const marketDataClient = createClient(MarketDataService, makeTransport(MARKETDATA_ENDPOINT));
export const notifyClient = createClient(NotifyService, makeTransport(NOTIFY_ENDPOINT));
export const identityClient = createClient(IdentityService, makeTransport(IDENTITY_ENDPOINT));
export const analysisClient = createClient(AnalysisService, makeTransport(ANALYSIS_ENDPOINT));
export const configClient = createClient(ConfigService, makeTransport(CONFIG_ENDPOINT));
export const ingestClient = createClient(IngestService, makeTransport(INGEST_ENDPOINT));
export const indicatorsClient = createClient(IndicatorsService, makeTransport(INDICATORS_ENDPOINT));
export const ledgerClient = createClient(LedgerService, makeTransport(LEDGER_ENDPOINT));

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
