import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';

// Insights-segment ConfigService client, bound to /insights/api so getConfig({ namespace: 'ui' })
// reaches the insights BFF (read-only, no admin gate).
const transport = makeBrowserTransport('/insights/api');
export const insightsConfigClient = createClient(ConfigService, transport);
