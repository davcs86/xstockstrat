/**
 * Connect-RPC BFF — App Router.
 *
 * Creates a ConnectRouter with ConfigService and IngestService, then exposes
 * a dispatchConnect() function that translates a Web API Request into the
 * connect UniversalHandler protocol and back.
 *
 * The catch-all App Router route (app/api/[...connect]/route.ts) delegates
 * to dispatchConnect(). All other App Router routes under app/api/ (auth/*,
 * health, audit, config, sources) take precedence via Next.js smoosh()
 * ordering (static > required catch-all).
 */
import { createConnectRouter, ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { compressionGzip, compressionBrotli } from '@connectrpc/connect-node';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { configClient, ingestClient } from '@/app/lib/connectClients';
import { verifyAccessToken, rolesToAccessScope, generateTraceId, type JwtClaims } from '@/app/lib/auth';

// ── Auth helpers ──────────────────────────────────────────────────────────

function parseCookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function requireSession(ctx: HandlerContext): Promise<JwtClaims> {
  const token = parseCookieValue(ctx.requestHeader.get('cookie') ?? '', 'access_token');
  if (!token) throw new ConnectError('Unauthenticated', Code.Unauthenticated);
  const claims = await verifyAccessToken(token);
  if (!claims) throw new ConnectError('Token invalid or expired', Code.Unauthenticated);
  return claims;
}

function backendHeaders(claims: JwtClaims, ctx: HandlerContext): Headers {
  return new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': ctx.requestHeader.get('x-trace-id') ?? generateTraceId(),
  });
}

// ── Router ────────────────────────────────────────────────────────────────

const router = createConnectRouter({ acceptCompression: [compressionGzip, compressionBrotli] });

router.service(ConfigService, {
  async listKeys(req, ctx) {
    const claims = await requireSession(ctx);
    return configClient.listKeys(req, { headers: backendHeaders(claims, ctx) });
  },
  async setConfig(req, ctx) {
    const claims = await requireSession(ctx);
    return configClient.setConfig(
      { ...req, author: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
});

router.service(IngestService, {
  async listSignalSources(req, ctx) {
    const claims = await requireSession(ctx);
    return ingestClient.listSignalSources(req, { headers: backendHeaders(claims, ctx) });
  },
  async manageSignalSource(req, ctx) {
    const claims = await requireSession(ctx);
    // ManageSignalSource may carry an admin key forwarded from the browser.
    const adminKey = ctx.requestHeader.get('x-admin-api-key');
    const headers = backendHeaders(claims, ctx);
    if (adminKey) headers.set('Authorization', `Bearer ${adminKey}`);
    return ingestClient.manageSignalSource(req, { headers });
  },
});

// ── Handler map ───────────────────────────────────────────────────────────

// basePath('/config-ui') + '/api' + handler.requestPath
const PREFIX = '/config-ui/api';
const handlerMap = new Map(router.handlers.map((h) => [PREFIX + h.requestPath, h]));

// ── Web API ↔ Universal adapters ──────────────────────────────────────────

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

// ── Dispatcher ────────────────────────────────────────────────────────────

export async function dispatchConnect(req: Request): Promise<Response> {
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

  return new Response(uRes.body ? iterableAsStream(uRes.body) : null, {
    status: uRes.status,
    headers: responseHeaders,
  });
}
