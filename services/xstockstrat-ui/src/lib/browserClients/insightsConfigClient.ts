import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';

// Insights-segment ConfigService client (feature 031 performance dashboard). Bound to
// /insights/api so getConfig({ namespace: 'ui' }) reaches the insights BFF (read-only, no admin
// gate). Mirrors the traderConfigClient naming precedent for a per-segment ConfigService client.
const transport = makeBrowserTransport('/insights/api');
export const insightsConfigClient = createClient(ConfigService, transport);
