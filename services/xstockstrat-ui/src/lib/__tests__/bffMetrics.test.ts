/**
 * Feature 274 @AC-16 — `http.server.duration` for the BFF seams: unary Connect and REST handlers are
 * recorded, server streams are not, unmatched paths and throwing handlers are.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { BROKER_ACCOUNT_ALPACA } from '../../../e2e/fixtures/accounts';

vi.mock('@/lib/auth', () => ({
  verifyAccessToken: vi.fn(async () => ({
    user_id: 'u-a',
    roles: ['trader'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
  rolesToAccessScope: vi.fn(() => 7),
  generateTraceId: vi.fn(() => 'trace-test'),
  hasAdminScope: vi.fn(() => false),
  getSessionFromRequest: vi.fn(async () => ({ user_id: 'u-a', roles: ['trader'] })),
}));

const listBrokerAccounts = vi.fn();
const streamAlerts = vi.fn();
const getUserMetadata = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  tradingClient: { listBrokerAccounts: (...a: unknown[]) => listBrokerAccounts(...a) },
  notifyClient: { streamAlerts: (...a: unknown[]) => streamAlerts(...a) },
  identityClient: { getUserMetadata: (...a: unknown[]) => getUserMetadata(...a) },
  connectCodeToHttp: () => 500,
  ledgerClient: {},
  portfolioClient: {},
  marketDataClient: {},
  analysisClient: {},
  configClient: {},
}));

import { dispatchConnect } from '@/lib/traderBff';
import { createDispatch } from '@/lib/bffShared';
import { GET as profileGET } from '@/app/accounts/api/profile/route';
import { NextRequest } from 'next/server';

// sdk-metrics 2.x ships no in-memory reader; a bare MetricReader exposes collect().
class CollectingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
const reader = new CollectingReader();

type Point = { attributes: Record<string, string | number> };

async function points(): Promise<Point[]> {
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.descriptor.name === 'http.server.duration')
    .flatMap((m) => m.dataPoints as unknown as Point[]);
}

const withLabels = async (match: Record<string, string | number>) =>
  (await points()).filter((p) => Object.entries(match).every(([k, v]) => p.attributes[k] === v));

beforeAll(() => {
  expect(metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }))).toBe(true);
});

beforeEach(() => {
  listBrokerAccounts.mockReset().mockResolvedValue({ accounts: [BROKER_ACCOUNT_ALPACA] });
  getUserMetadata.mockReset().mockResolvedValue({ userMetadata: { userId: 'u-a' } });
});

function unary(path: string): Request {
  return new Request(`http://localhost/trader/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'access_token=t' },
    body: '{}',
  });
}

describe('http.server.duration (feature 274)', () => {
  it('records a unary Connect call with segment, service typeName and status', async () => {
    const res = await dispatchConnect(
      unary('xstockstrat.trading.v1.TradingService/ListBrokerAccounts'),
    );
    expect(res.status).toBe(200);
    const hit = await withLabels({
      'xstk.segment': 'trader',
      'rpc.service': 'xstockstrat.trading.v1.TradingService',
      'http.response.status_code': 200,
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].attributes['http.route']).toBeUndefined();
  });

  it('records a wrapped REST handler with its route template', async () => {
    const res = await profileGET(new NextRequest('http://localhost/accounts/api/profile'));
    expect(res.status).toBe(200);
    expect(
      await withLabels({
        'xstk.segment': 'accounts',
        'http.route': '/accounts/api/profile',
        'http.response.status_code': 200,
      }),
    ).toHaveLength(1);
  });

  it('records no point for a server-streaming method, while open or after release', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    streamAlerts.mockReset().mockImplementation(async function* () {
      yield { alert: { alertId: 'a-1' } };
      await gate;
    });
    const json = new TextEncoder().encode('{}');
    const envelope = new Uint8Array(5 + json.length);
    new DataView(envelope.buffer).setUint32(1, json.length);
    envelope.set(json, 5);
    const res = await dispatchConnect(
      new Request('http://localhost/trader/api/xstockstrat.notify.v1.NotifyService/StreamAlerts', {
        method: 'POST',
        headers: { 'content-type': 'application/connect+json', cookie: 'access_token=t' },
        body: envelope,
      }),
    );
    const bodyReader = res.body!.getReader();
    expect((await bodyReader.read()).done).toBe(false); // first message: the response has started
    const notify = { 'rpc.service': 'xstockstrat.notify.v1.NotifyService' };
    expect(await withLabels(notify)).toHaveLength(0);
    release();
    await bodyReader.cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect(await withLabels(notify)).toHaveLength(0);
  });

  it('records an unmatched path as rpc.service=unmatched with status 404', async () => {
    const res = await dispatchConnect(unary('xstockstrat.nope.v1.NopeService/Nothing'));
    expect(res.status).toBe(404);
    expect(
      await withLabels({
        'xstk.segment': 'trader',
        'rpc.service': 'unmatched',
        'http.response.status_code': 404,
      }),
    ).toHaveLength(1);
  });

  it('records a handler that throws, with status 500', async () => {
    const router = {
      handlers: [
        {
          requestPath: '/x.v1.Boom/Go',
          method: { methodKind: 'unary' },
          service: { typeName: 'x.v1.Boom' },
          async call() {},
        },
      ],
    };
    // The handler object itself is the callable; make it throw.
    const handler = Object.assign(async () => {
      throw new Error('boom');
    }, router.handlers[0]);
    const dispatch = createDispatch({ handlers: [handler] } as never, '/insights/api');
    await expect(
      dispatch(new Request('http://localhost/insights/api/x.v1.Boom/Go', { method: 'POST' })),
    ).rejects.toThrow('boom');
    expect(
      await withLabels({
        'xstk.segment': 'insights',
        'rpc.service': 'x.v1.Boom',
        'http.response.status_code': 500,
      }),
    ).toHaveLength(1);
  });
});
