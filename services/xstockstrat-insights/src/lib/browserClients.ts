/**
 * Browser-side Connect clients for insights Client Components.
 *
 * These talk the Connect protocol to the Next.js BFF catch-all
 * (src/app/api/[...connect]/route.ts → connectBff.ts) at basePath + /api,
 * which authenticates the session cookie and forwards to the backend gRPC
 * services with x-user-id / x-access-scope / x-trace-id propagation.
 *
 * Components consume the typed protobuf-es messages directly (camelCase
 * fields, numeric enums) — no JSON field mapping. Same-origin requests send
 * the session cookie automatically.
 */
import { createClient } from '@connectrpc/connect';
import { browserTransport } from './connectTransport';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

export const analysisClient = createClient(AnalysisService, browserTransport);
export const marketDataClient = createClient(MarketDataService, browserTransport);
export const portfolioClient = createClient(PortfolioService, browserTransport);
export const tradingClient = createClient(TradingService, browserTransport);
