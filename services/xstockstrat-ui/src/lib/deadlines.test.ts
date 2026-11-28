// C-12: timings are scenario one-offs; no domain object.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { raceDeadline } from './deadlines';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('rejects once ms elapse and clears its timer', async () => {
  const p = raceDeadline(new Promise<never>(() => {}), 1_000);
  const settled = expect(p).rejects.toThrow('deadline exceeded');
  await vi.advanceTimersByTimeAsync(999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await settled;
  expect(vi.getTimerCount()).toBe(0);
});

test('resolves with the value when the promise settles first and clears its timer', async () => {
  await expect(raceDeadline(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
  expect(vi.getTimerCount()).toBe(0);
});

test('passes an earlier rejection through and clears its timer', async () => {
  await expect(raceDeadline(Promise.reject(new Error('boom')), 1_000)).rejects.toThrow('boom');
  expect(vi.getTimerCount()).toBe(0);
});
