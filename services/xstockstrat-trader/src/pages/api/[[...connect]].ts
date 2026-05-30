/**
 * Connect-RPC BFF catch-all — Pages Router.
 *
 * Exposes TradingService, PortfolioService, and MarketDataService as
 * Connect-RPC endpoints at /trader/api/<package>.<Service>/<Method>.
 * Browser components use @connectrpc/connect-web createConnectTransport
 * with baseUrl "/trader/api" to call these endpoints directly.
 *
 * Auth/refresh/logout and the SSE alerts stream remain in the App Router
 * (src/app/api/auth/*, src/app/api/alerts/stream) since they manage
 * cookies and SSE — not Connect protocol.
 */
import { nextJsApiRouter } from '@connectrpc/connect-next';
import { ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import {
  tradingClient,
  portfolioClient,
  marketDataClient,
} from '@/lib/connectClients';
import {
  verifyAccessToken,
  rolesToAccessScope,
  generateTraceId,
  type JwtClaims,
} from '@/lib/auth';

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

const { handler, config } = nextJsApiRouter({
  routes(router) {
    router.service(TradingService, {
      async placeOrder(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.placeOrder(
          { ...req, userId: claims.user_id },
          { headers: backendHeaders(claims, ctx) },
        ) as any;
      },
      async listOrders(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.listOrders(
          { ...req, userId: claims.user_id },
          { headers: backendHeaders(claims, ctx) },
        ) as any;
      },
      async getOrder(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.getOrder(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async cancelOrder(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.cancelOrder(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async listBrokerAccounts(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.listBrokerAccounts(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async registerBrokerAccount(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.registerBrokerAccount(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async deregisterBrokerAccount(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.deregisterBrokerAccount(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });

    router.service(PortfolioService, {
      async getPortfolio(req, ctx) {
        const claims = await requireSession(ctx);
        return portfolioClient.getPortfolio(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async listPortfolios(req, ctx) {
        const claims = await requireSession(ctx);
        return portfolioClient.listPortfolios(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });

    router.service(MarketDataService, {
      async getBars(req, ctx) {
        const claims = await requireSession(ctx);
        return marketDataClient.getBars(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async listAssets(req, ctx) {
        const claims = await requireSession(ctx);
        return marketDataClient.listAssets(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });
  },
});

export default handler;
export { config };
