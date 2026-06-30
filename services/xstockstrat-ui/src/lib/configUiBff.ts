import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { IngestService } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { configClient, ingestClient } from '@/lib/connectClients';
import {
  createBffRouter,
  createDispatch,
  requireSession,
  backendHeaders,
  forward,
} from '@/lib/bffShared';

const router = createBffRouter();

router.service(ConfigService, {
  listKeys: forward((req, opts) => configClient.listKeys(req, opts)),
  async setConfig(req, ctx) {
    const claims = await requireSession(ctx);
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

// In the consolidated app there is no basePath — the full URL /config-ui/api/<service>/<method>
// reaches this handler, so the prefix must include the segment path.
export const dispatchConnect = createDispatch(router, '/config-ui/api');
