import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import type {
  AppendEventRequest,
  GetEventRequest,
  QueryEventsRequest,
  StreamEventsRequest,
} from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { LedgerServiceImpl } from '../grpc/ledgerServiceImpl';

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

export function createLedgerServiceConnectImpl(
  impl: LedgerServiceImpl
): ServiceImpl<typeof LedgerService> {
  return {
    async appendEvent(req: AppendEventRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.appendEvent({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async queryEvents(req: QueryEventsRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.queryEvents({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async getEvent(req: GetEventRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.getEvent({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    // Bridge the push-based gRPC subscriber model to an async generator
    // so Connect-RPC server-streaming works correctly on the HTTP port.
    async *streamEvents(req: StreamEventsRequest, ctx: HandlerContext) {
      const queue: any[] = [];
      let resolveWait: (() => void) | null = null;

      const call = {
        request: req,
        write(event: any) {
          queue.push(event);
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

      impl.streamEvents(call);

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
