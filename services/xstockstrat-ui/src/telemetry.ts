import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';

/** Stamps host.provider on every datapoint after aggregation; any failure exports the batch unlabelled. */
export function withHostProvider(inner: PushMetricExporter, provider: string): PushMetricExporter {
  let warned = false;
  const label = (rm: ResourceMetrics): ResourceMetrics => ({
    ...rm,
    scopeMetrics: rm.scopeMetrics.map((sm) => ({
      ...sm,
      metrics: sm.metrics.map((m) => ({
        ...m,
        dataPoints: (m.dataPoints as { attributes: Record<string, unknown> }[]).map((dp) => ({
          ...dp,
          attributes: { ...dp.attributes, 'host.provider': provider },
        })),
      })),
    })) as unknown as ResourceMetrics['scopeMetrics'],
  });
  return {
    export(metrics, resultCallback) {
      let out = metrics;
      try {
        out = label(metrics);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn('[otel] host_provider labelling failed; exporting without it:', err);
        }
      }
      inner.export(out, resultCallback);
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
    selectAggregationTemporality: inner.selectAggregationTemporality?.bind(inner),
    selectAggregation: inner.selectAggregation?.bind(inner),
  };
}

/** An explicit reader ignores OTEL_METRIC_EXPORT_INTERVAL in sdk-metrics 2.x, so honour it here. */
function metricIntervalOptions(): { exportIntervalMillis?: number; exportTimeoutMillis?: number } {
  const interval = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL);
  if (!Number.isFinite(interval) || interval <= 0) return {};
  const timeout = Number(process.env.OTEL_METRIC_EXPORT_TIMEOUT) || 30000;
  return { exportIntervalMillis: interval, exportTimeoutMillis: Math.min(interval, timeout) };
}

/** The batch processor ignores OTEL_BLRP_SCHEDULE_DELAY in sdk-logs 0.218, so honour it here. */
function logBatchOptions(): { scheduledDelayMillis?: number } {
  const delay = Number(process.env.OTEL_BLRP_SCHEDULE_DELAY);
  return Number.isFinite(delay) && delay > 0 ? { scheduledDelayMillis: delay } : {};
}

/** Exact lowercase deploy-target names only; anything else is 'unknown', never an error. */
function hostProvider(): string {
  const p = process.env.HOST_PROVIDER;
  return p === 'digitalocean' || p === 'homelab' ? p : 'unknown';
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
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const serviceName = process.env.SERVICE_NAME ?? 'ui';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
    // sdk-node registers its own diag logger when OTEL_LOG_LEVEL is set.
    if (!process.env.OTEL_LOG_LEVEL) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

    const provider = hostProvider();
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      'deployment.environment': process.env.APPLICATION_ENV ?? 'development',
      platform: 'xstockstrat',
      'host.provider': provider,
      'service.instance.id': `${provider}-${serviceName}`,
    });
    const stamped = String(resource.attributes['host.provider']);

    const sdk = new NodeSDK({
      resource,
      // No exporter takes a url option: it overrides OTEL_EXPORTER_OTLP_* (the SDK appends the
      // signal path itself). The UI passes no spanProcessors, so the implicit trace processor stays.
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: withHostProvider(new OTLPMetricExporter(), stamped),
          ...metricIntervalOptions(),
        }),
      ],
      logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter(), logBatchOptions())],
      instrumentations: [],
    });

    sdk.start();
    console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  } catch (err) {
    console.warn('[otel] init failed — continuing without tracing:', err);
  }
}
