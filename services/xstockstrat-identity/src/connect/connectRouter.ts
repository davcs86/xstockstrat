import type { ConnectRouter } from '@connectrpc/connect';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import { IdentityServiceImpl } from '../grpc/identityServiceImpl';
import { createIdentityServiceConnectImpl } from './identityServiceConnect';

export function createConnectRouter(impl: IdentityServiceImpl) {
  return (router: ConnectRouter) => {
    router.service(IdentityService, createIdentityServiceConnectImpl(impl));
  };
}
