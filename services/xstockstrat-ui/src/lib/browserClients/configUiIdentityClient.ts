import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';

// config-ui-segment IdentityService client (/config-ui/api) — the admin Users section calls the six
// user-management RPCs through the config-ui BFF, which admin-gates and forwards identity headers.
const transport = makeBrowserTransport('/config-ui/api');
export const configUiIdentityClient = createClient(IdentityService, transport);
