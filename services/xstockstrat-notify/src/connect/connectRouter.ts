import { ConnectRouter } from '@connectrpc/connect';
import { NotifyServiceImpl } from '../grpc/notifyServiceImpl';

/**
 * Connect-RPC router for NotifyService.
 * Bridges the existing gRPC implementation to the Connect protocol
 * (HTTP/1.1 + HTTP/2, protobuf + JSON).
 *
 * Note: StreamAlerts (server-streaming) is available via Connect server-streaming,
 * enabling browser clients to receive alerts without gRPC-specific transport.
 */
export function createConnectRouter(impl: NotifyServiceImpl) {
  return (router: ConnectRouter) => {
    router.rpc(
      { typeName: 'xstockstrat.notify.v1.NotifyService', name: 'EmitAlert' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.emitAlert({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );

    router.rpc(
      { typeName: 'xstockstrat.notify.v1.NotifyService', name: 'AcknowledgeAlert' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.acknowledgeAlert({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );
  };
}
