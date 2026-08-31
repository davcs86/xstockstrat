/**
 * Identity → ledger audit client (feature 043). Identity's first outbound per-request caller, so
 * C-03 binds it: the three propagation headers are read from the inbound call metadata and forwarded
 * on the outbound grpc-js call, and x-trace-id becomes the event correlation_id.
 *
 * Audit is BEST-EFFORT after the mutation commits (design R5): append() swallows every error (logs
 * it) and never throws back into the mutation path — a ledger outage never rolls back a user change.
 * The payload is built ONLY from an explicit safe-field allow-list passed by the caller — the request
 * (which carries the plaintext password) is never spread in (AC-8/AC-10).
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

/** A no-op audit sink so a servicer constructed without an audit client (unit tests) still works. */
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
          // Stable across retries when a trace/correlation id is present (dedups a re-sent audit);
          // empty when absent → the ledger treats it as a plain insert (fire-once best-effort). NOT
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
