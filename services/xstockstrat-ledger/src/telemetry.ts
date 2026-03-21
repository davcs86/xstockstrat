/**
 * OpenTelemetry initialisation for xstockstrat-ledger.
 * Activated only when OTEL_ENABLED=true.
 * Must be called before any other imports to ensure auto-instrumentation works.
 */
export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } = require('@opentelemetry/semantic-conventions');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'grpc://otel-collector:4317';
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'xstockstrat-ledger';

    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: serviceName,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.APP_ENV ?? 'dev',
      }),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
      instrumentations: [new GrpcInstrumentation()],
    });

    sdk.start();
    console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`);

    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  } catch (err) {
    console.warn('[otel] init failed — continuing without tracing:', err);
  }
}
