/**
 * Connect-RPC BFF catch-all — Pages Router.
 *
 * Exposes ConfigService and IngestService as Connect-RPC endpoints at
 * /config-ui/api/<package>.<Service>/<Method>.
 * Browser components use @connectrpc/connect-web createConnectTransport
 * with baseUrl "/config-ui/api" to call these endpoints directly.
 *
 * Auth/refresh/logout and the direct-DB audit route remain in the App
 * Router (app/api/auth/*, app/api/audit).
 */
import { nextJsApiRouter } from '@connectrpc/connect-next';
import { ConnectError, Code, type HandlerContext } from '@connectrpc/connect';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { configClient, ingestClient } from '@/app/lib/connectClients';
import {
  verifyAccessToken,
  rolesToAccessScope,
  generateTraceId,
  type JwtClaims,
} from '@/app/lib/auth';

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
    router.service(ConfigService, {
      async listKeys(req, ctx) {
        const claims = await requireSession(ctx);
        return configClient.listKeys(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async setConfig(req, ctx) {
        const claims = await requireSession(ctx);
        return configClient.setConfig(
          { ...req, author: claims.user_id },
          { headers: backendHeaders(claims, ctx) },
        ) as any;
      },
    });

    router.service(IngestService, {
      async listSignalSources(req, ctx) {
        const claims = await requireSession(ctx);
        return ingestClient.listSignalSources(req, { headers: backendHeaders(claims, ctx) }) as any;
      },
      async manageSignalSource(req, ctx) {
        const claims = await requireSession(ctx);
        // ManageSignalSource may carry an admin key forwarded from the browser.
        const adminKey = ctx.requestHeader.get('x-admin-api-key');
        const headers = backendHeaders(claims, ctx);
        if (adminKey) headers.set('Authorization', `Bearer ${adminKey}`);
        return ingestClient.manageSignalSource(req, { headers }) as any;
      },
    });
  },
});

export default handler;
export { config };
