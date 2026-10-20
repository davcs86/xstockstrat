import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';

// strip-types runs this file as ESM, which has no `require`; telemetry.ts lazy-requires its SDK.
(globalThis as { require?: NodeRequire }).require = createRequire(import.meta.url);
const TELEMETRY = '../telemetry.ts';

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

const errorSpy = mock.method(console, 'error', () => {});
const warnSpy = mock.method(console, 'warn', () => {});
mock.method(console, 'info', () => {});
let endSpan: (name: string) => void;

// Node runtime warnings ("(node:<pid>) …", e.g. MODULE_TYPELESS_PACKAGE_JSON under strip-types) are not OTel output.
const logged = (spy: typeof errorSpy) =>
  spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).filter((m) => !m.startsWith('(node:'));

async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}/otlp`;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic dGVzdDprZXk=';
  process.env.OTEL_BSP_SCHEDULE_DELAY = '50';
  delete process.env.OTEL_LOG_LEVEL;
  // OTel is first loaded here, after the console spies: DiagConsoleLogger binds console at load.
  const { initTelemetry } = await import(TELEMETRY);
  initTelemetry();
  const { trace } = await import('@opentelemetry/api');
  endSpan = (name) => trace.getTracer('t').startSpan(name).end();
});

after(() => {
  server.closeAllConnections();
  server.close();
});

// Feature 226 AC-1: configured only by the OTel spec env vars -> POST <path>/v1/traces with auth.
test('exports a span over OTLP/HTTP to <endpoint>/v1/traces with the Authorization header', async () => {
  endSpan('ac-1');
  assert.ok(await waitFor(() => received.length > 0), 'receiver got no /v1/traces request');
  assert.deepEqual(received[0], { path: '/otlp/v1/traces', auth: 'Basic dGVzdDprZXk=' });
  assert.deepEqual(logged(errorSpy), [], 'no diag error before the rejected export');
  assert.ok(!logged(warnSpy).some((m) => m.includes('[otel] init failed')));
});

// Feature 226 AC-3: a rejected export is logged through the WARN diag logger.
test('logs a rejected export', async () => {
  endSpan('ac-3');
  const rejected = () => logged(errorSpy).some((m) => m.includes('OTLPExporterError') && m.includes('400'));
  assert.ok(await waitFor(rejected), `no logged 400 export failure; console.error: ${logged(errorSpy)}`);
  assert.ok(!logged(warnSpy).some((m) => m.includes('[otel] init failed')));
});
