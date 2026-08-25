import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';

const transport = makeBrowserTransport('/trader/api');
export const marketDataClient = createClient(MarketDataService, transport);
