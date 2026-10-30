import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { HEADER_TRACE_ID } from '@/lib/headers';

vi.mock('@/lib/auth', () => ({
  getSessionFromRequest: vi.fn(async () => ({ roles: ['admin'] })),
  hasAdminScope: vi.fn(() => true),
}));

const { Pool, query } = vi.hoisted(() => {
  const query = vi.fn();
  const Pool = vi.fn<(this: { query: typeof query }, opts: Record<string, unknown>) => void>(
    function () {
      this.query = query;
    },
  );
  return { Pool, query };
});
vi.mock('pg', () => ({ Pool }));

const TLS_URL = 'postgres://u:p@db.example:25060/xstockstrat?sslmode=require';
const PLAIN_URL = 'postgres://xstockstrat:pw@timescaledb:5432/xstockstrat?sslmode=disable';
const CA = '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----\n';

function auditRequest(): NextRequest {
  return new NextRequest('http://localhost/config-ui/api/audit', {
    headers: { [HEADER_TRACE_ID]: 't-266' },
  });
}

async function callGet(): Promise<Response> {
  const { GET } = await import('./route');
  return GET(auditRequest());
}

describe('config-ui audit route DB TLS (feature 266)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    Pool.mockClear();
    query.mockReset();
    vi.stubEnv('DATABASE_CA_CERT', '');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('AC-4: refuses to query over TLS without DATABASE_CA_CERT and returns a generic 500', async () => {
    vi.stubEnv('DATABASE_URL', TLS_URL);

    const res = await callGet();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Audit log unavailable' });
    expect(Pool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0][1] as { traceId: string; message: string };
    expect(logged.traceId).toBe('t-266');
    expect(logged.message).toContain('DATABASE_CA_CERT');
  });

  it('AC-7: verifies against the configured CA and never echoes the pg error to the client', async () => {
    vi.stubEnv('DATABASE_URL', TLS_URL);
    vi.stubEnv('DATABASE_CA_CERT', CA);
    query.mockRejectedValue(
      Object.assign(new Error('self-signed certificate in certificate chain'), {
        code: 'SELF_SIGNED_CERT_IN_CHAIN',
      }),
    );

    const res = await callGet();

    expect(Pool).toHaveBeenCalledTimes(1);
    expect(Pool.mock.calls[0][0].ssl).toEqual({ rejectUnauthorized: true, ca: CA });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('self-signed');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toMatchObject({
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
      traceId: 't-266',
    });
  });

  it('AC-8: reads the audit log in plaintext with sslmode=disable and no CA', async () => {
    vi.stubEnv('DATABASE_URL', PLAIN_URL);
    query.mockResolvedValue({ rows: [] });

    const res = await callGet();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(Pool.mock.calls[0][0]).toMatchObject({ ssl: false, connectionString: PLAIN_URL });
  });

  it('returns no entries and builds no pool when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const res = await callGet();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
    expect(Pool).not.toHaveBeenCalled();
  });
});
