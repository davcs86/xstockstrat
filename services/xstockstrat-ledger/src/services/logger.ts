/**
 * services/logger.ts
 * Winston-based structured JSON logger for all Node.js services.
 */
import { createLogger, format, transports } from 'winston';

const { combine, timestamp, json, colorize, simple } = format;

const isDev = process.env.NODE_ENV !== 'production';

export function getLogger(service: string) {
  return createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
    defaultMeta: { service },
    format: isDev
      ? combine(colorize(), simple())
      : combine(timestamp(), json()),
    transports: [new transports.Console()],
  });
}
