import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

const transport = createConnectTransport({ baseUrl: '/trader/api' });
export const tradingClient = createClient(TradingService, transport);
