import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADER_USER_ID } from '@/lib/headers';
import { TEST_JWT_SECRET, signTestJwt } from '../../e2e/helpers/auth';
import { TEST_USER_ID } from '../../e2e/fixtures/users';

const setConfig = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  configClient: { setConfig },
  ingestClient: {},
  analysisClient: {},
  identityClient: {},
  indicatorsClient: {},
}));

const { dispatchConnect } = await import('@/lib/configUiBff');

let cookie = '';

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  cookie = `access_token=${await signTestJwt(['admin'])}`;
});

beforeEach(() => {
  setConfig.mockReset().mockResolvedValue({});
});

describe('config-ui BFF SetConfig — attribution', () => {
  it('sends the session identity as x-user-id and no author', async () => {
    const res = await dispatchConnect(
      new Request('http://localhost/config-ui/api/xstockstrat.config.v1.ConfigService/SetConfig', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          namespace: 'notify',
          key: 'notify.push.min_severity',
          value: { intVal: 3 },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(setConfig).toHaveBeenCalledTimes(1);
    const [sent, opts] = setConfig.mock.calls[0] as [{ author: string }, { headers: Headers }];
    expect(sent.author).toBe('');
    expect(opts.headers.get(HEADER_USER_ID)).toBe(TEST_USER_ID);
  });
});
