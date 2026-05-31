/**
 * Connect-RPC clients for xstockstrat-config-ui.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses @connectrpc/connect v2 with service descriptors from the generated
 * *_pb.ts files (protobuf-es v2 schema-based). In connect v2, createClient
 * does not use instanceof for message normalization, so the runtime TypeError
 * from connect v1 + protoc-gen-es v2 type erasure no longer applies.
 */
import { Code, createClient } from '@connectrpc/connect';
import { createGrpcTransport, createConnectTransport } from '@connectrpc/connect-node';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

// ── gRPC endpoints (host:port, no protocol) ───────────────────────────────
const CONFIG_ENDPOINT =
  process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
const IDENTITY_ENDPOINT =
  process.env.IDENTITY_ENDPOINT ?? 'xstockstrat-identity:50058';
const INGEST_ENDPOINT =
  process.env.INGEST_ENDPOINT ?? 'xstockstrat-ingest:50055';

function makeTransport(grpcEndpoint: string, httpOverride?: string) {
  if (httpOverride) {
    return createConnectTransport({ baseUrl: httpOverride, httpVersion: '1.1', useBinaryFormat: false });
  }
  return createGrpcTransport({ baseUrl: `http://${grpcEndpoint}` });
}

// ── Exported clients ───────────────────────────────────────────────────────

export const configClient = createClient(ConfigService, makeTransport(CONFIG_ENDPOINT, process.env.CONFIG_HTTP_ENDPOINT));
export const identityClient = createClient(IdentityService, makeTransport(IDENTITY_ENDPOINT, process.env.IDENTITY_HTTP_ENDPOINT));
export const ingestClient = createClient(IngestService, makeTransport(INGEST_ENDPOINT, process.env.INGEST_HTTP_ENDPOINT));

// ── Connect-Code → HTTP status helper ──────────────────────────────────────
export function connectCodeToHttp(code: Code): number {
  switch (code) {
    case Code.InvalidArgument:
    case Code.FailedPrecondition:
    case Code.OutOfRange:
      return 400;
    case Code.Unauthenticated:
      return 401;
    case Code.PermissionDenied:
      return 403;
    case Code.NotFound:
      return 404;
    case Code.AlreadyExists:
    case Code.Aborted:
      return 409;
    case Code.ResourceExhausted:
      return 429;
    case Code.Unimplemented:
      return 501;
    case Code.Unavailable:
      return 503;
    case Code.DeadlineExceeded:
      return 504;
    default:
      return 500;
  }
}
