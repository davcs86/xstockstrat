import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';

const transport = makeBrowserTransport('/trader/api');
export const notifyClient = createClient(NotifyService, transport);
