import { describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { isRetryableStreamError, nextBackoffMs } from './streamBackoff';

describe('nextBackoffMs', () => {
  it('doubles from 1s and caps at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(nextBackoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe('isRetryableStreamError', () => {
  it('retries a network TypeError', () => {
    expect(isRetryableStreamError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it.each([
    Code.Unavailable,
    Code.Unknown,
    Code.Internal,
    Code.DeadlineExceeded,
    Code.Unauthenticated,
  ])('retries ConnectError code %s', (code) => {
    expect(isRetryableStreamError(new ConnectError('stream dropped', code))).toBe(true);
  });

  it.each([Code.PermissionDenied, Code.InvalidArgument, Code.Unimplemented])(
    'stops on terminal ConnectError code %s',
    (code) => {
      expect(isRetryableStreamError(new ConnectError('stream refused', code))).toBe(false);
    },
  );
});
