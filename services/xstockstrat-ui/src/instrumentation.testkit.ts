// Shared OTLP export assertions. OTel globals are set once per process and vitest isolates test
// files, so each header form runs as its own file calling defineExportSuite().
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';

const AUTH = 'Basic dGVzdDprZXk=';

type Received = { path: string; auth: string | undefined; body: string };

export function defineExportSuite(headers: string) {
  const received: Received[] = [];
  let traceRequests = 0;
  const at = (suffix: string) => received.filter((r) => r.path.endsWith(suffix));
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (req.url?.endsWith('/v1/traces')) {
        // First trace export succeeds (AC-1); later ones are rejected (AC-3).
        res.writeHead(traceRequests++ === 0 ? 200 : 400).end();
      } else if (req.url?.endsWith('/v1/metrics') || req.url?.endsWith('/v1/logs')) {
        res.writeHead(200).end('{}');
      } else {
        res.writeHead(404).end();
      }
    });
  });

  // Plain recorders, not vi.spyOn: vitest clears spy call history before each test, which would
  // drop the calls made in beforeAll. Installed before OTel loads (DiagConsoleLogger binds at load).
  const original = { error: console.error, warn: console.warn, info: console.info };
  const calls: Record<keyof typeof original, string[]> = { error: [], warn: [], info: [] };
  for (const level of Object.keys(original) as (keyof typeof original)[]) {
    console[level] = (...args: unknown[]) => {
      calls[level].push(args.map(String).join(' '));
    };
  }
  let endSpan: (name: string) => void;

  const initFailed = () => calls.warn.some((m) => m.includes('[otel] init failed'));

  async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return cond();
  }

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.OTEL_ENABLED = 'true';
    process.env.SERVICE_NAME = 'ui';
    process.env.APPLICATION_ENV = 'staging';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}/otlp`;
    process.env.OTEL_EXPORTER_OTLP_HEADERS = headers;
    process.env.OTEL_BSP_SCHEDULE_DELAY = '50';
    process.env.OTEL_BLRP_SCHEDULE_DELAY = '50';
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '100';
    delete process.env.OTEL_LOG_LEVEL;
    const { register } = await import('./instrumentation');
    await register();
    const { trace } = await import('@opentelemetry/api');
    endSpan = (name) => trace.getTracer('t').startSpan(name).end();
  });

  afterAll(() => {
    Object.assign(console, original);
    server.closeAllConnections();
    server.close();
  });

  // Feature 226 AC-2: Next.js loads instrumentation only from src/ in a src/ project.
  test('the instrumentation hook lives in src/ and registers telemetry', () => {
    expect(existsSync(new URL('./instrumentation.ts', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../instrumentation.ts', import.meta.url))).toBe(false);
    expect(calls.info.some((m) => m.includes('[otel] tracing enabled'))).toBe(true);
    expect(initFailed()).toBe(false);
  });

  // Feature 226 AC-1: exports to <endpoint>/v1/traces with the Authorization header (traces kept).
  test('exports a span over OTLP/HTTP to <endpoint>/v1/traces', async () => {
    endSpan('ac-1');
    expect(await waitFor(() => at('/v1/traces').length > 0)).toBe(true);
    expect({ path: at('/v1/traces')[0].path, auth: at('/v1/traces')[0].auth }).toEqual({
      path: '/otlp/v1/traces',
      auth: AUTH,
    });
    expect(initFailed()).toBe(false);
  });

  // Feature 226 AC-3: a rejected export is logged through the WARN diag logger.
  test('logs a rejected export', async () => {
    endSpan('ac-3');
    const rejected = () =>
      calls.error.some((m) => m.includes('OTLPExporterError') && m.includes('400'));
    expect(await waitFor(rejected)).toBe(true);
    expect(initFailed()).toBe(false);
  });

  // AC-19 + AC-10 (ui row).
  test('exports a recorded counter to /otlp/v1/metrics with auth and the resource trio', async () => {
    const { metrics } = await import('@opentelemetry/api');
    metrics.getMeter('t').createCounter('t.count').add(1);
    expect(await waitFor(() => at('/v1/metrics').length > 0)).toBe(true);
    const req = at('/v1/metrics')[0];
    expect(req.path).toBe('/otlp/v1/metrics');
    expect(req.auth).toBe(AUTH);
    const attrs = Object.fromEntries(
      JSON.parse(req.body).resourceMetrics[0].resource.attributes.map(
        (a: { key: string; value: { stringValue?: string } }) => [a.key, a.value.stringValue],
      ),
    );
    expect(attrs['service.name']).toBe('ui');
    expect(attrs['deployment.environment']).toBe('staging');
    expect(attrs['platform']).toBe('xstockstrat');
    expect('trading_mode' in attrs).toBe(false);
  });

  // AC-19 + AC-11 (ui row): a serverLog line exports under WARN, correlated to the active span.
  test('serverLog.warn inside an active span exports WARN severity with the span trace id', async () => {
    const { trace } = await import('@opentelemetry/api');
    const { serverLog } = await import('@/lib/serverLog');
    let traceId = '';
    trace.getTracer('t').startActiveSpan('s', (span) => {
      traceId = span.spanContext().traceId;
      serverLog.warn('correlated-line', { route: 'x' });
      span.end();
    });
    const has = (r: Received) => r.body.includes('correlated-line');
    expect(await waitFor(() => at('/v1/logs').some(has))).toBe(true);
    const req = at('/v1/logs').find(has)!;
    expect(req.path).toBe('/otlp/v1/logs');
    expect(req.auth).toBe(AUTH);
    const records = at('/v1/logs')
      .filter(has)
      .flatMap((r) => JSON.parse(r.body).resourceLogs)
      .flatMap((rl: { scopeLogs: unknown[] }) => rl.scopeLogs)
      .flatMap((sl) => (sl as { logRecords: unknown[] }).logRecords)
      .filter((l) => JSON.stringify(l).includes('correlated-line')) as {
      traceId: string;
      severityNumber: number;
    }[];
    expect(records).toHaveLength(1);
    expect(records[0].traceId).toBe(traceId);
    expect(records[0].severityNumber).toBe(13);
  });

  // Recursion guard: telemetry's own console lines and diag failures never become log records.
  test("telemetry's own console output never reaches /v1/logs", async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const r of at('/v1/logs')) {
      expect(r.body).not.toContain('[otel] tracing enabled');
      expect(r.body).not.toContain('OTLPExporterError');
    }
  });
}
