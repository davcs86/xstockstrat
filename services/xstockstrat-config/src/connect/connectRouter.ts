import type { ConnectRouter } from '@connectrpc/connect';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceConnectImpl } from './configServiceConnect';

export function createConnectRouter(impl: ConfigServiceImpl) {
  return (router: ConnectRouter) => {
    router.service(ConfigService, createConfigServiceConnectImpl(impl));
  };
}
