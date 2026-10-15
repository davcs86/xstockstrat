import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';

const received: { path: string; auth: string | undefined }[] = [];
let traceRequests = 0;
const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (!req.url?.endsWith('/v1/traces')) {
      res.writeHead(404).end();
      return;
    }
    received.push({ path: req.url, auth: req.headers.authorization });
    // First trace export succeeds (AC-1); later ones are rejected (AC-3).
    res.writeHead(traceRequests++ === 0 ? 200 : 400).end();
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
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}/otlp`;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic dGVzdDprZXk=';
  process.env.OTEL_BSP_SCHEDULE_DELAY = '50';
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

// Feature 226 AC-1 (raw header form): exports to <endpoint>/v1/traces with the Authorization header.
test('exports a span over OTLP/HTTP to <endpoint>/v1/traces', async () => {
  endSpan('ac-1');
  expect(await waitFor(() => received.length > 0)).toBe(true);
  expect(received[0]).toEqual({ path: '/otlp/v1/traces', auth: 'Basic dGVzdDprZXk=' });
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
