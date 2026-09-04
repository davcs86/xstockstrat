import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';

// config-ui-scoped analysis client — dials the config-ui BFF, which registers ONLY
// runFundamentalsScan (admin-gated). Distinct from the /insights analysisClient (own segment prefix).
const transport = makeBrowserTransport('/config-ui/api');
export const configUiAnalysisClient = createClient(AnalysisService, transport);
