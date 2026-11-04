import { describe, it, expect, beforeEach } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';
import { Code, ConnectError } from '@connectrpc/connect';
import { createQueryClient } from './queryClient';
import { clearMutationError, getMutationError } from './mutationErrorStore';

const rejectUnavailable = () => Promise.reject(new ConnectError('down', Code.Unavailable));

describe('createQueryClient MutationCache fallback (AC-10)', () => {
  beforeEach(clearMutationError);

  it('reports a failed mutation that has no onError', async () => {
    const observer = new MutationObserver(createQueryClient(), { mutationFn: rejectUnavailable });
    await observer.mutate(undefined).catch(() => {});
    expect(getMutationError()?.message).toBe('down');
  });

  it('does not report a mutation flagged meta.errorHandled', async () => {
    const observer = new MutationObserver(createQueryClient(), {
      mutationFn: rejectUnavailable,
      meta: { errorHandled: true },
    });
    await observer.mutate(undefined).catch(() => {});
    expect(getMutationError()).toBeNull();
  });

  // Pins TanStack v5: the MutationCache sees hook-level options only, never a per-call onError.
  it('still reports when only a per-call onError handles the failure', async () => {
    let perCallSaw = '';
    const observer = new MutationObserver(createQueryClient(), { mutationFn: rejectUnavailable });
    // Per-call callbacks fire only while the observer has a listener (as useMutation subscribes).
    const unsubscribe = observer.subscribe(() => {});
    await observer
      .mutate(undefined, { onError: (err) => (perCallSaw = (err as Error).message) })
      .catch(() => {});
    unsubscribe();
    expect(perCallSaw).toContain('down');
    expect(getMutationError()?.message).toBe('down');
  });
});
