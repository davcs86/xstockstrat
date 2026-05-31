/**
 * Connect-RPC BFF — App Router.
 *
 * Creates a ConnectRouter with AnalysisService, MarketDataService,
 * PortfolioService, and TradingService (broker accounts), then exposes a
 * dispatchConnect() function that translates a Web API Request into the
 * connect UniversalHandler protocol and back.
 *
 * The catch-all App Router route (src/app/api/[...connect]/route.ts)
 * delegates to dispatchConnect(). All other App Router routes under
 * src/app/api/ (auth/*, health, analysis/*, marketdata, portfolio) take
 * precedence via Next.js smoosh() ordering (static > required catch-all).
 */
import { createConnectRouter, ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { compressionGzip, compressionBrotli } from '@connectrpc/connect-node';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { analysisClient, marketDataClient, portfolioClient, tradingClient } from '@/lib/connectClients';
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

router.service(AnalysisService, {
  async listStrategies(req, ctx) {
    const claims = await requireSession(ctx);
    return analysisClient.listStrategies(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async scoreStrategy(req, ctx) {
    const claims = await requireSession(ctx);
    return analysisClient.scoreStrategy(req, { headers: backendHeaders(claims, ctx) });
  },
  async runBacktest(req, ctx) {
    const claims = await requireSession(ctx);
    return analysisClient.runBacktest(req, { headers: backendHeaders(claims, ctx) });
  },
  async getStrategyReport(req, ctx) {
    const claims = await requireSession(ctx);
    return analysisClient.getStrategyReport(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(MarketDataService, {
  async getBars(req, ctx) {
    const claims = await requireSession(ctx);
    return marketDataClient.getBars(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(PortfolioService, {
  async listPortfolios(req, ctx) {
    const claims = await requireSession(ctx);
    return portfolioClient.listPortfolios(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(TradingService, {
  async listBrokerAccounts(req, ctx) {
    const claims = await requireSession(ctx);
    return tradingClient.listBrokerAccounts(req, { headers: backendHeaders(claims, ctx) });
  },
});

// ── Handler map ───────────────────────────────────────────────────────────

// Next.js strips the configured basePath ('/insights') from req.url before it
// reaches this route handler, so dispatchConnect sees a basePath-relative
// pathname: '/api' + handler.requestPath. Key the map on that — NOT on the
// basePath-prefixed public URL, which would never match and 404 every RPC.
const PREFIX = '/api';
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
