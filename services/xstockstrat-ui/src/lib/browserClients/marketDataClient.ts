import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';

const transport = createConnectTransport({ baseUrl: '/trader/api' });
export const marketDataClient = createClient(MarketDataService, transport);
