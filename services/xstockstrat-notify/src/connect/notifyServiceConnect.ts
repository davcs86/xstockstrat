import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { NotifyService } from '@xstockstrat/proto/notify/v1/notify_pb';
import type {
  AcknowledgeAlertRequest,
  EmitAlertRequest,
  ListAlertsRequest,
  StreamAlertsRequest,
} from '@xstockstrat/proto/notify/v1/notify_pb';
import { NotifyServiceImpl } from '../grpc/notifyServiceImpl';

export function createNotifyServiceConnectImpl(
  impl: NotifyServiceImpl
): ServiceImpl<typeof NotifyService> {
  return {
    async emitAlert(req: EmitAlertRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.emitAlert({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async acknowledgeAlert(req: AcknowledgeAlertRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.acknowledgeAlert({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async listAlerts(req: ListAlertsRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.listAlerts({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
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
