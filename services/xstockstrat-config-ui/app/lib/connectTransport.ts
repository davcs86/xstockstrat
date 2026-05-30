/**
 * Browser-side Connect transport for the config-ui BFF endpoint.
 *
 * Usage in browser (Client) components:
 *   import { createClient } from '@connectrpc/connect';
 *   import { browserTransport } from '@/app/lib/connectTransport';
 *   import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
 *   const config = createClient(ConfigService, browserTransport);
 *   const result = await config.listKeys({ ... });
 *
 * Next.js serves the App Router catch-all (app/api/[...connect]/route.ts)
 * under basePath + /api, so the effective URL is /config-ui/api/<service>/<method>.
 */
import { createConnectTransport } from '@connectrpc/connect-web';

export const browserTransport = createConnectTransport({
  baseUrl: '/config-ui/api',
});
