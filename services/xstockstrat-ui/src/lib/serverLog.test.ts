import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { logs } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { serverLog } from './serverLog';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// Runs first: the global LoggerProvider is set-once per process, so "OTel off" must precede it.
test('with no provider installed it only writes the console line', () => {
  serverLog.error('[login] identity service error:', 'stack text');
  expect(console.error).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith('[login] identity service error:', 'stack text');
});

const exporter = new InMemoryLogRecordExporter();

test('the stdout line equals the prior console call, and the record carries message + attributes', () => {
  logs.setGlobalLoggerProvider(
    new LoggerProvider({ processors: [new SimpleLogRecordProcessor(exporter)] }),
  );
  const detail = { traceId: 't-1', code: '57P01', message: 'boom' };
  serverLog.error('config-ui audit: database error', detail);
  expect(console.error).toHaveBeenCalledWith('config-ui audit: database error', detail);

  serverLog.warn('only a message');
  expect(console.warn).toHaveBeenCalledWith('only a message');

  const [first, second] = exporter.getFinishedLogRecords();
  expect(first.body).toBe('config-ui audit: database error');
  expect(first.severityText).toBe('ERROR');
  expect(first.attributes).toEqual(detail);
  expect(second.severityText).toBe('WARN');
  expect(second.attributes).toEqual({});
});

test('non-scalar attribute values are stringified, never walked', () => {
  exporter.reset();
  serverLog.info('shape', { n: 1, ok: true, nested: { a: 1 }, skipped: undefined });
  const [record] = exporter.getFinishedLogRecords();
  expect(record.attributes).toEqual({ n: 1, ok: true, nested: '[object Object]' });
});
