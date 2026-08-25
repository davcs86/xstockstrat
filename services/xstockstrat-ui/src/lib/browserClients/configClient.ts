import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';

const transport = makeBrowserTransport('/config-ui/api');
export const configClient = createClient(ConfigService, transport);
