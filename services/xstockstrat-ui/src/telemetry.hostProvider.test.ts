import { expect, test } from 'vitest';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import { withHostProvider } from './telemetry';

type Agg = ReturnType<NonNullable<PushMetricExporter['selectAggregation']>>;

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
  selectAggregation(this: FakeExporter): Agg {
    return (this === undefined ? undefined : { type: 'fake' }) as unknown as Agg;
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
    expect(fake.exported).toHaveLength(2);
    expect(fake.exported[0]).toBe(bad);
    expect(fake.exported[1]).toBe(bad);
    expect(warns.filter((w) => w.includes('host_provider'))).toHaveLength(1);
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
  expect(p.attributes).toEqual({ 'host.provider': 'homelab', outcome: 'ok' });
  expect(pointsOf(input)[0].attributes['host.provider']).toBe('x');
  expect(p.value).toBe(1);
});

// B3 @AC-21: temporality/aggregation selectors keep the inner `this`; B4: flush/shutdown delegate.
test('forwards selectors bound to the inner exporter, flush and shutdown', async () => {
  const fake = new FakeExporter();
  const w = withHostProvider(fake, 'homelab');
  expect(w.selectAggregationTemporality?.(0 as never)).toBe(0);
  expect(w.selectAggregation?.(0 as never)).toEqual({ type: 'fake' });
  await w.forceFlush();
  await w.shutdown();
  expect(fake.flushes).toBe(1);
  expect(fake.shutdowns).toBe(1);
});

test('omits selectors the inner exporter does not define', () => {
  const bare: PushMetricExporter = {
    export: (_m, cb) => cb({ code: 0 }),
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  const w = withHostProvider(bare, 'homelab');
  expect(w.selectAggregationTemporality).toBeUndefined();
  expect(w.selectAggregation).toBeUndefined();
});
