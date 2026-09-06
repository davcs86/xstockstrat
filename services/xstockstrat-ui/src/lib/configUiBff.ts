import { ConnectError, Code } from '@connectrpc/connect';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { configClient, ingestClient, analysisClient, identityClient } from '@/lib/connectClients';
import {
  getNativeConfigEnv,
  isNativeConfigEnvironment,
  nativeConfigEnvironment,
} from '@/lib/deploymentEnv';
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
    // Admin-only, defense in depth (the backend re-checks the x-access-scope ADMIN bit). Keeps an
    // explicit body rather than forwardAdmin because the author is injected from the session below.
    requireAdminScope(claims);
    // An UNSPECIFIED environment (e.g. the /sources secret write, which can't read APPLICATION_ENV)
    // targets THIS deployment's native scope — fill it server-side so the write lands on the right env.
    const environment =
      req.environment === Environment.UNSPECIFIED ? nativeConfigEnvironment() : req.environment;
    // Native scope is fixed by APPLICATION_ENV — dev and prod are separate DBs, so a cross-env write
    // is unreachable by any real consumer. Reject it server-side so a direct RPC can't bypass the UI gate.
    if (!isNativeConfigEnvironment(environment)) {
      throw new ConnectError(
        `This deployment's native environment is ${getNativeConfigEnv()}; ` +
          'SetConfig requests scoped to a different environment are rejected.',
        Code.FailedPrecondition,
      );
    }
    return configClient.setConfig(
      { ...req, environment, author: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
  },
});

router.service(IngestService, {
  listSignalSources: forward((req, opts) => ingestClient.listSignalSources(req, opts)),
  manageSignalSource: forward((req, opts) => ingestClient.manageSignalSource(req, opts)),
});

// Only the admin-scoped manual producer trigger is exposed — connect-node leaves every other
// AnalysisService method unimplemented, so this doesn't widen the config-ui surface.
router.service(AnalysisService, {
  runFundamentalsScan: forwardAdmin((req, opts) => analysisClient.runFundamentalsScan(req, opts)),
});

// User management — only these six IdentityService methods are registered (connect-node leaves the
// rest unimplemented). createUser/updatePassword carry a write-only password (never logged or echoed).
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

// No basePath in the consolidated app — the handler receives the full URL
// /config-ui/api/<service>/<method>, so the prefix must include the segment path.
export const dispatchConnect = createDispatch(router, '/config-ui/api');
