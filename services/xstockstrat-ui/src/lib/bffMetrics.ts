import { metrics } from '@opentelemetry/api';
import type { Histogram } from '@opentelemetry/api';

// Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
const BUCKETS_MS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

export type BffSegment = 'trader' | 'insights' | 'config-ui' | 'accounts';

let histogram: Histogram | undefined;
let boundTo: unknown;

// API 1.9 has no proxy MeterProvider, so bind on use and rebind if the global provider changes.
function bffHistogram(): Histogram {
  const provider = metrics.getMeterProvider();
  if (!histogram || boundTo !== provider) {
    boundTo = provider;
    histogram = metrics.getMeter('xstockstrat-ui').createHistogram('http.server.duration', {
      unit: 'ms',
      advice: { explicitBucketBoundaries: BUCKETS_MS },
    });
  }
  return histogram;
}

/** Records one BFF request. Labels are bounded: never user ids, symbols or raw paths. */
export function recordBffDuration(opts: {
  segment: string;
  route?: string;
  rpcService?: string;
  status: number;
  startMs: number;
}): void {
  const attributes: Record<string, string | number> = {
    'xstk.segment': opts.segment,
    'http.response.status_code': opts.status,
  };
  if (opts.route) attributes['http.route'] = opts.route;
  if (opts.rpcService) attributes['rpc.service'] = opts.rpcService;
  bffHistogram().record(performance.now() - opts.startMs, attributes);
}

/** Wraps a REST route handler; `route` is the static template, recorded as `http.route`. */
export function withBffMetrics<A extends unknown[]>(
  segment: BffSegment,
  route: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const startMs = performance.now();
    let status = 500;
    try {
      const res = await handler(...args);
      status = res.status;
      return res;
    } finally {
      recordBffDuration({ segment, route, status, startMs });
    }
  };
}
