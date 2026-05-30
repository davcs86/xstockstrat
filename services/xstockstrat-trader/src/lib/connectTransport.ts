/**
 * Browser-side Connect transport for the trader BFF endpoint.
 *
 * Usage in browser (Client) components:
 *   import { createClient } from '@connectrpc/connect';
 *   import { browserTransport } from '@/lib/connectTransport';
 *   import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
 *   const trading = createClient(TradingService, browserTransport);
 *   const result = await trading.listOrders({ ... });
 *
 * Next.js serves the Pages Router catch-all (src/pages/api/[[...connect]].ts)
 * under basePath + /api, so the effective URL is /trader/api/<service>/<method>.
 */
import { createConnectTransport } from '@connectrpc/connect-web';

export const browserTransport = createConnectTransport({
  baseUrl: '/trader/api',
});
