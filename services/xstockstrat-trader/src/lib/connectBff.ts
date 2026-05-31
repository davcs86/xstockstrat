/**
 * Connect-RPC BFF — App Router.
 *
 * Creates a ConnectRouter with TradingService, PortfolioService, and
 * MarketDataService, then exposes a dispatchConnect() function that
 * translates a Web API Request into the connect UniversalHandler protocol
 * and back.
 *
 * The catch-all App Router route (src/app/api/[...connect]/route.ts)
 * delegates to dispatchConnect(). All other App Router routes under
 * src/app/api/ (auth/*, health, orders/*, accounts/*, alerts/stream,
 * chart, portfolio/*) take precedence via Next.js smoosh() ordering
 * (static > required catch-all) and are unaffected.
 */
import { createConnectRouter, ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { compressionGzip, compressionBrotli } from '@connectrpc/connect-node';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import { tradingClient, portfolioClient, marketDataClient, notifyClient } from '@/lib/connectClients';
import { verifyAccessToken, rolesToAccessScope, generateTraceId, type JwtClaims } from '@/lib/auth';

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

router.service(TradingService, {
  async placeOrder(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.placeOrder(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async listOrders(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.listOrders(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async getOrder(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.getOrder(req, { headers: backendHeaders(claims, ctx) });
  },
  async cancelOrder(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.cancelOrder(req, { headers: backendHeaders(claims, ctx) });
  },
  async listBrokerAccounts(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.listBrokerAccounts(req, { headers: backendHeaders(claims, ctx) });
  },
  async registerBrokerAccount(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.registerBrokerAccount(req, { headers: backendHeaders(claims, ctx) });
  },
  async deregisterBrokerAccount(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.deregisterBrokerAccount(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(PortfolioService, {
  async getPortfolio(req, ctx) {
    const claims = await requireSession(ctx);
    return portfolioClient.getPortfolio(req, { headers: backendHeaders(claims, ctx) });
  },
  async listPortfolios(req, ctx) {
    const claims = await requireSession(ctx);
    return portfolioClient.listPortfolios(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(MarketDataService, {
  async getBars(req, ctx) {
    const claims = await requireSession(ctx);
    return marketDataClient.getBars(req, { headers: backendHeaders(claims, ctx) });
  },
  async listAssets(req, ctx) {
    const claims = await requireSession(ctx);
    return marketDataClient.listAssets(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(NotifyService, {
  // Server-streaming: forward the notify StreamAlerts gRPC server-stream to the
  // browser over the Connect streaming protocol (replaces the old SSE bridge).
  async *streamAlerts(req, ctx) {
    const claims = await requireSession(ctx);
    yield* notifyClient.streamAlerts(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx), signal: ctx.signal },
    );
  },
});

// ── Handler map ───────────────────────────────────────────────────────────

// basePath('/trader') + '/api' + handler.requestPath
// e.g. /trader/api/trading.v1.TradingService/PlaceOrder
const PREFIX = '/trader/api';
const handlerMap = new Map(router.handlers.map((h) => [PREFIX + h.requestPath, h]));

// ── Web API ↔ Universal adapters ──────────────────────────────────────────

function bodyAsIterable(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
  if (!body) return (async function* () {})();
  // Node.js 18+ ReadableStream implements Symbol.asyncIterator at runtime.
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
  // Merge Connect/gRPC-web trailers into response headers when present.
  uRes.trailer?.forEach((value, key) => responseHeaders.append(key, value));

  return new Response(uRes.body ? iterableAsStream(uRes.body) : null, {
    status: uRes.status,
    headers: responseHeaders,
  });
}
