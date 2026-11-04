import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { REFRESH_TIMEOUT_MS } from '@/lib/deadlines';

const refreshToken = vi.fn();
const revokeToken = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  identityClient: { refreshToken, revokeToken },
}));

const { refreshSession } = await import('@/lib/identity');

describe('refreshSession — bounded refresh deadline (feature 271 @AC-2)', () => {
  beforeEach(() => {
    refreshToken.mockReset();
  });

  it('calls identity RefreshToken with the REFRESH_TIMEOUT_MS deadline', async () => {
    refreshToken.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', claims: {} });

    await refreshSession('rt');

    expect(refreshToken).toHaveBeenCalledWith(
      { refreshToken: 'rt' },
      { timeoutMs: REFRESH_TIMEOUT_MS },
    );
  });

  it('fails closed (null) when the refresh deadline is exceeded', async () => {
    refreshToken.mockRejectedValue(new ConnectError('deadline', Code.DeadlineExceeded));

    await expect(refreshSession('rt')).resolves.toBeNull();
  });
});
