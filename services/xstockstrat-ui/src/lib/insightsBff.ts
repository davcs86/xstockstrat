import { createConnectRouter, ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { compressionGzip, compressionBrotli } from '@connectrpc/connect-node';
import { AnalysisService, StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { analysisClient, indicatorsClient, ingestClient, marketDataClient, portfolioClient, tradingClient } from '@/lib/connectClients';
import { verifyAccessToken, rolesToAccessScope, generateTraceId, type JwtClaims } from '@/lib/auth';

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
  async manageStrategy(req, ctx) {
    const claims = await requireSession(ctx);
    // Mutations (register/update/deactivate) are admin-only per FR-8 — enforced
    // server-side before forwarding to the gRPC service.
    const mutating =
      req.operation === StrategyOperation.REGISTER ||
      req.operation === StrategyOperation.UPDATE ||
      req.operation === StrategyOperation.DEACTIVATE;
    if (mutating) {
      const ADMIN_BIT = 0x04;
      if ((rolesToAccessScope(claims.roles) & ADMIN_BIT) === 0) {
        throw new ConnectError('Admin scope required', Code.PermissionDenied);
      }
    }
    return analysisClient.manageStrategy(req, { headers: backendHeaders(claims, ctx) });
  },
  async getStrategy(req, ctx) {
    const claims = await requireSession(ctx);
    return analysisClient.getStrategy(req, { headers: backendHeaders(claims, ctx) });
  },
  async listStrategyDefinitions(req, ctx) {
    const claims = await requireSession(ctx);
    return analysisClient.listStrategyDefinitions(req, { headers: backendHeaders(claims, ctx) });
  },
  async setStrategyLive(req, ctx) {
    const claims = await requireSession(ctx);
    // Admin scope gate — enforced server-side before forwarding to the gRPC service.
    const ADMIN_BIT = 0x04;
    if ((rolesToAccessScope(claims.roles) & ADMIN_BIT) === 0) {
      throw new ConnectError('Admin scope required', Code.PermissionDenied);
    }
    return analysisClient.setStrategyLive(req, { headers: backendHeaders(claims, ctx) });
  },
});

router.service(IngestService, {
  async listSignalSources(req, ctx) {
    const claims = await requireSession(ctx);
    return ingestClient.listSignalSources(req, { headers: backendHeaders(claims, ctx) });
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

router.service(IndicatorsService, {
  async registerFormula(req, ctx) {
    const claims = await requireSession(ctx);
    // Set author from JWT claims — overrides any caller-supplied value
    return indicatorsClient.registerFormula(
      { ...req, author: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async getFormula(req, ctx) {
    const claims = await requireSession(ctx);
    return indicatorsClient.getFormula(req, { headers: backendHeaders(claims, ctx) });
  },
  async listFormulas(req, ctx) {
    const claims = await requireSession(ctx);
    return indicatorsClient.listFormulas(req, { headers: backendHeaders(claims, ctx) });
  },
  async updateFormula(req, ctx) {
    const claims = await requireSession(ctx);
    // Enforce user_id from JWT — caller cannot impersonate another user
    return indicatorsClient.updateFormula(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async deleteFormula(req, ctx) {
    const claims = await requireSession(ctx);
    return indicatorsClient.deleteFormula(
      { ...req, userId: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
  async executeFormula(req, ctx) {
    const claims = await requireSession(ctx);
    return indicatorsClient.executeFormula(req, { headers: backendHeaders(claims, ctx) });
  },
  async computeIndicator(req, ctx) {
    const claims = await requireSession(ctx);
    return indicatorsClient.computeIndicator(req, { headers: backendHeaders(claims, ctx) });
  },
  async listIndicators(req, ctx) {
    const claims = await requireSession(ctx);
    return indicatorsClient.listIndicators(req, { headers: backendHeaders(claims, ctx) });
  },
});

// In the consolidated app there is no basePath — the full URL /insights/api/<service>/<method>
// reaches this handler, so the prefix must include the segment path.
const PREFIX = '/insights/api';
const handlerMap = new Map(router.handlers.map((h) => [PREFIX + h.requestPath, h]));

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
}
