import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  assert.equal(getLogger('notify').transports.length, 1);
});
