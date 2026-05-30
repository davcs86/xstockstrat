/**
 * Connect-RPC clients for xstockstrat-config-ui.
 * Used server-side in Next.js Route Handlers — NOT in browser components.
 *
 * Uses raw fetch with Connect-RPC JSON protocol instead of createClient() to
 * avoid the normalize() instanceof check that throws TypeError when method.I
 * is not a proper constructor (generated connect-es v1 + protobuf-es v2 mismatch).
 */
import { ConnectError, Code } from '@connectrpc/connect';

// ── Base URLs ──────────────────────────────────────────────────────────────
const CONFIG_HTTP_ENDPOINT =
  process.env.CONFIG_HTTP_ENDPOINT ?? 'http://xstockstrat-config:8060';
const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
const INGEST_HTTP_ENDPOINT =
  process.env.INGEST_HTTP_ENDPOINT ?? 'http://xstockstrat-ingest:8055';

type UntypedClient = Record<
  string,
  (input?: unknown, options?: { headers?: Headers }) => Promise<unknown>
>;

// Maps Connect-RPC JSON error code strings to Code enum values.
function codeFromString(codeStr: string): Code {
  switch (codeStr) {
    case 'canceled': return Code.Canceled;
    case 'unknown': return Code.Unknown;
    case 'invalid_argument': return Code.InvalidArgument;
    case 'deadline_exceeded': return Code.DeadlineExceeded;
    case 'not_found': return Code.NotFound;
    case 'already_exists': return Code.AlreadyExists;
    case 'permission_denied': return Code.PermissionDenied;
    case 'resource_exhausted': return Code.ResourceExhausted;
    case 'failed_precondition': return Code.FailedPrecondition;
    case 'aborted': return Code.Aborted;
    case 'out_of_range': return Code.OutOfRange;
    case 'unimplemented': return Code.Unimplemented;
    case 'internal': return Code.Internal;
    case 'unavailable': return Code.Unavailable;
    case 'data_loss': return Code.DataLoss;
    case 'unauthenticated': return Code.Unauthenticated;
    default: return Code.Unknown;
  }
}

async function connectPost(url: string, input: unknown, headers?: Headers): Promise<unknown> {
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headers) {
    headers.forEach((value, key) => { reqHeaders[key] = value; });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(input ?? {}),
  });
  if (res.ok) return res.json();
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* ignore parse error */ }
  const msg = typeof body.message === 'string' ? body.message : 'RPC error';
  const code = typeof body.code === 'string' ? codeFromString(body.code) : Code.Unknown;
  throw new ConnectError(msg, code);
}

function makeClient(
  baseUrl: string,
  typeName: string,
  methods: Record<string, string>,
): UntypedClient {
  const client: UntypedClient = {};
  for (const [methodName, rpcName] of Object.entries(methods)) {
    client[methodName] = (input?: unknown, options?: { headers?: Headers }) =>
      connectPost(`${baseUrl}/${typeName}/${rpcName}`, input, options?.headers);
  }
  return client;
}

// ── Exported clients ───────────────────────────────────────────────────────

export const configClient = makeClient(
  CONFIG_HTTP_ENDPOINT,
  'xstockstrat.config.v1.ConfigService',
  {
    getConfig: 'GetConfig',
    setConfig: 'SetConfig',
    listKeys: 'ListKeys',
    // watchConfig is server-streaming; config-ui does not subscribe to it.
  },
);

export const identityClient = makeClient(
  IDENTITY_BASE_URL,
  'xstockstrat.identity.v1.IdentityService',
  {
    authenticateUser: 'AuthenticateUser',
    validateToken: 'ValidateToken',
    refreshToken: 'RefreshToken',
    revokeToken: 'RevokeToken',
  },
);

export const ingestClient = makeClient(
  INGEST_HTTP_ENDPOINT,
  'xstockstrat.ingest.v1.IngestService',
  {
    listSignalSources: 'ListSignalSources',
    manageSignalSource: 'ManageSignalSource',
  },
);

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
