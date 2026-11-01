import { Code, ConnectError } from '@connectrpc/connect';

export const STREAM_STABLE_MS = 3_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

export function nextBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

// Unauthenticated is retryable: guardStream (transport.ts) refreshes the session and rethrows, and
// the stream only recovers on the next reconnect.
const RETRYABLE_CODES = new Set<Code>([
  Code.Unavailable,
  Code.Unknown,
  Code.Internal,
  Code.DeadlineExceeded,
  Code.ResourceExhausted,
  Code.Aborted,
  Code.Canceled,
  Code.Unauthenticated,
]);

export function isRetryableStreamError(err: unknown): boolean {
  if (!(err instanceof ConnectError)) return true;
  return RETRYABLE_CODES.has(err.code);
}
