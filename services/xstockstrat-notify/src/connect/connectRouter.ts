import type { ConnectRouter } from '@connectrpc/connect';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import { NotifyServiceImpl } from '../grpc/notifyServiceImpl';
import { createNotifyServiceConnectImpl } from './notifyServiceConnect';

export function createConnectRouter(impl: NotifyServiceImpl) {
  return (router: ConnectRouter) => {
    router.service(NotifyService, createNotifyServiceConnectImpl(impl));
  };
}
