import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import type {
  AcknowledgeAlertRequest,
  EmitAlertRequest,
  ListAlertsRequest,
  StreamAlertsRequest,
} from '@xstockstrat/proto/notify/v1/notify_pb';
import { NotifyServiceImpl } from '../grpc/notifyServiceImpl';

// The shared impl returns `Date` instances for Timestamp fields (the shape
// ts-proto's grpc-js serializer requires). protobuf-es, used by the Connect
// HTTP path, expects `google.protobuf.Timestamp` messages instead, so deep-walk
// the response and convert any Date before it reaches the Connect framework.
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

export function createNotifyServiceConnectImpl(
  impl: NotifyServiceImpl
): ServiceImpl<typeof NotifyService> {
  return {
    async emitAlert(req: EmitAlertRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.emitAlert({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async acknowledgeAlert(req: AcknowledgeAlertRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.acknowledgeAlert({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async listAlerts(req: ListAlertsRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.listAlerts({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    // Bridge the push-based gRPC subscriber model to an async generator
    // so Connect-RPC server-streaming works correctly on the HTTP port.
    async *streamAlerts(req: StreamAlertsRequest, ctx: HandlerContext) {
      const queue: any[] = [];
      let resolveWait: (() => void) | null = null;

      const call = {
        request: req,
        write(alert: any) {
          queue.push(alert);
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

      impl.streamAlerts(call);

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
