import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';
import { HEADER_USER_ID } from '@/lib/headers';

const setConfig = vi.fn();
const manageSignalSource = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  analysisClient: {},
  indicatorsClient: {},
  ingestClient: { manageSignalSource },
  marketDataClient: {},
  portfolioClient: {},
  tradingClient: {},
  ledgerClient: {},
  configClient: { setConfig },
}));

const { dispatchConnect } = await import('@/lib/insightsBff');

const SESSION_USER = 'user-alice';
const OPAQUE_KEY = 'mcp_credential.3f1c2a54-9d8e-4b7a-a1f0-2c6d5e4b3a21';
let cookie = '';

beforeAll(async () => {
  process.env.JWT_SECRET = 'insights-bff-test-secret';
  const token = await new SignJWT({ user_id: SESSION_USER, email: 'a@x.io', roles: ['trader'] })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  cookie = `access_token=${token}`;
});

beforeEach(() => {
  setConfig.mockReset().mockResolvedValue({});
  manageSignalSource.mockReset().mockResolvedValue({});
});

function post(method: string, body: unknown): Promise<Response> {
  return dispatchConnect(
    new Request(`http://localhost/insights/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    }),
  );
}

const SET_CONFIG = 'xstockstrat.config.v1.ConfigService/SetConfig';

describe('insights BFF SetConfig — per-user mcp bearer secret', () => {
  it('forces isSecret, createKey, the session user and the native environment', async () => {
    const res = await post(SET_CONFIG, {
      namespace: 'ingest',
      key: OPAQUE_KEY,
      value: { stringVal: 'bearer-xyz', isSecret: false },
      createKey: false,
      userId: 'user-mallory',
      author: 'user-mallory',
      environment: 'ENVIRONMENT_PRODUCTION',
    });
    expect(res.status).toBe(200);
    expect(setConfig).toHaveBeenCalledTimes(1);
    const sent = setConfig.mock.calls[0][0];
    expect(sent.value.isSecret).toBe(true);
    expect(sent.value.value).toEqual({ case: 'stringVal', value: 'bearer-xyz' });
    expect(sent.createKey).toBe(true);
    expect(sent.userId).toBe(SESSION_USER);
    expect(sent.author).toBe(SESSION_USER);
    expect(sent.environment).toBe(Environment.STAGING);
  });

  it.each([
    ['a non-ingest namespace', { namespace: 'config', key: OPAQUE_KEY }],
    ['a key outside mcp_credential.', { namespace: 'ingest', key: 'poller.interval_seconds' }],
  ])('rejects %s without calling the backend', async (_label, target) => {
    const res = await post(SET_CONFIG, { ...target, value: { stringVal: 'v' } });
    expect(res.status).toBe(403);
    expect(setConfig).not.toHaveBeenCalled();
  });
});

describe('insights BFF IngestService.ManageSignalSource', () => {
  it('is registered and forwards with the session identity headers', async () => {
    const res = await post('xstockstrat.ingest.v1.IngestService/ManageSignalSource', {
      operation: 'update',
      source: { slug: 'mine', reliabilityWeight: 0.5 },
    });
    expect(res.status).toBe(200);
    expect(manageSignalSource).toHaveBeenCalledTimes(1);
    const opts = manageSignalSource.mock.calls[0][1] as { headers: Headers };
    expect(opts.headers.get(HEADER_USER_ID)).toBe(SESSION_USER);
  });
});
