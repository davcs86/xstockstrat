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
import { createConnectTransport } from '@connectrpc/connect-node';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';

// ── Base URLs ──────────────────────────────────────────────────────────────
const CONFIG_HTTP_ENDPOINT =
  process.env.CONFIG_HTTP_ENDPOINT ?? 'http://xstockstrat-config:8060';
const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
const INGEST_HTTP_ENDPOINT =
  process.env.INGEST_HTTP_ENDPOINT ?? 'http://xstockstrat-ingest:8055';

function makeTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, httpVersion: '1.1' });
}

// Cast to a generic record so route handlers can call any method with plain
// object inputs without TypeScript routing them through the protobuf-es v2
// message shape types. At runtime, connect v2's JSON serializer reads field
// values from the plain object by name, so this is safe.
type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

// ── Exported clients ───────────────────────────────────────────────────────

export const configClient = createClient(
  ConfigService,
  makeTransport(CONFIG_HTTP_ENDPOINT),
) as unknown as UntypedClient;

export const identityClient = createClient(
  IdentityService,
  makeTransport(IDENTITY_BASE_URL),
) as unknown as UntypedClient;

export const ingestClient = createClient(
  IngestService,
  makeTransport(INGEST_HTTP_ENDPOINT),
) as unknown as UntypedClient;

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
