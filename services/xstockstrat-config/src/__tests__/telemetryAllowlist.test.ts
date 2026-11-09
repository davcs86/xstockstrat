// Feature 294 final allowlist pass for config (AC-41, AC-42).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, SpanKind } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as telemetry from '../telemetry';
import { CollectingReader, install } from './fixtures/collectingReader';

const ALLOWED_KEYS = new Set(
  Object.entries(telemetry)
    .filter(([name]) => name.startsWith('KEY_'))
    .map(([, value]) => String(value)),
);
const FORBIDDEN_KEYS = [
  'user_id',
  'email',
  'client_id',
  'account_id',
  'order_id',
  'intent_id',
  'symbol',
  'strategy_id',
  'stream_key',
  'slug',
  'category',
  'internal_caller',
  'secret',
  'api_key',
  'token',
];
const MIN_INSTRUMENTS = [
  'config.listener_up',
  'config.last_reload_timestamp',
  'config.listener_reconnects',
  'config.watch.terminated',
];
const RPC_KEYS = ['rpc.system', 'rpc.service', 'rpc.method', 'rpc.grpc.status_code'];

function drive(): void {
  telemetry.setListenerUp(true);
  telemetry.recordListenerReconnect();
  telemetry.setLastReloadTimestamp(Date.now());
  telemetry.recordWatchTerminated('client_error');
}

async function keysByInstrument(reader: CollectingReader): Promise<Map<string, Set<string>>> {
  const { resourceMetrics } = await reader.collect();
  const out = new Map<string, Set<string>>();
  for (const m of resourceMetrics.scopeMetrics.flatMap((sm) => sm.metrics)) {
    const keys = out.get(m.descriptor.name) ?? new Set<string>();
    for (const p of m.dataPoints) for (const k of Object.keys(p.attributes)) keys.add(k);
    out.set(m.descriptor.name, keys);
  }
  return out;
}

// Runs first: nothing has installed a MeterProvider yet, so the global one is the API no-op.
test('AC-42: with OTEL_ENABLED unset no exporter starts and every record call is a no-op', () => {
  delete process.env.OTEL_ENABLED;
  telemetry.initTelemetry();
  assert.equal(telemetry.telemetryStarted(), false);
  assert.equal(metrics.getMeterProvider().constructor.name, 'NoopMeterProvider');
  assert.doesNotThrow(drive);
});

test('AC-42: a failing OTel init is caught and the service keeps starting', () => {
  const originalStart = NodeSDK.prototype.start;
  const originalWarn = console.warn;
  const warned: string[] = [];
  NodeSDK.prototype.start = () => {
    throw new Error('sdk start failed');
  };
  console.warn = (...args: unknown[]) => void warned.push(args.map(String).join(' '));
  process.env.OTEL_ENABLED = 'true';
  try {
    assert.doesNotThrow(() => telemetry.initTelemetry());
  } finally {
    delete process.env.OTEL_ENABLED;
    NodeSDK.prototype.start = originalStart;
    console.warn = originalWarn;
  }
  assert.equal(telemetry.telemetryStarted(), false);
  assert.ok(
    warned.some((m) => m.includes('[otel] init failed')),
    warned.join('\n'),
  );
  assert.doesNotThrow(drive);
});

test('AC-41: every collected label key is a module KEY_ constant and none is an identifier', async () => {
  const reader = install();
  drive();
  const collected = await keysByInstrument(reader);
  for (const name of MIN_INSTRUMENTS) assert.ok(collected.has(name), `${name} not collected`);
  for (const [name, keys] of collected) {
    for (const k of keys) {
      assert.ok(ALLOWED_KEYS.has(k), `${name} carries key ${k} outside the KEY_ constants`);
      assert.ok(!FORBIDDEN_KEYS.includes(k), `${name} carries forbidden key ${k}`);
    }
  }
});

test('AC-41: rpc.server.duration keeps its name and attribute keys', async () => {
  const reader = install();
  new telemetry.RpcDurationProcessor().onEnd({
    kind: SpanKind.SERVER,
    attributes: { 'rpc.system': 'grpc', 'rpc.service': 's', 'rpc.method': 'm' },
    events: [],
    status: { code: 0 },
    duration: [0, 5e6],
  } as never);
  const keys = (await keysByInstrument(reader)).get('rpc.server.duration');
  assert.deepEqual([...(keys ?? [])].sort(), [...RPC_KEYS].sort());
});
