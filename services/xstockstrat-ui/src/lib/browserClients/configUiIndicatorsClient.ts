import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';

// config-ui-scoped indicators client — dials the config-ui BFF, which registers ONLY the template
// authoring RPCs (listTemplates, admin-gated manageTemplate). Distinct from the /insights client.
const transport = makeBrowserTransport('/config-ui/api');
export const configUiIndicatorsClient = createClient(IndicatorsService, transport);
