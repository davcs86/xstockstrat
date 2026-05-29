/**
 * Connect-RPC clients for xstockstrat-config-ui.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Service descriptors use untyped I/O (`{} as any`) so we get a working
 * client without depending on generated proto stubs. JSON encoding is
 * used over Connect-RPC HTTP.
 */
import { MethodKind } from '@bufbuild/protobuf';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';

function makeTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, httpVersion: '1.1' });
}

// ── Base URLs ──────────────────────────────────────────────────────────────
const CONFIG_HTTP_ENDPOINT =
  process.env.CONFIG_HTTP_ENDPOINT ?? 'http://xstockstrat-config:8060';
const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
const INGEST_HTTP_ENDPOINT =
  process.env.INGEST_HTTP_ENDPOINT ?? 'http://xstockstrat-ingest:8055';

// ── Service descriptors ────────────────────────────────────────────────────

const ConfigServiceDef = {
  typeName: 'xstockstrat.config.v1.ConfigService',
  methods: {
    getConfig: { name: 'GetConfig', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    setConfig: { name: 'SetConfig', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    listKeys: { name: 'ListKeys', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    // watchConfig is a server-streaming RPC; config-ui doesn't subscribe to it.
  },
} as const;

const IdentityServiceDef = {
  typeName: 'xstockstrat.identity.v1.IdentityService',
  methods: {
    authenticateUser: { name: 'AuthenticateUser', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    validateToken: { name: 'ValidateToken', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    refreshToken: { name: 'RefreshToken', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    revokeToken: { name: 'RevokeToken', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

const IngestServiceDef = {
  typeName: 'xstockstrat.ingest.v1.IngestService',
  methods: {
    listSignalSources: { name: 'ListSignalSources', I: {} as any, O: {} as any, kind: MethodKind.Unary },
    manageSignalSource: { name: 'ManageSignalSource', I: {} as any, O: {} as any, kind: MethodKind.Unary },
  },
} as const;

// ── Exported clients ───────────────────────────────────────────────────────
// We cast each ServiceDef to `any` for createClient(), which loses the
// per-method `kind` narrowing TypeScript needs to pick the unary overload.
// Cast each exported client to an UntypedClient so call sites can pass
// `(input)` or `(input, options)` without TS routing them to the streaming
// overload (which expects an AsyncIterable input).
type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

export const configClient = createClient(
  ConfigServiceDef as any,
  makeTransport(CONFIG_HTTP_ENDPOINT),
) as unknown as UntypedClient;

export const identityClient = createClient(
  IdentityServiceDef as any,
  makeTransport(IDENTITY_BASE_URL),
) as unknown as UntypedClient;

export const ingestClient = createClient(
  IngestServiceDef as any,
  makeTransport(INGEST_HTTP_ENDPOINT),
) as unknown as UntypedClient;

// ── Connect-Code → HTTP status helper ──────────────────────────────────────
// Shared by every route that catches ConnectError so upstream failures
// surface with a meaningful HTTP status instead of a blanket 500.
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
