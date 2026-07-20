import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';

// Routes through the insights BFF (/insights/api), not the trader BFF.
// The trader-segment `marketDataClient` points at /trader/api; the Backfills page (mounted
// under /insights) needs an insights-scoped client so deleteBackfilledData reaches the same
// handler that gates it to admin scope.
const transport = createConnectTransport({ baseUrl: '/insights/api' });
export const insightsMarketDataClient = createClient(MarketDataService, transport);
