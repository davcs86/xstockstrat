import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';

// Insights-scoped MarketDataService client (/insights/api), not the trader `marketDataClient`
// (/trader/api) — so deleteBackfilledData reaches the insights BFF handler that admin-gates it.
const transport = makeBrowserTransport('/insights/api');
export const insightsMarketDataClient = createClient(MarketDataService, transport);
