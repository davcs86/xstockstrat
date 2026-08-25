import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';

// Routes through the trader BFF (/trader/api), not the insights BFF.
const transport = makeBrowserTransport('/trader/api');
export const traderAnalysisClient = createClient(AnalysisService, transport);
