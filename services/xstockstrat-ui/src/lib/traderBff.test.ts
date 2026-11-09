import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';
import type { GetConfigRequest } from '@xstockstrat/proto/config/v1/config_pb';
import { PLATFORM_TRADING_STATE_VALUES } from '../../e2e/fixtures/configKeys';

const getConfig = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  tradingClient: {},
  portfolioClient: {},
  marketDataClient: {},
  notifyClient: {},
  analysisClient: {},
  ledgerClient: {},
  configClient: { getConfig },
}));

const { dispatchConnect } = await import('@/lib/traderBff');

const GET_CONFIG = 'xstockstrat.config.v1.ConfigService/GetConfig';
const savedAppEnv = process.env.APPLICATION_ENV;
let cookie = '';

beforeAll(async () => {
  process.env.JWT_SECRET = 'trader-bff-test-secret';
  const token = await new SignJWT({ user_id: 'user-alice', email: 'a@x.io', roles: ['trader'] })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  cookie = `access_token=${token}`;
});

beforeEach(() => {
  process.env.APPLICATION_ENV = 'production';
  getConfig.mockReset().mockImplementation(async (req: GetConfigRequest) => ({
    namespace: 'platform',
    version: '1',
    values: PLATFORM_TRADING_STATE_VALUES.init(
      req.environment === Environment.PRODUCTION ? 'HALTED' : 'ACTIVE',
    ),
  }));
});

afterEach(() => {
  process.env.APPLICATION_ENV = savedAppEnv;
});

describe('trader BFF ConfigService.GetConfig — native environment', () => {
  it('sends the deployment environment so a production read sees production rows', async () => {
    const res = await dispatchConnect(
      new Request(`http://localhost/trader/api/${GET_CONFIG}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ namespace: 'platform' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(getConfig.mock.calls[0][0].environment).toBe(Environment.PRODUCTION);
    const body = (await res.json()) as { values: Record<string, { stringVal?: string }> };
    expect(body.values['trading_state'].stringVal).toBe('HALTED');
  });
});
