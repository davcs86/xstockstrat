import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { ConfigService } from '@xstockstrat/proto/config/v1/config_pb';
import type {
  GetConfigRequest,
  ListKeysRequest,
  SetConfigRequest,
  WatchConfigRequest,
} from '@xstockstrat/proto/config/v1/config_pb';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';

// The impl returns `Date` instances for Timestamp fields (the shape ts-proto's
// grpc-js serializer requires). protobuf-es, used by the Connect HTTP path that
// config-ui calls, expects `google.protobuf.Timestamp` messages instead, so
// deep-walk the response and convert any Date before it reaches the framework.
function normalizeTimestamps(value: any): any {
  if (value instanceof Date) {
    return timestampFromDate(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeTimestamps);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = normalizeTimestamps(value[key]);
    }
    return out;
  }
  return value;
}

export function createConfigServiceConnectImpl(
  impl: ConfigServiceImpl
): ServiceImpl<typeof ConfigService> {
  return {
    async getConfig(req: GetConfigRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.getConfig({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async setConfig(req: SetConfigRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.setConfig({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async listKeys(req: ListKeysRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.listKeys({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
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
          yield normalizeTimestamps(queue.shift());
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
