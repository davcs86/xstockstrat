import {
  Resource,
  envDetectorSync,
  hostDetectorSync,
  processDetectorSync,
} from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import type {
  Attributes,
  Context,
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  ObservableResult,
} from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

/**
 * OpenTelemetry initialisation for xstockstrat-notify.
 * Activated only when OTEL_ENABLED=true.
 * Must be called before any other imports to ensure auto-instrumentation works.
 */
/**
 * buildResource is the sole OTel Resource input to initTelemetry; its omitted attributes are
 * guarded by src/__tests__/telemetry.test.ts.
 */
export function buildResource() {
  return new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'notify',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development',
    platform: 'xstockstrat',
  });
}

// Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
export const RPC_DURATION_BUCKETS_MS = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
];

/** An explicit reader ignores OTEL_METRIC_EXPORT_INTERVAL in sdk-metrics 1.25, so honour it here. */
function metricIntervalOptions(): { exportIntervalMillis?: number; exportTimeoutMillis?: number } {
  const interval = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL);
  if (!Number.isFinite(interval) || interval <= 0) return {};
  const timeout = Number(process.env.OTEL_METRIC_EXPORT_TIMEOUT) || 30000;
  return { exportIntervalMillis: interval, exportTimeoutMillis: Math.min(interval, timeout) };
}

/** Views applied to the MeterProvider: the shared bucket boundaries for `rpc.server.duration`. */
export function rpcDurationViews() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View, ExplicitBucketHistogramAggregation } = require('@opentelemetry/sdk-metrics');
  return [
    new View({
      instrumentName: 'rpc.server.duration',
      aggregation: new ExplicitBucketHistogramAggregation(RPC_DURATION_BUCKETS_MS),
    }),
  ];
}

/** Integer gRPC status of a finished SERVER span; first match wins. */
export function grpcStatusCode(span: ReadableSpan): number {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SpanStatusCode } = require('@opentelemetry/api');
  const code = span.attributes['rpc.grpc.status_code'];
  if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 16) return code;
  if (span.events.some((e) => e.name === 'exception')) return 2;
  if (span.status.code === SpanStatusCode.ERROR) return 2;
  return 0;
}

/**
 * Records `rpc.server.duration` (ms) from finished gRPC SERVER spans: instrumentation-grpc emits no
 * RPC metric, so the histogram is derived from the span it already creates. The histogram is made on
 * first use because @opentelemetry/api has no proxy MeterProvider (an early meter would export nothing).
 */
export class RpcDurationProcessor implements SpanProcessor {
  private histogram: Histogram | undefined;
  private meterProvider: unknown;

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SpanKind, metrics } = require('@opentelemetry/api');
    if (span.kind !== SpanKind.SERVER || span.attributes['rpc.system'] !== 'grpc') return;
    // Rebound if the global provider changes, so a pre-start call cannot pin a no-op histogram.
    const provider = metrics.getMeterProvider();
    if (this.meterProvider !== provider) {
      this.meterProvider = provider;
      this.histogram = metrics.getMeter('xstockstrat.rpc').createHistogram('rpc.server.duration', {
        unit: 'ms',
      });
    }
    const [seconds, nanos] = span.duration;
    this.histogram!.record(seconds * 1e3 + nanos / 1e6, {
      'rpc.system': 'grpc',
      'rpc.service': String(span.attributes['rpc.service'] ?? ''),
      'rpc.method': String(span.attributes['rpc.method'] ?? ''),
      'rpc.grpc.status_code': grpcStatusCode(span),
    });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

let started = false;
let shutdownPromise: Promise<void> | undefined;
let sdkShutdown: (() => Promise<void>) | undefined;

/** True once sdk.start() has returned; the winston bridge attaches only after that. */
export function telemetryStarted(): boolean {
  return started;
}

/**
 * Flushes and stops the SDK once; later calls return the same promise. sdk-metrics 1.25's periodic
 * reader exports nothing on shutdown(), so the meter provider is flushed first (traces and logs flush
 * inside their processors' shutdown).
 */
export function shutdownTelemetry(): Promise<void> {
  if (!sdkShutdown) return Promise.resolve();
  const stop = sdkShutdown;
  shutdownPromise ??= (async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { metrics } = require('@opentelemetry/api');
    await metrics.getMeterProvider().forceFlush?.();
    await stop();
  })().catch((err) => {
    console.error(err);
  });
  return shutdownPromise;
}

export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const serviceName = process.env.SERVICE_NAME ?? 'notify';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
    // sdk-node registers its own diag logger when OTEL_LOG_LEVEL is set.
    if (!process.env.OTEL_LOG_LEVEL) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

    const sdk = new NodeSDK({
      resource: buildResource(),
      // spanProcessors replaces sdk-node's implicit trace exporter, so the batch processor is listed.
      // No exporter takes a url/headers argument: that would override OTEL_EXPORTER_OTLP_*.
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), new RpcDurationProcessor()],
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        ...metricIntervalOptions(),
      }),
      logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
      views: rpcDurationViews(),
      // 0.52's default async detectors log a false diag.error on every boot once a logger exists.
      resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync],
      instrumentations: [new GrpcInstrumentation()],
    });

    sdk.start();
    sdkShutdown = () => sdk.shutdown();
    started = true;
    console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);
  } catch (err) {
    console.warn('[otel] init failed — continuing without tracing:', err);
  }
}

