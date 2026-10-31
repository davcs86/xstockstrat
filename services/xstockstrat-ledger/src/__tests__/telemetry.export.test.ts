import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const TELEMETRY = '../telemetry';
const LOGGER = '../services/logger';
const AUTH = 'Basic dGVzdDprZXk=';
const HEADER_FORMS = ['Authorization=Basic dGVzdDprZXk=', 'Authorization=Basic%20dGVzdDprZXk%3D'];
const SERVICE_DIR = join(__dirname, '..', '..');
const BUCKETS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

type Received = { path: string; auth: string | undefined; body: string };
const received: Received[] = [];
let traceRequests = 0;
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

const errorSpy = mock.method(console, 'error', () => {});
const warnSpy = mock.method(console, 'warn', () => {});
mock.method(console, 'info', () => {});
let endSpan: (name: string) => void;
let plainLogger: any;
let port = 0;

// Node runtime warnings ("(node:<pid>) …") are not OTel output.
const logged = (spy: typeof errorSpy) =>
  spy.mock.calls
    .map((c) => c.arguments.map(String).join(' '))
    .filter((m) => !m.startsWith('(node:'));

async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

const at = (suffix: string) => received.filter((r) => r.path.endsWith(suffix));

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}/otlp`;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = HEADER_FORMS[0];
  process.env.OTEL_BSP_SCHEDULE_DELAY = '50';
  process.env.OTEL_BLRP_SCHEDULE_DELAY = '50';
  process.env.OTEL_METRIC_EXPORT_INTERVAL = '100';
  delete process.env.OTEL_LOG_LEVEL;
  // OTel is first loaded here, after the console spies: DiagConsoleLogger binds console at load.
  const logger = await import(LOGGER);
  plainLogger = logger.getLogger('ledger'); // created before start: stdout only
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
  assert.ok(await waitFor(() => at('/v1/traces').length > 0), 'receiver got no /v1/traces request');
  assert.deepEqual(
    { path: at('/v1/traces')[0].path, auth: at('/v1/traces')[0].auth },
    { path: '/otlp/v1/traces', auth: AUTH },
  );
  assert.deepEqual(logged(errorSpy), [], 'no diag error before the rejected export');
  assert.ok(!logged(warnSpy).some((m) => m.includes('[otel] init failed')));
});

// Feature 226 AC-3: a rejected export is logged through the WARN diag logger.
test('logs a rejected export', async () => {
  endSpan('ac-3');
  const rejected = () =>
    logged(errorSpy).some((m) => m.includes('OTLPExporterError') && m.includes('400'));
  assert.ok(
    await waitFor(rejected),
    `no logged 400 export failure; console.error: ${logged(errorSpy)}`,
  );
  assert.ok(!logged(warnSpy).some((m) => m.includes('[otel] init failed')));
});

// AC-19 + AC-10 (ledger row).
test('exports a recorded counter to /otlp/v1/metrics with auth and the resource trio', async () => {
  const { metrics } = await import('@opentelemetry/api');
  metrics.getMeter('t').createCounter('t.count').add(1);
  assert.ok(
    await waitFor(() => at('/v1/metrics').length > 0),
    'receiver got no /v1/metrics request',
  );
  const req = at('/v1/metrics')[0];
  assert.equal(req.path, '/otlp/v1/metrics');
  assert.equal(req.auth, AUTH);
  const attrs = Object.fromEntries(
    JSON.parse(req.body).resourceMetrics[0].resource.attributes.map((a: any) => [
      a.key,
      a.value.stringValue,
    ]),
  );
  assert.equal(attrs['platform'], 'xstockstrat');
  assert.ok(attrs['service.name']);
  assert.ok(attrs['deployment.environment']);
  assert.equal('trading_mode' in attrs, false);
});

// AC-19 + AC-3: the winston record is exported, and the failure text never is.
test('bridges a winston record to /otlp/v1/logs, and exporter failures stay off it', async () => {
  const { getLogger } = await import(LOGGER);
  const logger = getLogger('ledger');
  logger.warn('bridge-me');
  assert.ok(
    await waitFor(() => at('/v1/logs').some((r) => r.body.includes('bridge-me'))),
    'receiver got no /v1/logs request carrying the winston record',
  );
  const first = at('/v1/logs').find((r) => r.body.includes('bridge-me'))!;
  assert.equal(first.path, '/otlp/v1/logs');
  assert.equal(first.auth, AUTH);
  endSpan('after-bridge'); // a further rejected trace export must not become a log record
  await waitFor(() => logged(errorSpy).filter((m) => m.includes('OTLPExporterError')).length > 1);
  await new Promise((r) => setTimeout(r, 300));
  for (const r of at('/v1/logs'))
    assert.ok(!r.body.includes('OTLPExporterError'), 'export failure leaked into logs');
});

// AC-4: the stdout line is byte-identical with and without the OTLP transport.
test('the stdout line is unchanged by the OTLP log transport', async () => {
  const { getLogger } = await import(LOGGER);
  const bridged = getLogger('ledger');
  assert.equal(plainLogger.transports.length, 1);
  assert.ok(bridged.transports.length > 1);
  const capture = (logger: any) => {
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      logger.info('event appended');
    } finally {
      process.stdout.write = original;
    }
    return lines;
  };
  const plain = capture(plainLogger);
  const withBridge = capture(bridged);
  assert.ok(plain.length > 0);
  assert.deepEqual(withBridge, plain);
});

type ChildResult = { stdout: string; code: number | null };

function runChild(
  code: string,
  headers: string,
  onLine?: (line: string) => void,
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd: SERVICE_DIR,
      env: {
        ...process.env,
        OTEL_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}/otlp`,
        OTEL_EXPORTER_OTLP_HEADERS: headers,
        OTEL_METRIC_EXPORT_INTERVAL: '600000',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1',
        TELEMETRY_JS: join(__dirname, '..', 'telemetry.js'),
        LOGGER_JS: join(__dirname, '..', 'services', 'logger.js'),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child timed out; stdout so far: ${stdout}`));
    }, 20000);
    child.stdout.on('data', (d) => {
      stdout += d;
      for (const line of String(d).split('\n')) if (line) onLine?.(line);
    });
    child.on('exit', (c) => {
      clearTimeout(timer);
      resolve({ stdout, code: c });
    });
  });
}

const FLUSH_CHILD = `
const t = require(process.env.TELEMETRY_JS);
t.initTelemetry();
const { metrics, trace } = require('@opentelemetry/api');
setTimeout(() => {
const c = metrics.getMeter('t').createCounter('t.flush');
c.add(1); c.add(1);
const log = require(process.env.LOGGER_JS).getLogger('ledger');
log.warn('flush-1'); log.warn('flush-2'); log.warn('flush-3');
trace.getTracer('t').startSpan('s').end();
const first = t.shutdownTelemetry();
console.log(first === t.shutdownTelemetry() ? 'IDEMPOTENT' : 'DIFFERENT');
first.then(() => console.log('FLUSHED'));
}, 200); // lets the resource's async attributes settle, as in a long-running service
`;

// AC-12-style: with a 10 min metric interval only an awaited shutdown can deliver the data.
for (const headers of HEADER_FORMS) {
  test(`shutdownTelemetry flushes traces, metrics and logs before resolving (${headers})`, async () => {
    const before = received.length;
    let atFlushed: Received[] = [];
    const result = await runChild(FLUSH_CHILD, headers, (line) => {
      if (line === 'FLUSHED') atFlushed = received.slice(before);
    });
    assert.equal(result.code, 0, result.stdout);
    assert.ok(result.stdout.includes('IDEMPOTENT'), result.stdout);
    for (const suffix of ['/v1/traces', '/v1/metrics', '/v1/logs']) {
      const hit = atFlushed.filter((r) => r.path.endsWith(suffix));
      assert.ok(hit.length > 0, `no ${suffix} request before shutdown resolved`);
      assert.ok(
        hit.every((r) => r.auth === AUTH),
        `${suffix} auth: ${hit.map((r) => r.auth)}`,
      );
    }
    // The test process exports its own metrics every 100 ms, so look for the child's instrument.
    const metricsBodies = atFlushed
      .filter((r) => r.path.endsWith('/v1/metrics'))
      .map((r) => r.body);
    assert.ok(
      metricsBodies.some((b) => b.includes('t.flush')),
      'the child counter was not in any metrics export before shutdown resolved',
    );
    const logsBody = atFlushed
      .filter((r) => r.path.endsWith('/v1/logs'))
      .map((r) => r.body)
      .join('');
    for (const n of ['flush-1', 'flush-2', 'flush-3'])
      assert.ok(logsBody.includes(n), `missing ${n}`);
  });
}

const GRPC_CHILD = `
const t = require(process.env.TELEMETRY_JS);
t.initTelemetry();
const grpc = require('@grpc/grpc-js'); // after start: the instrumentation patches on first require
const id = (x) => x;
const def = { Get: { path: '/t.T/Get', requestStream: false, responseStream: false,
  requestSerialize: id, requestDeserialize: id, responseSerialize: id, responseDeserialize: id } };
