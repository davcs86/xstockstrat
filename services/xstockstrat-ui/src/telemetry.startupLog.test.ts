import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// Installed before OTel loads (DiagConsoleLogger binds at load).
const original = { info: console.info, warn: console.warn };
const info: string[] = [];
const warn: string[] = [];
console.info = (...args: unknown[]) => {
  info.push(args.map(String).join(' '));
};
console.warn = (...args: unknown[]) => {
  warn.push(args.map(String).join(' '));
};

const server = createServer((req, res) => {
  req.resume();
  req.on('end', () => res.writeHead(200).end('{}'));
});

// Feature 329 AC-1: an unset OTEL_EXPORTER_OTLP_ENDPOINT is logged as the SDK default, not "undefined".
test('AC-1: startup log names SDK default when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const keys = [
    'OTEL_ENABLED',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_LOG_LEVEL',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  ];
  const savedEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.OTEL_ENABLED = 'true';
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_LOG_LEVEL;
  for (const signal of ['traces', 'metrics', 'logs']) {
    process.env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`] =
      `http://127.0.0.1:${port}/otlp/v1/${signal}`;
  }

  const before = process.listeners('SIGTERM');
  const { initTelemetry } = await import('./telemetry');
  initTelemetry();
  const added = process.listeners('SIGTERM').filter((l) => !before.includes(l));

  try {
    expect(added).toHaveLength(1);
    expect(info.some((m) => m.includes('[otel] tracing enabled → SDK default'))).toBe(true);
    expect(info.some((m) => m.includes('→ undefined'))).toBe(false);
    expect(warn.some((m) => m.includes('[otel] init failed'))).toBe(false);
  } finally {
    for (const l of added) {
      await (l as (signal: NodeJS.Signals) => unknown)('SIGTERM');
      process.removeListener('SIGTERM', l);
    }
    for (const k of keys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    Object.assign(console, original);
    server.closeAllConnections();
    server.close();
  }
});
