import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

const transport = makeBrowserTransport('/config-ui/api');
export const ingestClient = createClient(IngestService, transport);
