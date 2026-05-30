/**
 * Browser-side Connect transport for the insights BFF endpoint.
 *
 * Usage in browser (Client) components:
 *   import { createClient } from '@connectrpc/connect';
 *   import { browserTransport } from '@/lib/connectTransport';
 *   import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
 *   const analysis = createClient(AnalysisService, browserTransport);
 *   const result = await analysis.listStrategies({ ... });
 *
 * Next.js serves the Pages Router catch-all (src/pages/api/[[...connect]].ts)
 * under basePath + /api, so the effective URL is /insights/api/<service>/<method>.
 */
import { createConnectTransport } from '@connectrpc/connect-web';

export const browserTransport = createConnectTransport({
  baseUrl: '/insights/api',
});
