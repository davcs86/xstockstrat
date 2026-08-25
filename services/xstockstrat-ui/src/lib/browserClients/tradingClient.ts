import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

const transport = makeBrowserTransport('/trader/api');
export const tradingClient = createClient(TradingService, transport);
