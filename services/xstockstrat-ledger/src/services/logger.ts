/**
 * Winston-based structured JSON logger for all Node.js services.
 */
import { createLogger, format, transports } from 'winston';
import type { Logger } from 'winston';
import { telemetryStarted } from '../telemetry';

const { combine, timestamp, json, colorize, simple } = format;

const isDev = process.env.NODE_ENV !== 'production';

// Bridges winston records to OTLP once the SDK is up (the API has no proxy LoggerProvider). The OTel
// diag logger stays on console, so SDK/exporter failures never loop back into export.
function attachOtlpLogTransport(logger: Logger): Logger {
  if (process.env.OTEL_ENABLED !== 'true' || !telemetryStarted()) return logger;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenTelemetryTransportV3 } = require('@opentelemetry/winston-transport');
    logger.add(new OpenTelemetryTransportV3());
  } catch (err) {
    console.warn('[otel] log bridge unavailable — logs stay on stdout:', err);
  }
  return logger;
}

export function getLogger(service: string) {
  return attachOtlpLogTransport(
    createLogger({
      level: process.env.LOG_LEVEL ?? 'info',
      defaultMeta: { service },
      format: isDev ? combine(colorize(), simple()) : combine(timestamp(), json()),
      transports: [new transports.Console()],
    }),
  );
}
