import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';

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

export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'grpc://otel-collector:4317';
    const serviceName = process.env.SERVICE_NAME ?? 'ledger';

    const sdk = new NodeSDK({
      resource: buildResource(),
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
