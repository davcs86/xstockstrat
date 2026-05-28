import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import type {
  GetConfigRequest,
  ListKeysRequest,
  SetConfigRequest,
  WatchConfigRequest,
} from '@xstockstrat/proto/config/v1/config_pb';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';

export function createConfigServiceConnectImpl(
  impl: ConfigServiceImpl
): ServiceImpl<typeof ConfigService> {
  return {
    async getConfig(req: GetConfigRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.getConfig({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async setConfig(req: SetConfigRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.setConfig({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async listKeys(req: ListKeysRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.listKeys({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    // Bridge the push-based gRPC subscriber model to an async generator
    // so Connect-RPC server-streaming works correctly on the HTTP port.
    async *watchConfig(req: WatchConfigRequest, ctx: HandlerContext) {
      const queue: any[] = [];
      let resolveWait: (() => void) | null = null;

      const call = {
        request: req,
        write(snap: any) {
          queue.push(snap);
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        },
        on(event: string, handler: () => void) {
          if (event === 'cancelled' || event === 'error') {
            ctx.signal.addEventListener('abort', handler, { once: true });
          }
        },
      };

      impl.watchConfig(call);

      while (!ctx.signal.aborted) {
        if (queue.length > 0) {
          yield queue.shift();
        } else {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
            ctx.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      }
    },
  };
}
