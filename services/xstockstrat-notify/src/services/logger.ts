/**
 * services/logger.ts
 * Winston-based structured JSON logger for all Node.js services.
 */
import { createLogger, format, transports } from 'winston';

const { combine, timestamp, json, colorize, simple } = format;

const isDev = process.env.NODE_ENV !== 'production';
const otelEnabled = process.env.OTEL_ENABLED === 'true';

function getOtelTransport() {
  if (!otelEnabled) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenTelemetryTransportV3 } = require('@opentelemetry/winston-transport');
    return [new OpenTelemetryTransportV3()];
  } catch {
    return [];
  }
}

export function getLogger(service: string) {
  return createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    defaultMeta: { service },
    format: isDev
      ? combine(colorize(), simple())
      : combine(timestamp(), json()),
    transports: [new transports.Console(), ...getOtelTransport()],
  });
}
