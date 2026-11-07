import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
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

class CollectingReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
}

describe('refreshSession — auth events (feature 294)', () => {
  it('@AC-34 counts refresh_error on DeadlineExceeded and still returns null', async () => {
    const reader = new CollectingReader();
    metrics.disable();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    refreshToken.mockReset().mockRejectedValue(new ConnectError('deadline', Code.DeadlineExceeded));

    await expect(refreshSession('rt')).resolves.toBeNull();

    const { resourceMetrics } = await reader.collect();
    const events = resourceMetrics.scopeMetrics
      .flatMap((sm) => sm.metrics)
      .filter((m) => m.descriptor.name === 'ui.auth.events')
      .flatMap((m) => m.dataPoints as { attributes: unknown; value: unknown }[]);
    expect(events.map((p) => [p.attributes, p.value])).toEqual([[{ event: 'refresh_error' }, 1]]);
  });
});
