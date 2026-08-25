import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

// Routes through the insights BFF (/insights/api), not the config-ui BFF.
// The config-ui `ingestClient` points at /config-ui/api; insights pages need
// their own client scoped to the insights segment.
const transport = makeBrowserTransport('/insights/api');
export const insightsIngestClient = createClient(IngestService, transport);
