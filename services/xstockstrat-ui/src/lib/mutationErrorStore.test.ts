import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearMutationError,
  getMutationError,
  getServerMutationError,
  reportMutationError,
  shouldReportMutationError,
  subscribeMutationError,
} from './mutationErrorStore';

describe('mutationErrorStore', () => {
  beforeEach(clearMutationError);

  it('keeps only the newest report in the single slot', () => {
    reportMutationError('first');
    reportMutationError('second');
    expect(getMutationError()).toEqual({ message: 'second' });
  });

  it('clearMutationError empties the slot and listeners fire on report and clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMutationError(listener);
    reportMutationError('boom');
    expect(listener).toHaveBeenCalledTimes(1);
    clearMutationError();
    expect(getMutationError()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    reportMutationError('after unsubscribe');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('getServerMutationError returns null', () => {
    reportMutationError('client only');
    expect(getServerMutationError()).toBeNull();
  });

  it('shouldReportMutationError opts out only on errorHandled === true', () => {
    expect(shouldReportMutationError(undefined)).toBe(true);
    expect(shouldReportMutationError({})).toBe(true);
    expect(shouldReportMutationError({ errorHandled: true })).toBe(false);
    expect(shouldReportMutationError({ errorHandled: 'yes' })).toBe(true);
  });
});
