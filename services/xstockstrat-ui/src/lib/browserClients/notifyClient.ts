import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';

const transport = createConnectTransport({ baseUrl: '/trader/api' });
export const notifyClient = createClient(NotifyService, transport);
