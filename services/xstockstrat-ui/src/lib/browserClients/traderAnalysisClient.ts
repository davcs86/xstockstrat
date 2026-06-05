import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';

// Routes through the trader BFF (/trader/api), not the insights BFF.
const transport = createConnectTransport({ baseUrl: '/trader/api' });
export const traderAnalysisClient = createClient(AnalysisService, transport);
