import assert from 'node:assert/strict';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';

export class CollectingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export function install(): CollectingReader {
  metrics.disable();
  const reader = new CollectingReader();
  const provider = new MeterProvider();
  provider.addMetricReader(reader);
  assert.equal(metrics.setGlobalMeterProvider(provider), true);
  return reader;
}

export type Point = {
  attributes: Record<string, unknown>;
  value: number | { sum?: number; count?: number };
};

export async function points(reader: CollectingReader, name: string): Promise<Point[]> {
  const { resourceMetrics } = await reader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.descriptor.name === name)
    .flatMap((m) => m.dataPoints as Point[]);
}

export async function values(reader: CollectingReader, name: string): Promise<number[]> {
  return (await points(reader, name)).map((p) =>
    typeof p.value === 'number' ? p.value : (p.value.sum ?? NaN),
  );
}

/** Sum of a counter's points whose `key` attribute equals `value`. */
export async function counterValue(
  reader: CollectingReader,
  name: string,
  key: string,
  value: string,
): Promise<number> {
  return (await points(reader, name))
    .filter((p) => p.attributes[key] === value)
    .reduce((sum, p) => sum + (p.value as number), 0);
}
