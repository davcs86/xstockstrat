import { logs, SeverityNumber } from '@opentelemetry/api-logs';

type Level = 'info' | 'warn' | 'error';

const SEVERITY: Record<Level, { number: SeverityNumber; text: string }> = {
  info: { number: SeverityNumber.INFO, text: 'INFO' },
  warn: { number: SeverityNumber.WARN, text: 'WARN' },
  error: { number: SeverityNumber.ERROR, text: 'ERROR' },
};

// Only what the caller passes is exported; non-scalar values are stringified, never walked.
function toAttributes(detail: unknown): Record<string, string | number | boolean> | undefined {
  if (detail === undefined) return undefined;
  if (detail === null || typeof detail !== 'object') return { detail: String(detail) };
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (v === undefined) continue;
    out[k] =
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
  }
  return out;
}

function write(level: Level, message: string, detail?: unknown): void {
  // Same stdout line the call sites wrote before; the OTLP record is additional.
  if (detail === undefined) console[level](message);
  else console[level](message, detail);
  // Resolved per call: API 1.9 has no proxy provider, and this is a no-op when OTel is off.
  logs.getLogger('xstockstrat-ui').emit({
    severityNumber: SEVERITY[level].number,
    severityText: SEVERITY[level].text,
    body: message,
    attributes: toAttributes(detail),
  });
}

export const serverLog = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
};
