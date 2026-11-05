import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import { metrics, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import {
  buildResource,
  grpcStatusCode,
  RpcDurationProcessor,
  rpcDurationViews,
  telemetryStarted,
} from '../telemetry';

// Feature 171 — the built OTel Resource must omit the removed trading_mode attribute.
test('built Resource omits trading_mode, keeps the trio', () => {
  process.env.TRADING_MODE = 'paper';
  const attrs = buildResource().attributes as Record<string, unknown>;
  assert.equal('trading_mode' in attrs, false);
  assert.ok(attrs['service.name']);
  assert.ok('deployment.environment' in attrs);
  assert.equal(attrs['platform'], 'xstockstrat');
});

const VECTORS = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', 'scripts', 'testdata', 'rpc-status-vectors.json'),
    'utf8',
  ),
);

class CollectingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

// The global MeterProvider is set-once per process, so every test shares one provider and reader and
// tells its data point apart by a unique rpc.method.
const reader = new CollectingReader();
function installProvider(): void {
  const provider = new MeterProvider({ views: rpcDurationViews() });
  provider.addMetricReader(reader);
  assert.equal(metrics.setGlobalMeterProvider(provider), true);
}

function span(spec: any, method: string, durationMs = 5): any {
  return {
    kind: SpanKind[spec.kind as keyof typeof SpanKind],
    attributes: { ...spec.attributes, 'rpc.method': method },
    events: (spec.events ?? []).map((e: any) => ({ name: e.name, attributes: e.attributes })),
    status: { code: spec.status === 'ERROR' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET },
    duration: [0, durationMs * 1e6],
  };
}

async function pointsFor(method: string): Promise<any[]> {
  const { resourceMetrics } = await reader.collect();
  return (resourceMetrics?.scopeMetrics ?? [])
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.descriptor.name === 'rpc.server.duration')
    .flatMap((m) => m.dataPoints as any[])
    .filter((p) => p.attributes['rpc.method'] === method);
}

// AC-5: with OTEL_ENABLED unset nothing is installed and nothing is exported, even under load.
// Runs before any test installs the process-global MeterProvider.
test('disabled: 10 gRPC reads export nothing and leave the no-op meter provider', async () => {
  delete process.env.OTEL_ENABLED;
  process.env.CONFIG_SECRETS_ENCRYPTION_KEY =
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  let exportRequests = 0;
  const receiver = createHttpServer((req, res) => {
    exportRequests++;
    req.resume();
    res.writeHead(200).end('{}');
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../telemetry').initTelemetry();
    const { ConfigServiceImpl } = await import('../grpc/configServiceImpl');
    const { createConfigServiceDefinition } = await import('../grpc/serviceDefinition');
    const { ConfigServiceClient } = await import('@xstockstrat/proto/config/v1/config');
    const pool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };
    const server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(pool as any) as unknown as grpc.UntypedServiceImplementation,
    );
    const port: number = await new Promise((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) =>
        e ? reject(e) : resolve(p),
      ),
    );
    const client: any = new ConfigServiceClient(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
    );
    try {
      for (let i = 0; i < 10; i++) {
        await new Promise<void>((resolve) =>
          client.getConfig(
            { namespace: 'analysis', environment: 'ENVIRONMENT_STAGING', userId: '' },
            () => resolve(),
          ),
        );
      }
    } finally {
      client.close();
      server.forceShutdown();
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(exportRequests, 0);
    assert.match(metrics.getMeterProvider().constructor.name, /Noop/);
    assert.equal(telemetryStarted(), false);
  } finally {
    receiver.closeAllConnections();
    receiver.close();
  }
});

// Run first: this installs the global provider that the later tests share.
test('histogram is created on first onEnd, so a pre-provider span records nothing and a later one does', async () => {
  const processor = new RpcDurationProcessor();
  const vector = VECTORS.vectors[0].span;
  processor.onEnd(span(vector, 'lazy')); // no real MeterProvider yet: must not throw or pin a no-op
  installProvider();
  assert.deepEqual(await pointsFor('lazy'), []);
  processor.onEnd(span(vector, 'lazy'));
  const points = await pointsFor('lazy');
  assert.equal(points.length, 1);
  assert.equal(points[0].value.count, 1);
});

// AC-15: shared status-derivation vectors and bucket boundaries.
for (const vector of VECTORS.vectors.filter((v: any) => v.applies_to.includes('node'))) {
  test(`rpc status vector: ${vector.name}`, async () => {
    new RpcDurationProcessor().onEnd(span(vector.span, vector.name));
    const points = await pointsFor(vector.name);
    assert.equal(points.length, 1);
    assert.equal(points[0].attributes['rpc.grpc.status_code'], vector.expected_code);
    assert.ok(Number.isInteger(points[0].attributes['rpc.grpc.status_code']));
    assert.equal(points[0].attributes['rpc.system'], 'grpc');
    assert.deepEqual(points[0].value.buckets.boundaries, VECTORS.bucket_boundaries_ms);
  });
}

test('grpcStatusCode: out-of-range and non-integer attributes fall back', () => {
  const base = { events: [], status: { code: SpanStatusCode.UNSET } };
  assert.equal(grpcStatusCode({ ...base, attributes: { 'rpc.grpc.status_code': 99 } } as any), 0);
  assert.equal(grpcStatusCode({ ...base, attributes: { 'rpc.grpc.status_code': 1.5 } } as any), 0);
  assert.equal(grpcStatusCode({ ...base, attributes: { 'rpc.grpc.status_code': 16 } } as any), 16);
});

test('non-SERVER and non-grpc spans are ignored', async () => {
  const processor = new RpcDurationProcessor();
  processor.onEnd(span({ kind: 'CLIENT', attributes: { 'rpc.system': 'grpc' } }, 'ignored'));
  processor.onEnd(span({ kind: 'SERVER', attributes: { 'rpc.system': 'http' } }, 'ignored'));
  assert.deepEqual(await pointsFor('ignored'), []);
});

test('disabled: telemetry never starts and the logger gains no OTLP transport', () => {
  delete process.env.OTEL_ENABLED;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { initTelemetry } = require('../telemetry');
  initTelemetry();
  assert.equal(telemetryStarted(), false);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getLogger } = require('../services/logger');
  assert.equal(getLogger('config').transports.length, 1);
});
