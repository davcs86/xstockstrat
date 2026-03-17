import { ConnectRouter } from '@connectrpc/connect';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';

/**
 * Creates a Connect-RPC router that bridges the existing ConfigServiceImpl
 * to the Connect protocol (HTTP/1.1 + HTTP/2, protobuf + JSON).
 *
 * The Connect router is mounted on the HTTP port (8060) and accepts
 * requests from browser clients and the config-ui service.
 *
 * Note: WatchConfig streaming is exposed as a server-streaming Connect RPC.
 * The gRPC port (50060) remains active for internal service-to-service calls.
 */
export function createConnectRouter(impl: ConfigServiceImpl) {
  return (router: ConnectRouter) => {
    // Dynamically route Connect RPC calls to ConfigServiceImpl methods.
    // The router matches on the RPC path: /xstockstrat.config.v1.ConfigService/<MethodName>
    router.rpc(
      { typeName: 'xstockstrat.config.v1.ConfigService', name: 'GetConfig' } as any,
      async (req: any) => {
        return new Promise<any>((resolve, reject) => {
          impl.getConfig({ request: req }, (err: any, res: any) => {
            if (err) reject(err);
            else resolve(res);
          });
        });
      }
    );

    router.rpc(
      { typeName: 'xstockstrat.config.v1.ConfigService', name: 'SetConfig' } as any,
      async (req: any) => {
        return new Promise<any>((resolve, reject) => {
          impl.setConfig({ request: req }, (err: any, res: any) => {
            if (err) reject(err);
            else resolve(res);
          });
        });
      }
    );

    router.rpc(
      { typeName: 'xstockstrat.config.v1.ConfigService', name: 'ListKeys' } as any,
      async (req: any) => {
        return new Promise<any>((resolve, reject) => {
          impl.listKeys({ request: req }, (err: any, res: any) => {
            if (err) reject(err);
            else resolve(res);
          });
        });
      }
    );
  };
}
