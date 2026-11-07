/**
 * Feature 294 — BFF auth and audit signals: @AC-33 (failed login), @AC-35 (audit refusal and
 * missing DATABASE_URL warnings), @AC-55 (audit read joins `http.server.duration`).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { Code, ConnectError } from '@connectrpc/connect';
import { NextRequest } from 'next/server';
import { TEST_USER_B_EMAIL, TEST_USER_ID } from '../../../e2e/fixtures/users';

const authenticateUser = vi.fn();
const getSessionFromRequest = vi.fn();
const hasAdminScope = vi.fn();
const query = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  identityClient: { authenticateUser: (...a: unknown[]) => authenticateUser(...a) },
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getSessionFromRequest: (...a: unknown[]) => getSessionFromRequest(...a),
  hasAdminScope: (...a: unknown[]) => hasAdminScope(...a),
}));
vi.mock('pg', () => ({
  Pool: class {
    query = (...a: unknown[]) => query(...a);
  },
}));

import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as auditGET } from '@/app/config-ui/api/audit/route';
import { serverLog } from '@/lib/serverLog';
import { HEADER_TRACE_ID } from '@/lib/headers';

class CollectingReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
}
const reader = new CollectingReader();

type Point = { attributes: Record<string, string | number>; value: unknown };

async function points(name: string): Promise<Point[]> {
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.descriptor.name === name)
    .flatMap((m) => m.dataPoints as unknown as Point[]);
}

const withLabels = async (name: string, match: Record<string, string | number>) =>
  (await points(name)).filter((p) =>
    Object.entries(match).every(([k, v]) => p.attributes[k] === v),
  );

const ADMIN = { user_id: TEST_USER_ID, roles: ['admin'] };
const auditRequest = (query = '') =>
  new NextRequest(`http://localhost/config-ui/api/audit${query}`, {
    headers: { [HEADER_TRACE_ID]: 'trace-ac' },
  });

beforeAll(() => {
  expect(metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }))).toBe(true);
});

beforeEach(() => {
  vi.spyOn(serverLog, 'info').mockImplementation(() => {});
  vi.spyOn(serverLog, 'warn').mockImplementation(() => {});
  vi.spyOn(serverLog, 'error').mockImplementation(() => {});
  getSessionFromRequest.mockReset().mockResolvedValue(ADMIN);
  hasAdminScope.mockReset().mockReturnValue(true);
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('login (feature 294)', () => {
  it('@AC-33 counts login_failed, times the route and logs no credential', async () => {
    const password = 'not-the-password';
    authenticateUser.mockReset().mockRejectedValue(new ConnectError('no', Code.Unauthenticated));
    const res = await loginPOST(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: TEST_USER_B_EMAIL, password }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid credentials' });

    const failed = await withLabels('ui.auth.events', { event: 'login_failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0].value).toBe(1);
    expect(
      await withLabels('http.server.duration', {
        'xstk.segment': 'auth',
        'http.route': '/api/auth/login',
        'http.response.status_code': 401,
      }),
    ).toHaveLength(1);

    const logged = JSON.stringify(
      ['info', 'warn', 'error'].flatMap((l) => vi.mocked(serverLog[l as 'warn']).mock.calls),
    );
    const labels = JSON.stringify([
      ...(await points('ui.auth.events')),
      ...(await points('http.server.duration')),
    ]);
    for (const secret of [TEST_USER_B_EMAIL, password]) {
      expect(logged).not.toContain(secret);
      expect(labels).not.toContain(secret);
    }
  });
});

describe('config-ui audit (feature 294)', () => {
  it('@AC-35 warns and returns 403 for a non-admin session', async () => {
    hasAdminScope.mockReturnValue(false);
    const res = await auditGET(auditRequest());
    expect(res.status).toBe(403);
    expect(serverLog.warn).toHaveBeenCalledWith('config-ui audit: non-admin request refused', {
      traceId: 'trace-ac',
    });
  });

  it('@AC-35 warns and still returns 200 {entries: []} when DATABASE_URL is unset', async () => {
    const res = await auditGET(auditRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
    expect(serverLog.warn).toHaveBeenCalledWith(
      'config-ui audit: DATABASE_URL unset, returning no entries',
      { traceId: 'trace-ac' },
    );
  });

  it('@AC-55 records the audit read on http.server.duration with the body unchanged', async () => {
    process.env.DATABASE_URL = 'postgres://audit@localhost:5432/xstockstrat?sslmode=disable';
    const row = {
      id: 7,
      namespace: 'ui',
      key: 'ui.theme.default',
      old_value: 'light',
      new_value: 'dark',
      changed_by: TEST_USER_ID,
      reason: 'test',
      changed_at: '2026-11-06T00:00:00.000Z',
      environment: 'staging',
      user_id: null,
    };
    query
      .mockReset()
      .mockImplementation(() => new Promise((r) => setTimeout(() => r({ rows: [row] }), 80)));
    const audit200 = {
      'xstk.segment': 'config-ui',
      'http.route': '/config-ui/api/audit',
      'http.response.status_code': 200,
    };
    const countOf = async () =>
      ((await withLabels('http.server.duration', audit200))[0]?.value as { count: number })
        ?.count ?? 0;
    const before = await countOf();
    const res = await auditGET(auditRequest('?limit=50'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        {
          id: '7',
          namespace: 'ui',
          key: 'ui.theme.default',
          oldValue: 'light',
          newValue: 'dark',
          changedBy: TEST_USER_ID,
          reason: 'test',
          changedAt: '2026-11-06T00:00:00.000Z',
          environment: 'staging',
          userId: '',
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1'), [50]);
    expect(await countOf()).toBe(before + 1);
    const [hit] = await withLabels('http.server.duration', audit200);
    expect((hit.value as { max: number }).max).toBeGreaterThanOrEqual(75);
  });
});
