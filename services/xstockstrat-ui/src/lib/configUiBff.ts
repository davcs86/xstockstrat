import { ConnectError, Code } from '@connectrpc/connect';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { configClient, ingestClient, analysisClient, identityClient } from '@/lib/connectClients';
import { getNativeConfigEnv, isNativeConfigEnvironment } from '@/lib/deploymentEnv';
import {
  createBffRouter,
  createDispatch,
  requireSession,
  requireAdminScope,
  backendHeaders,
  forward,
  forwardAdmin,
} from '@/lib/bffShared';

const router = createBffRouter();

router.service(ConfigService, {
  listKeys: forward((req, opts) => configClient.listKeys(req, opts)),
  async setConfig(req, ctx) {
    const claims = await requireSession(ctx);
    // Config writes are admin-only — enforced here as defense in depth. The backend
    // ConfigService.SetConfig also checks the propagated x-access-scope ADMIN bit
    // (feature 074); neither gate is load-bearing alone. Keeps an explicit body rather
    // than forwardAdmin because the author is injected from the verified session below.
    requireAdminScope(claims);
    // This deployment's native scope is fixed by APPLICATION_ENV — dev and production are
    // separate physical databases, so a write scoped to the other environment is silently
    // unreachable by any real consumer (feature 115). Reject it here, not just in the UI,
    // so a direct RPC call / bookmark / stale tab can't bypass the gate the UI presents.
    if (!isNativeConfigEnvironment(req.environment)) {
      throw new ConnectError(
        `This deployment's native environment is ${getNativeConfigEnv()}; ` +
          'SetConfig requests scoped to a different environment are rejected.',
        Code.FailedPrecondition,
      );
    }
    return configClient.setConfig(
      { ...req, author: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
});

router.service(IngestService, {
  listSignalSources: forward((req, opts) => ingestClient.listSignalSources(req, opts)),
  manageSignalSource: forward((req, opts) => ingestClient.manageSignalSource(req, opts)),
});

// Only the admin-scoped manual producer trigger is exposed here (feature 156) — connect-node leaves
// every other AnalysisService method unimplemented, so this does not widen the config-ui surface.
router.service(AnalysisService, {
  runFundamentalsScan: forwardAdmin((req, opts) => analysisClient.runFundamentalsScan(req, opts)),
});

// User management (admin-gated, feature 043). Only these six IdentityService methods are registered;
// connect-node leaves the rest (auth/OAuth/metadata) unimplemented, so config-ui exposes user
// management only. Reads are admin-gated server-side too (AC-7); forwardAdmin keeps the UI honest.
// createUser/updatePassword keep an explicit admin-gated body because they carry a write-only
// password (forwarded to the backend, never logged or echoed — AC-10); the password is not rewritten.
router.service(IdentityService, {
  listUsers: forwardAdmin((req, opts) => identityClient.listUsers(req, opts)),
  getUser: forwardAdmin((req, opts) => identityClient.getUser(req, opts)),
  setUserRoles: forwardAdmin((req, opts) => identityClient.setUserRoles(req, opts)),
  setUserActive: forwardAdmin((req, opts) => identityClient.setUserActive(req, opts)),
  async createUser(req, ctx) {
    const claims = await requireSession(ctx);
    requireAdminScope(claims);
    return identityClient.createUser(req, { headers: backendHeaders(claims, ctx) });
  },
  async updatePassword(req, ctx) {
    const claims = await requireSession(ctx);
    requireAdminScope(claims);
    return identityClient.updatePassword(req, { headers: backendHeaders(claims, ctx) });
  },
});

// In the consolidated app there is no basePath — the full URL /config-ui/api/<service>/<method>
// reaches this handler, so the prefix must include the segment path.
export const dispatchConnect = createDispatch(router, '/config-ui/api');
