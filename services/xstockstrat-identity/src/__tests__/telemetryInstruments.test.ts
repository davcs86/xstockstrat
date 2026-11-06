import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, trace } from '@opentelemetry/api';
import type { MeterProvider as ApiMeterProvider } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { node as sdkNode } from '@opentelemetry/sdk-node';
import {
  BoundCounter,
  BoundGauge,
  BoundHistogram,
  initTelemetry,
  telemetryStarted,
} from '../telemetry';

class CollectingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function install(): CollectingReader {
  metrics.disable();
  const reader = new CollectingReader();
  const provider = new MeterProvider();
  provider.addMetricReader(reader);
  assert.equal(metrics.setGlobalMeterProvider(provider), true);
  return reader;
}

async function values(reader: CollectingReader, name: string): Promise<number[]> {
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.descriptor.name === name)
    .flatMap((m) => m.dataPoints as Array<{ value: number | { sum?: number } }>)
    .map((p) => (typeof p.value === 'number' ? p.value : (p.value.sum ?? NaN)));
}

// Runs first: nothing has installed a MeterProvider yet, so the global one is the API no-op.
test('AC-42: with OTEL_ENABLED unset and the no-op provider every accessor call is a silent no-op', () => {
  delete process.env.OTEL_ENABLED;
  initTelemetry();
  assert.equal(telemetryStarted(), false);
  assert.equal(metrics.getMeterProvider().constructor.name, 'NoopMeterProvider');
  assert.doesNotThrow(() => {
    new BoundCounter('test.noop.counter').add();
    new BoundHistogram('test.noop.histogram', { buckets: [1, 10] }).record(3);
    new BoundGauge('test.noop.gauge', () => 1).register();
  });
});

test('accessors bind to a provider installed after import, then rebind to a second provider', async () => {
  const counter = new BoundCounter('test.rebind.counter');
  const histogram = new BoundHistogram('test.rebind.histogram', { buckets: [1, 10] });
  let gaugeValue = 7;
  const gauge = new BoundGauge('test.rebind.gauge', () => gaugeValue);

  const a = install();
  counter.add(2);
  histogram.record(5);
  gauge.register();
  assert.deepEqual(await values(a, 'test.rebind.counter'), [2]);
  assert.deepEqual(await values(a, 'test.rebind.histogram'), [5]);
  assert.deepEqual(await values(a, 'test.rebind.gauge'), [7]);

  const b = install();
  counter.add(3);
  histogram.record(4);
  gaugeValue = 9;
  gauge.register();
  assert.deepEqual(await values(b, 'test.rebind.counter'), [3]);
  assert.deepEqual(await values(b, 'test.rebind.histogram'), [4]);
  assert.deepEqual(await values(b, 'test.rebind.gauge'), [9]);

  // Provider A keeps only its own samples; the SDK may re-export the gauge's last value there.
  assert.deepEqual(await values(a, 'test.rebind.counter'), [2]);
  assert.deepEqual(await values(a, 'test.rebind.histogram'), [5]);
  assert.equal((await values(a, 'test.rebind.gauge')).includes(9), false);
});

test('a throwing meter, instrument or observe callback never escapes the accessors', async () => {
  const boom = (): never => {
    throw new Error('instrument fault');
  };
  const faultyInstruments = {
    getMeter: () => ({
      createCounter: () => ({ add: boom }),
      createHistogram: () => ({ record: boom }),
      createObservableGauge: () => ({ addCallback: boom }),
    }),
  };
  for (const provider of [faultyInstruments, { getMeter: boom }]) {
    metrics.disable();
    metrics.setGlobalMeterProvider(provider as unknown as ApiMeterProvider);
    assert.doesNotThrow(() => {
      new BoundCounter('test.fault.counter').add(1);
      new BoundHistogram('test.fault.histogram').record(1);
      new BoundGauge('test.fault.gauge', () => 1).register();
    });
  }

  const reader = install();
  new BoundGauge('test.fault.observe', boom).register();
  assert.deepEqual(await values(reader, 'test.fault.observe'), []);
});

// design.md Open Risk "Node AsyncLocalStorage": the context manager NodeSDK registers carries the
// active span into a queueMicrotask callback and past an await on it.
test('an active span survives queueMicrotask', async () => {
  const provider = new sdkNode.NodeTracerProvider();
  provider.register();
  try {
    await trace.getTracer('test').startActiveSpan('outer', async (span) => {
      const inCallback = await new Promise((r) => queueMicrotask(() => r(trace.getActiveSpan())));
      assert.equal(inCallback, span);
      await new Promise<void>((r) => queueMicrotask(r));
      assert.equal(trace.getActiveSpan(), span);
      span.end();
    });
  } finally {
    await provider.shutdown();
  }
});
