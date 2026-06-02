import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

const transport = createConnectTransport({ baseUrl: '/config-ui/api' });
export const ingestClient = createClient(IngestService, transport);
