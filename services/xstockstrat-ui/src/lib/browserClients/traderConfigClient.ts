import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';

// Trader-segment ConfigService client, bound to /trader/api (config-ui's configClient is bound to
// /config-ui/api) — reads platform.trading_state for the /trader/positions restriction display.
const transport = makeBrowserTransport('/trader/api');
export const traderConfigClient = createClient(ConfigService, transport);