const server = new grpc.Server();
server.addService(def, { Get: (call, cb) => cb({ code: grpc.status.NOT_FOUND, details: 'nope' }) });
server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) throw err;
  const client = new grpc.Client('127.0.0.1:' + port, grpc.credentials.createInsecure());
  client.makeUnaryRequest('/t.T/Get', id, id, Buffer.alloc(0), () => {
    setTimeout(async () => {
      await t.shutdownTelemetry();
      console.log('DONE');
      client.close();
      server.forceShutdown();
    }, 200);
  });
});
`;

// AC-2: a real grpc-js server call records rpc.grpc.status_code from the instrumentation itself.
test('a real gRPC NOT_FOUND records rpc.server.duration with status 5 and the shared buckets', async () => {
  const before = received.length;
  const result = await runChild(GRPC_CHILD, HEADER_FORMS[0]);
  assert.equal(result.code, 0, result.stdout);
  const bodies = received
    .slice(before)
    .filter((r) => r.path.endsWith('/v1/metrics'))
    .map((r) => r.body);
  const points = bodies.flatMap((b) =>
    JSON.parse(b).resourceMetrics.flatMap((rm: any) =>
      rm.scopeMetrics.flatMap((sm: any) =>
        sm.metrics
          .filter((m: any) => m.name === 'rpc.server.duration')
          .flatMap((m: any) => m.histogram.dataPoints),
      ),
    ),
  );
  assert.ok(points.length > 0, `no rpc.server.duration point; bodies: ${bodies.join('\n')}`);
  const attr = (p: any, key: string) => p.attributes.find((a: any) => a.key === key)?.value;
  const notFound = points.find((p: any) => Number(attr(p, 'rpc.grpc.status_code')?.intValue) === 5);
  assert.ok(notFound, `no status 5 point: ${JSON.stringify(points)}`);
  assert.equal(attr(notFound, 'rpc.method')?.stringValue, 'Get');
  assert.deepEqual(notFound.explicitBounds, BUCKETS);
});
