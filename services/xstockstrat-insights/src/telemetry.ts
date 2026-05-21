/**
 * OpenTelemetry initialisation for xstockstrat-insights.
 * Activated only when OTEL_ENABLED=true.
 * Must be called before any other imports to ensure auto-instrumentation works.
 */
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

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318';
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'xstockstrat-insights';

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        'deployment.environment': process.env.APPLICATION_ENV ?? 'development',
        trading_mode: process.env.TRADING_MODE ?? 'paper',
        platform: 'xstockstrat',
      }),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [],
    });

    sdk.start();
    console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  } catch (err) {
    console.warn('[otel] init failed — continuing without tracing:', err);
  }
}
