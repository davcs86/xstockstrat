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
import type { Context, Histogram } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';

/**
 * OpenTelemetry initialisation — activated only when OTEL_ENABLED=true.
 * Must be called before any other imports so auto-instrumentation can patch them.
 */
/**
 * buildResource is the sole OTel Resource input to initTelemetry; its omitted attributes are
 * guarded by src/__tests__/telemetry.test.ts.
 */
export function buildResource() {
  return new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'ledger',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APPLICATION_ENV ?? 'development',
    platform: 'xstockstrat',
  });
}

// Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
export const RPC_DURATION_BUCKETS_MS = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
];

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

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SpanKind, metrics } = require('@opentelemetry/api');
    if (span.kind !== SpanKind.SERVER || span.attributes['rpc.system'] !== 'grpc') return;
    this.histogram ??= metrics.getMeter('xstockstrat.rpc').createHistogram('rpc.server.duration', {
      unit: 'ms',
    });
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

/** Flushes and stops the SDK once; later calls return the same promise. */
export function shutdownTelemetry(): Promise<void> {
  if (!sdkShutdown) return Promise.resolve();
  shutdownPromise ??= sdkShutdown().catch((err) => {
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
    const sdkMetrics = require('@opentelemetry/sdk-metrics');
    const { PeriodicExportingMetricReader, View, ExplicitBucketHistogramAggregation } = sdkMetrics;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const serviceName = process.env.SERVICE_NAME ?? 'ledger';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
    // sdk-node registers its own diag logger when OTEL_LOG_LEVEL is set.
    if (!process.env.OTEL_LOG_LEVEL) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

    const sdk = new NodeSDK({
      resource: buildResource(),
      // spanProcessors replaces sdk-node's implicit trace exporter, so the batch processor is listed.
      // No exporter takes a url/headers argument: that would override OTEL_EXPORTER_OTLP_*.
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter()), new RpcDurationProcessor()],
      metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
      logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
      views: [
        new View({
          instrumentName: 'rpc.server.duration',
          aggregation: new ExplicitBucketHistogramAggregation(RPC_DURATION_BUCKETS_MS),
        }),
      ],
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
