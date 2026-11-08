/**
 * Feature 294 final allowlist pass for the UI BFF (AC-41, AC-42). bffMetrics.ts writes its label keys
 * inline, so the allowed set is pinned here per instrument.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { recordAuthEvent, recordBffDuration, recordBffRequest } from '@/lib/bffMetrics';

class CollectingReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const ALLOWED_KEYS: Record<string, string[]> = {
  'ui.auth.events': ['event', 'reason'],
  'ui.bff.requests': ['rpc_service', 'rpc_method', 'outcome'],
  'http.server.duration': [
    'xstk.segment',
    'http.response.status_code',
    'http.route',
    'rpc.service',
  ],
};
const FORBIDDEN_KEYS = [
  'user_id',
  'email',
  'client_id',
  'account_id',
  'order_id',
  'intent_id',
  'symbol',
  'strategy_id',
  'stream_key',
  'slug',
  'category',
  'internal_caller',
  'secret',
  'api_key',
  'token',
];

function drive(): void {
  recordAuthEvent('login_ok');
  recordAuthEvent('jwt_rejected', 'expired');
  recordBffRequest('xstockstrat.trading.v1.TradingService', 'ListOrders', 503);
  recordBffDuration({
    segment: 'trader',
    route: '/api/orders',
    rpcService: 'xstockstrat.trading.v1.TradingService',
    status: 200,
    startMs: performance.now(),
  });
}

async function keysByInstrument(reader: CollectingReader): Promise<Map<string, Set<string>>> {
  const { resourceMetrics } = await reader.collect();
  const out = new Map<string, Set<string>>();
  for (const m of resourceMetrics.scopeMetrics.flatMap((sm) => sm.metrics)) {
    const keys = out.get(m.descriptor.name) ?? new Set<string>();
    for (const p of m.dataPoints) for (const k of Object.keys(p.attributes)) keys.add(k);
    out.set(m.descriptor.name, keys);
  }
  return out;
}

describe('BFF telemetry allowlist (feature 294)', () => {
  // Runs before any provider is installed: the global MeterProvider is the API no-op.
  it('@AC-42 every record call is a no-op without a MeterProvider', () => {
    expect(metrics.getMeterProvider().constructor.name).toBe('NoopMeterProvider');
    expect(drive).not.toThrow();
  });

  describe('with a collecting provider', () => {
    const reader = new CollectingReader();
    beforeAll(() => {
      const provider = new MeterProvider({ readers: [reader] });
      expect(metrics.setGlobalMeterProvider(provider)).toBe(true);
    });

    it('@AC-41 every collected key is allow-listed and none is an identifier', async () => {
      drive();
      const collected = await keysByInstrument(reader);
      for (const [name, allowed] of Object.entries(ALLOWED_KEYS)) {
        const keys = [...(collected.get(name) ?? [])];
        expect(keys.length, `${name} not collected`).toBeGreaterThan(0);
        for (const k of keys) {
          expect(allowed, `${name} carries key ${k}`).toContain(k);
          expect(FORBIDDEN_KEYS).not.toContain(k);
        }
      }
    });

    it('@AC-41 http.server.duration keeps its name and attribute keys', async () => {
      drive();
      const keys = (await keysByInstrument(reader)).get('http.server.duration');
      expect([...(keys ?? [])].sort()).toEqual([...ALLOWED_KEYS['http.server.duration']].sort());
    });
  });
});
