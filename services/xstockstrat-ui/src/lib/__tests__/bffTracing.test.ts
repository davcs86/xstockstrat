/**
 * BFF → backend trace continuity + upstream-error logging: the dispatch span's W3C traceparent rides
 * the outbound gRPC headers, and a 5xx dispatch writes one `bff upstream error` server log.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { tracing, node } from '@opentelemetry/sdk-node';
import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';

vi.mock('@/lib/auth', () => ({
  verifyAccessToken: vi.fn(async () => ({
    user_id: 'u1',
    roles: ['user'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
  rolesToAccessScope: vi.fn(() => 7),
  generateTraceId: vi.fn(() => 'trace-test'),
  hasAdminScope: vi.fn(() => false),
}));

const warn = vi.fn();
vi.mock('@/lib/serverLog', () => ({
  serverLog: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() },
}));

import { createBffRouter, createDispatch, forward } from '@/lib/bffShared';

const exporter = new tracing.InMemorySpanExporter();
const backend = vi.fn();

const router = createBffRouter();
router.service(MarketDataService, {
  getBars: forward((req, opts) => backend(req, opts)),
});
const dispatch = createDispatch(router, '/t/api');

function getBars(): Request {
  return new Request('http://localhost/t/api/xstockstrat.marketdata.v1.MarketDataService/GetBars', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'access_token=t' },
    body: '{"symbol":"AAPL"}',
  });
}

beforeAll(() => {
  // Registers the async context manager and the W3C propagator, as NodeSDK does in production.
  new node.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
  }).register();
});

beforeEach(() => {
  exporter.reset();
  warn.mockReset();
  backend.mockReset();
});

describe('BFF dispatch tracing', () => {
  it('sends the dispatch span as the outbound traceparent', async () => {
    backend.mockResolvedValue({ bars: [] });

    const res = await dispatch(getBars());

    expect(res.status).toBe(200);
    const headers = backend.mock.calls[0][1].headers as Headers;
    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe('xstockstrat.marketdata.v1.MarketDataService/GetBars');
    expect(headers.get('traceparent')).toContain(span.spanContext().traceId);
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a 5xx upstream failure with service, method and status', async () => {
    backend.mockRejectedValue(new ConnectError('pool exhausted', Code.Unavailable));

    const res = await dispatch(getBars());

    expect(res.status).toBe(503);
    expect(warn).toHaveBeenCalledWith(
      'bff upstream error',
      expect.objectContaining({
        rpc_service: 'xstockstrat.marketdata.v1.MarketDataService',
        rpc_method: 'GetBars',
        status: 503,
      }),
    );
  });
});
