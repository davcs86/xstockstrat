import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';

const transport = createConnectTransport({ baseUrl: '/insights/api' });
export const analysisClient = createClient(AnalysisService, transport);
