import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';

// Trader-segment ConfigService client (feature 102) — reads platform.trading_state for the
// amended AC-5 "one coherent restriction display" on /trader/positions. config-ui's own
// configClient.ts is bound to /config-ui/api; this is the trader segment's own client bound to
// /trader/api, mirroring the insightsPortfolioClient/insightsMarketDataClient naming precedent
// for a service consumed from more than one segment.
const transport = makeBrowserTransport('/trader/api');
export const traderConfigClient = createClient(ConfigService, transport);