const METER_NAME = 'xstockstrat.notify';

type InstrumentOptions = { unit?: string; description?: string };

/** Runs one metrics call; a metrics fault must never change the caller's control flow. */
function guarded(record: () => void): void {
  try {
    record();
  } catch {
    // Swallowed by design (see above).
  }
}

/**
 * One instrument, re-created whenever the global MeterProvider changes: API 1.9 has no proxy
 * MeterProvider, so an instrument bound before sdk.start() would stay a no-op.
 */
abstract class Bound<T> {
  protected inst: T | undefined;
  private boundTo: unknown;

  constructor(protected readonly name: string) {}

  protected abstract create(meter: Meter): T;

  protected instrument(): T {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { metrics } = require('@opentelemetry/api');
    const provider = metrics.getMeterProvider();
    if (this.inst === undefined || this.boundTo !== provider) {
      this.inst = this.create(metrics.getMeter(METER_NAME));
      this.boundTo = provider;
    }
    return this.inst;
  }
}

export class BoundCounter extends Bound<Counter> {
  constructor(
    name: string,
    private readonly options: InstrumentOptions = {},
  ) {
    super(name);
  }

  protected create(meter: Meter): Counter {
    return meter.createCounter(this.name, this.options);
  }

  add(value = 1, attributes?: Attributes): void {
    guarded(() => this.instrument().add(value, attributes));
  }
}

export class BoundHistogram extends Bound<Histogram> {
  constructor(
    name: string,
    private readonly options: InstrumentOptions & { buckets?: number[] } = {},
  ) {
    super(name);
  }

  protected create(meter: Meter): Histogram {
    const { buckets, ...rest } = this.options;
    return meter.createHistogram(
      this.name,
      buckets ? { ...rest, advice: { explicitBucketBoundaries: buckets } } : rest,
    );
  }

  record(value: number, attributes?: Attributes): void {
    guarded(() => this.instrument().record(value, attributes));
  }
}

/**
 * Observable gauge; `observe()` returns the sample, or undefined to skip it (the SDK keeps
 * exporting the last one). Call `register()` once the provider is installed and after it changes.
 */
export class BoundGauge extends Bound<ObservableGauge> {
  constructor(
    name: string,
    private readonly observe: () => number | undefined,
    private readonly options: InstrumentOptions = {},
  ) {
    super(name);
  }

  protected create(meter: Meter): ObservableGauge {
    const gauge = meter.createObservableGauge(this.name, this.options);
    gauge.addCallback((result: ObservableResult) =>
      guarded(() => {
        // A superseded provider keeps calling this; only the current binding reports.
        if (this.inst !== gauge) return;
        const value = this.observe();
        if (value !== undefined) result.observe(value);
      }),
    );
    return gauge;
  }

  register(): void {
    guarded(() => this.instrument());
  }
}

export const KEY_CHANNEL = 'channel';
export const KEY_OUTCOME = 'outcome';
export const KEY_REASON = 'reason';

export type DeliveryChannel = 'fanout' | 'slack' | 'sendgrid' | 'push';
export type DeliveryOutcome =
  | 'gated_severity'
  | 'gated_conviction'
  | 'deduped'
  | 'dispatch_error'
  | 'sent'
  | 'http_error'
  | 'timeout'
  | 'error'
  | 'disabled'
  | 'admin_lookup_error'
  | 'no_audience'
  | 'pruned';
export type StreamEvictionReason = 'write_error' | 'stream_error';

let readSubscribers: () => number = () => 0;

const delivery = new BoundCounter('notify.delivery', {
  description: 'Side-channel delivery outcomes by channel',
});
const streamEvictions = new BoundCounter('notify.stream.evictions', {
  description: 'StreamAlerts subscribers removed by reason',
});
const streamSubscribers = new BoundGauge('notify.stream.subscribers', () => readSubscribers());

/** `category` and `sourceService` are never labels (unbounded). */
export function recordDelivery(channel: DeliveryChannel, outcome: DeliveryOutcome): void {
  delivery.add(1, { [KEY_CHANNEL]: channel, [KEY_OUTCOME]: outcome });
}

export function recordStreamEviction(reason: StreamEvictionReason): void {
  streamEvictions.add(1, { [KEY_REASON]: reason });
  streamSubscribers.register();
}

/** notify.stream.subscribers reads `read()`; call again after the MeterProvider changes. */
export function observeStreamSubscribers(read: () => number): void {
  readSubscribers = read;
  streamSubscribers.register();
}
