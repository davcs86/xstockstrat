// Shared BFF machinery for the per-segment Connect routers (traderBff / insightsBff /
// configUiBff). These helpers were previously copy-pasted into all three segment files;
// they now live here so there is exactly one implementation of session verification,
// header propagation, the admin-scope gate, the stream adapters, and the Connect dispatch
// loop. See docs/patterns/dry-guard-rail.md.
//
// Node-only (imports @connectrpc/connect-node) — never import from middleware/Edge code.

import {
  createConnectRouter,
  ConnectError,
  Code,
  type ConnectRouter,
  type HandlerContext,
} from '@connectrpc/connect';
import { compressionGzip, compressionBrotli } from '@connectrpc/connect-node';
import {
  verifyAccessToken,
  rolesToAccessScope,
  generateTraceId,
  hasAdminScope,
  type JwtClaims,
} from '@/lib/auth';
import { HEADER_USER_ID, HEADER_ACCESS_SCOPE, HEADER_TRACE_ID } from '@/lib/headers';

function parseCookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/** Verify the access-token cookie on an inbound Connect request, or throw Unauthenticated. */
export async function requireSession(ctx: HandlerContext): Promise<JwtClaims> {
  const token = parseCookieValue(ctx.requestHeader.get('cookie') ?? '', 'access_token');
  if (!token) throw new ConnectError('Unauthenticated', Code.Unauthenticated);
  const claims = await verifyAccessToken(token);
  if (!claims) throw new ConnectError('Token invalid or expired', Code.Unauthenticated);
  return claims;
}

/** Build the platform-internal propagation headers for an outbound backend gRPC call. */
export function backendHeaders(claims: JwtClaims, ctx: HandlerContext): Headers {
  return new Headers({
    [HEADER_USER_ID]: claims.user_id,
    [HEADER_ACCESS_SCOPE]: String(rolesToAccessScope(claims.roles)),
    [HEADER_TRACE_ID]: ctx.requestHeader.get(HEADER_TRACE_ID) ?? generateTraceId(),
  });
}

/** Admin-scope gate — throws PermissionDenied unless the session carries the admin bit. */
export function requireAdminScope(claims: JwtClaims): void {
  if (!hasAdminScope(claims.roles)) {
    throw new ConnectError('Admin scope required', Code.PermissionDenied);
  }
}

/**
 * Build a Connect handler for the common case: verify the session, then forward the request
 * to a backend gRPC method with the propagated identity headers. Handlers that inject a
 * verified field (e.g. `userId`), stream, or gate on admin scope keep their explicit body.
 *
 *   getBars: forward((req, opts) => marketDataClient.getBars(req, opts)),
 */
export function forward<Req, Res>(
  call: (req: Req, opts: { headers: Headers }) => Promise<Res>,
  options: { admin?: boolean } = {},
): (req: Req, ctx: HandlerContext) => Promise<Res> {
  return async (req, ctx) => {
    const claims = await requireSession(ctx);
    if (options.admin) requireAdminScope(claims);
    return call(req, { headers: backendHeaders(claims, ctx) });
  };
}

/** Like {@link forward}, but gated on admin scope (throws PermissionDenied otherwise). */
export function forwardAdmin<Req, Res>(
  call: (req: Req, opts: { headers: Headers }) => Promise<Res>,
): (req: Req, ctx: HandlerContext) => Promise<Res> {
  return forward(call, { admin: true });
}

/** A Connect router preconfigured with the platform's accepted compressions. */
export function createBffRouter(): ConnectRouter {
  return createConnectRouter({ acceptCompression: [compressionGzip, compressionBrotli] });
}

function bodyAsIterable(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
  if (!body) return (async function* () {})();
  return body as unknown as AsyncIterable<Uint8Array>;
}

function iterableAsStream(iter: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const it = iter[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      it.return?.(reason);
    },
  });
}

/**
 * Build a segment `dispatchConnect(req)` handler. `prefix` is the segment's full request
 * prefix (e.g. `/trader/api`) — in the consolidated app Next.js does NOT strip a basePath,
 * so the handler-map key must include it.
 */
export function createDispatch(
  router: ConnectRouter,
  prefix: string,
): (req: Request) => Promise<Response> {
  const handlerMap = new Map(router.handlers.map((h) => [prefix + h.requestPath, h]));

  return async function dispatchConnect(req: Request): Promise<Response> {
    const pathname = new URL(req.url).pathname;
    const handler = handlerMap.get(pathname);
    if (!handler) return new Response(null, { status: 404 });

    const uRes = await handler({
      httpVersion: '2.0',
      url: req.url,
      method: req.method,
      header: req.headers,
      body: bodyAsIterable(req.body),
      signal: req.signal,
    });

    const responseHeaders = new Headers(uRes.header);
    uRes.trailer?.forEach((value, key) => responseHeaders.append(key, value));

    // Connect unary errors are always uncompressed JSON. When a handler forwards a
    // ConnectError from a downstream gRPC service, that error's metadata carries the
    // gRPC response's content-type (application/grpc+proto) and content-encoding;
    // createConnectRouter copies them onto the error response, so the browser's Connect
    // client cannot parse the JSON body and surfaces a generic "HTTP <status>" instead
    // of the real validation message. Normalise the headers on the error path.
    if (uRes.status >= 400) {
      responseHeaders.set('content-type', 'application/json');
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('grpc-encoding');
      responseHeaders.delete('content-length');
    }

    return new Response(uRes.body ? iterableAsStream(uRes.body) : null, {
      status: uRes.status,
      headers: responseHeaders,
    });
  };
}
