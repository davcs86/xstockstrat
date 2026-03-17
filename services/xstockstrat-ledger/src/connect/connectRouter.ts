import { ConnectRouter } from '@connectrpc/connect';
import { LedgerServiceImpl } from '../grpc/ledgerServiceImpl';

/**
 * Connect-RPC router for LedgerService.
 * Bridges the existing gRPC implementation to the Connect protocol
 * (HTTP/1.1 + HTTP/2, protobuf + JSON).
 */
export function createConnectRouter(impl: LedgerServiceImpl) {
  return (router: ConnectRouter) => {
    router.rpc(
      { typeName: 'xstockstrat.ledger.v1.LedgerService', name: 'AppendEvent' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.appendEvent({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );

    router.rpc(
      { typeName: 'xstockstrat.ledger.v1.LedgerService', name: 'QueryEvents' } as any,
      async (req: any) =>
        new Promise<any>((resolve, reject) =>
          impl.queryEvents({ request: req }, (err: any, res: any) => {
            if (err) reject(err); else resolve(res);
          })
        )
    );
  };
}
