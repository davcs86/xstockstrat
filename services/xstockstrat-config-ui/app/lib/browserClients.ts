/**
 * Browser-side Connect clients for config-ui Client Components.
 *
 * These talk the Connect protocol to the Next.js BFF catch-all
 * (app/api/[...connect]/route.ts → connectBff.ts) at basePath + /api,
 * which authenticates the session cookie and forwards to the backend gRPC
 * services with x-user-id / x-access-scope / x-trace-id propagation.
 *
 * Components consume the typed protobuf-es messages directly (camelCase
 * fields, numeric enums) — no JSON field mapping. Same-origin requests send
 * the session cookie automatically.
 */
import { createClient } from '@connectrpc/connect';
import { browserTransport } from './connectTransport';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export const configClient = createClient(ConfigService, browserTransport);
export const ingestClient = createClient(IngestService, browserTransport);
