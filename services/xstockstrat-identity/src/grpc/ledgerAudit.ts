/**
 * Identity's outbound per-request gRPC caller (C-03/PLAT-4): forwards x-user-id/x-access-scope/
 * x-trace-id from inbound metadata (x-trace-id → correlation_id). Best-effort: append() swallows
 * every error and never rolls back the mutation; payload is a safe-field allow-list, never the request.
 */
import * as grpc from '@grpc/grpc-js';
import { LedgerServiceClient } from '@xstockstrat/proto/ledger/v1/ledger';
import { getLogger } from '../services/logger';
import { first } from './authz';

const log = getLogger('identity:audit');

const PROPAGATED_HEADERS = ['x-user-id', 'x-access-scope', 'x-trace-id'] as const;

export interface LedgerAudit {
  append(
    eventType: string,
    targetUserId: string,
    callMetadata: grpc.Metadata | undefined,
    safePayload: Record<string, unknown>,
  ): Promise<void>;
}

/** A no-op audit sink for servicers constructed without an audit client. */
export const NOOP_LEDGER_AUDIT: LedgerAudit = {
  async append() {
    /* no-op */
  },
};

export function createLedgerAudit(
  endpoint: string = process.env.LEDGER_ENDPOINT ?? 'xstockstrat-ledger:50057',
): LedgerAudit {
  const client = new LedgerServiceClient(endpoint, grpc.credentials.createInsecure());
  return {
    async append(eventType, targetUserId, callMetadata, safePayload) {
      try {
        const traceId = first(callMetadata, 'x-trace-id');
        const outMd = new grpc.Metadata();
        for (const h of PROPAGATED_HEADERS) {
          const v = first(callMetadata, h);
          if (v) outMd.set(h, v);
        }
        const req = {
          eventType,
          sourceService: 'xstockstrat-identity',
          streamKey: `user:${targetUserId}`,
          correlationId: traceId,
          payload: safePayload, // ts-proto Struct field accepts a plain JSON object
          // Stable across retries for dedup when a trace id is present; empty otherwise. NOT
          // derived from Date.now(), which would defeat dedup on retry.
          idempotencyKey: traceId ? `${eventType}:${targetUserId}:${traceId}` : '',
        };
        await new Promise<void>((resolve, reject) => {
          client.appendEvent(req as never, outMd, (err: grpc.ServiceError | null) =>
            err ? reject(err) : resolve(),
          );
        });
      } catch (err) {
        log.error('ledger audit append failed (best-effort)', {
          eventType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
