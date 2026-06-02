import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';

const transport = createConnectTransport({ baseUrl: '/config-ui/api' });
export const configClient = createClient(ConfigService, transport);
