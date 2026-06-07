import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

// Routes through the insights BFF (/insights/api), not the config-ui BFF.
// The config-ui `ingestClient` points at /config-ui/api; insights pages need
// their own client scoped to the insights segment.
const transport = createConnectTransport({ baseUrl: '/insights/api' });
export const insightsIngestClient = createClient(IngestService, transport);
