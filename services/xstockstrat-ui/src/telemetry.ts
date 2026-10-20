export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const serviceName = process.env.SERVICE_NAME ?? 'xstockstrat-ui';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
    // sdk-node registers its own diag logger when OTEL_LOG_LEVEL is set.
    if (!process.env.OTEL_LOG_LEVEL) diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        'deployment.environment': process.env.APPLICATION_ENV ?? 'development',
        platform: 'xstockstrat',
      }),
      // No url option: it overrides OTEL_EXPORTER_OTLP_* (the SDK appends /v1/traces itself).
      traceExporter: new OTLPTraceExporter(),
      // Empty arrays stop sdk-node auto-starting env-default OTLP metrics/logs (traces only).
      metricReaders: [],
      logRecordProcessors: [],
      instrumentations: [],
    });

    sdk.start();
    console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  } catch (err) {
    console.warn('[otel] init failed — continuing without tracing:', err);
  }
}
