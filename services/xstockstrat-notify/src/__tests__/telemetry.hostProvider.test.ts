import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Aggregation, PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { withHostProvider } from '../telemetry';

type Point = { attributes: Record<string, unknown>; value: number };

class FakeExporter implements PushMetricExporter {
  exported: ResourceMetrics[] = [];
  flushes = 0;
  shutdowns = 0;
  export(metrics: ResourceMetrics, cb: (r: { code: number }) => void): void {
    this.exported.push(metrics);
    cb({ code: 0 });
  }
  async forceFlush(): Promise<void> {
    this.flushes++;
  }
  async shutdown(): Promise<void> {
    this.shutdowns++;
  }
  selectAggregationTemporality(this: FakeExporter): number {
    return this === undefined ? -1 : 0;
  }
  selectAggregation(this: FakeExporter): Aggregation {
    return (this === undefined ? undefined : { type: 'fake' }) as unknown as Aggregation;
  }
}

const batch = (...points: Point[]): ResourceMetrics =>
  ({
    resource: {},
    scopeMetrics: [
      { scope: { name: 's' }, metrics: [{ descriptor: { name: 'c' }, dataPoints: points }] },
    ],
  }) as unknown as ResourceMetrics;

const pointsOf = (rm: ResourceMetrics): Point[] =>
  (rm.scopeMetrics as any[]).flatMap((s) => s.metrics.flatMap((m: any) => m.dataPoints));

const run = (exp: PushMetricExporter, rm: ResourceMetrics): void => exp.export(rm, () => {});

// B1 @AC-5: a labelling failure exports the identical original batch and warns once per instance.
test('a labelling failure exports the original batch and warns once', () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a.join(' '));
  try {
    const fake = new FakeExporter();
    const wrapped = withHostProvider(fake, 'homelab');
    const bad = {
      resource: {},
      get scopeMetrics(): never {
        throw new Error('boom');
      },
    } as unknown as ResourceMetrics;
    run(wrapped, bad);
    run(wrapped, bad);
    assert.equal(fake.exported.length, 2);
    assert.strictEqual(fake.exported[0], bad);
    assert.strictEqual(fake.exported[1], bad);
    assert.equal(warns.filter((w) => w.includes('host_provider')).length, 1, warns.join('\n'));
  } finally {
    console.warn = orig;
  }
});

// B2 @AC-13: an existing host.provider is overwritten once; the input is never mutated.
test('overwrites an existing host.provider key and leaves the input untouched', () => {
  const fake = new FakeExporter();
  const input = batch({ attributes: { 'host.provider': 'x', outcome: 'ok' }, value: 1 });
  run(withHostProvider(fake, 'homelab'), input);
  const [p] = pointsOf(fake.exported[0]);
  assert.deepEqual(p.attributes, { 'host.provider': 'homelab', outcome: 'ok' });
  assert.equal(pointsOf(input)[0].attributes['host.provider'], 'x');
  assert.equal(p.value, 1);
});

// B3 @AC-21: temporality/aggregation selectors keep the inner `this`; B4: flush/shutdown delegate.
test('forwards selectors bound to the inner exporter, flush and shutdown', async () => {
  const fake = new FakeExporter();
  const w = withHostProvider(fake, 'homelab');
  assert.equal(w.selectAggregationTemporality?.(0 as never), 0);
  assert.deepEqual(w.selectAggregation?.(0 as never), { type: 'fake' });
  await w.forceFlush();
  await w.shutdown();
  assert.equal(fake.flushes, 1);
  assert.equal(fake.shutdowns, 1);
});

test('omits selectors the inner exporter does not define', () => {
  const bare: PushMetricExporter = {
    export: (_m, cb) => cb({ code: 0 }),
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  const w = withHostProvider(bare, 'homelab');
  assert.equal(w.selectAggregationTemporality, undefined);
  assert.equal(w.selectAggregation, undefined);
});
