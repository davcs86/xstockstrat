/**
 * OpenTelemetry instrumentation bootstrap for xstockstrat Node.js services.
 *
 * Call initTelemetry(serviceName) before any other imports/logic.
 * Call shutdownTelemetry() on SIGTERM.
 * No-op when OTEL_ENABLED !== 'true' or when OTel packages are not installed.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

let sdk: unknown = undefined;

export function initTelemetry(serviceName: string): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
    const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

    sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 10_000,
      }),
      logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false }, // noisy
        }),
      ],
    });

    (sdk as { start(): void }).start();
  } catch (err) {
    // OTel packages not installed — skip instrumentation (non-fatal).
    // Packages are installed at Docker build time via pnpm install.
    console.warn('[otel] packages not available, skipping init:', (err as Error).message);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await (sdk as { shutdown(): Promise<void> }).shutdown();
    } catch {
      // ignore shutdown errors
    }
  }
}
