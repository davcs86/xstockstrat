import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';

// config-ui-scoped analysis client (feature 156): dials the config-ui BFF, which registers ONLY
// AnalysisService.runFundamentalsScan (admin-gated). Distinct from the /insights-scoped
// analysisClient — a config-ui page must call its own segment's BFF prefix.
const transport = makeBrowserTransport('/config-ui/api');
export const configUiAnalysisClient = createClient(AnalysisService, transport);
