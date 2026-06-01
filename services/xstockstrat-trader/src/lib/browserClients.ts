/**
 * Browser-side Connect clients for trader Client Components.
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
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';

export const tradingClient = createClient(TradingService, browserTransport);
export const portfolioClient = createClient(PortfolioService, browserTransport);
export const marketDataClient = createClient(MarketDataService, browserTransport);
export const notifyClient = createClient(NotifyService, browserTransport);
