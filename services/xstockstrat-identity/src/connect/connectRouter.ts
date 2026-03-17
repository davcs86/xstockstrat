import { ConnectRouter } from '@connectrpc/connect';
import { IdentityServiceImpl } from '../grpc/identityServiceImpl';

/**
 * Connect-RPC router for IdentityService.
 * Bridges the existing gRPC implementation to the Connect protocol
 * (HTTP/1.1 + HTTP/2, protobuf + JSON).
 */
export function createConnectRouter(impl: IdentityServiceImpl) {
  return (router: ConnectRouter) => {
    router.rpc(
      { typeName: 'xstockstrat.identity.v1.IdentityService', name: 'AuthenticateUser' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.authenticateUser({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );

    router.rpc(
      { typeName: 'xstockstrat.identity.v1.IdentityService', name: 'ValidateToken' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.validateToken({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );

    router.rpc(
      { typeName: 'xstockstrat.identity.v1.IdentityService', name: 'CreateApiKey' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.createApiKey({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );
  };
}
