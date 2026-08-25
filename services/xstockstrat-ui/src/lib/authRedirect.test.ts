import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldRedirectToLogin, buildLoginRedirect, attemptRefresh } from './authRedirect';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldRedirectToLogin', () => {
  it('is false on the login page itself (loop guard, AC-7)', () => {
    expect(shouldRedirectToLogin('/auth/login')).toBe(false);
  });

  it('is true for any protected app path', () => {
    expect(shouldRedirectToLogin('/trader')).toBe(true);
    expect(shouldRedirectToLogin('/insights/opportunities')).toBe(true);
    expect(shouldRedirectToLogin('/config-ui')).toBe(true);
    expect(shouldRedirectToLogin('/accounts/profile')).toBe(true);
  });
});

describe('buildLoginRedirect', () => {
  it('encodes the current path + query as the redirect param (matches middleware shape)', () => {
    expect(buildLoginRedirect('/trader', '')).toBe('/auth/login?redirect=%2Ftrader');
    expect(buildLoginRedirect('/insights/market/AAPL', '?tab=risk')).toBe(
      '/auth/login?redirect=%2Finsights%2Fmarket%2FAAPL%3Ftab%3Drisk',
    );
  });
});

describe('attemptRefresh', () => {
  it('deduplicates concurrent calls into a single refresh POST', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const [a, b] = await Promise.all([attemptRefresh(), attemptRefresh()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', { method: 'POST' });
  });

  it('resolves false when the refresh POST is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
    expect(await attemptRefresh()).toBe(false);
  });

  it('resolves false when the refresh POST throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    expect(await attemptRefresh()).toBe(false);
  });
});
