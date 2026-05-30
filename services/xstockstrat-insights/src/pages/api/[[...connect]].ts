/**
 * Connect-RPC BFF catch-all — Pages Router.
 *
 * Exposes AnalysisService, MarketDataService, PortfolioService, and
 * TradingService as Connect-RPC endpoints at
 * /insights/api/<package>.<Service>/<Method>.
 * Browser components use @connectrpc/connect-web createConnectTransport
 * with baseUrl "/insights/api" to call these endpoints directly.
 *
 * Auth/refresh/logout remain in the App Router (src/app/api/auth/*).
 */
import { nextJsApiRouter } from '@connectrpc/connect-next';
import { ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';
import {
  analysisClient,
  marketDataClient,
  portfolioClient,
  tradingClient,
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
    router.service(AnalysisService, {
      async listStrategies(req, ctx) {
        const claims = await requireSession(ctx);
        return analysisClient.listStrategies(
          { ...req, userId: claims.user_id },
          { headers: backendHeaders(claims, ctx) },
        ) as any;
      },
      async scoreStrategy(req, ctx) {
        const claims = await requireSession(ctx);
        return analysisClient.scoreStrategy(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async runBacktest(req, ctx) {
        const claims = await requireSession(ctx);
        return analysisClient.runBacktest(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async getStrategyReport(req, ctx) {
        const claims = await requireSession(ctx);
        return analysisClient.getStrategyReport(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });

    router.service(MarketDataService, {
      async getBars(req, ctx) {
        const claims = await requireSession(ctx);
        return marketDataClient.getBars(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });

    router.service(PortfolioService, {
      async listPortfolios(req, ctx) {
        const claims = await requireSession(ctx);
        return portfolioClient.listPortfolios(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });

    router.service(TradingService, {
      async listBrokerAccounts(req, ctx) {
        const claims = await requireSession(ctx);
        return tradingClient.listBrokerAccounts(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
    });
  },
});

export default handler;
export { config };
