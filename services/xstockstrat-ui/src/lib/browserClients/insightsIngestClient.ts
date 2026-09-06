import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

// Insights-scoped IngestService client (/insights/api), not the config-ui `ingestClient`
// (/config-ui/api) — insights pages must call their own segment's BFF prefix.
const transport = makeBrowserTransport('/insights/api');
export const insightsIngestClient = createClient(IngestService, transport);
