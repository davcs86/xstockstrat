import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';

// config-ui-segment IdentityService client (feature 043) — the admin Users section calls the six
// user-management RPCs through the config-ui BFF (`/config-ui/api`), which admin-gates and forwards
// identity headers. Bound to the config-ui segment, mirroring traderConfigClient's per-segment pattern.
const transport = makeBrowserTransport('/config-ui/api');
export const configUiIdentityClient = createClient(IdentityService, transport);
