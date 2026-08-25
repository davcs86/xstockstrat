import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';

const transport = makeBrowserTransport('/insights/api');
export const analysisClient = createClient(AnalysisService, transport);
