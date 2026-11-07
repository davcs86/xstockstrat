import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';

// Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
const BUCKETS_MS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

export type BffSegment = 'trader' | 'insights' | 'config-ui' | 'accounts' | 'auth';

export type AuthEvent =
  | 'login_invalid_request'
  | 'login_ok'
  | 'login_failed'
  | 'login_error'
  | 'refresh_missing'
  | 'refresh_ok'
  | 'refresh_rejected'
  | 'refresh_error'
  | 'logout'
  | 'jwt_rejected';
export type JwtRejectReason = 'no_secret' | 'expired' | 'invalid';
type BffOutcome = 'ok' | 'client_error' | 'server_error';

// API 1.9 has no proxy MeterProvider, so bind on use and rebind if the global provider changes.
function rebinding<T>(create: (meter: Meter) => T): () => T {
  let instrument: T | undefined;
  let boundTo: unknown;
  return () => {
    const provider = metrics.getMeterProvider();
    if (instrument === undefined || boundTo !== provider) {
      boundTo = provider;
      instrument = create(metrics.getMeter('xstockstrat-ui'));
    }
    return instrument;
  };
}

const bffHistogram = rebinding<Histogram>((meter) =>
  meter.createHistogram('http.server.duration', {
    unit: 'ms',
    advice: { explicitBucketBoundaries: BUCKETS_MS },
  }),
);
const authEvents = rebinding<Counter>((meter) => meter.createCounter('ui.auth.events'));
const bffRequests = rebinding<Counter>((meter) => meter.createCounter('ui.bff.requests'));

/** Counts one auth event. Never carries a user id, email or token. */
export function recordAuthEvent(event: AuthEvent, reason?: JwtRejectReason): void {
  authEvents().add(1, reason ? { event, reason } : { event });
}

/** Counts one unary Connect BFF call by method; kept off the histogram so it gains no new key. */
export function recordBffRequest(rpcService: string, rpcMethod: string, status: number): void {
  const outcome: BffOutcome =
    status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'ok';
  bffRequests().add(1, { rpc_service: rpcService, rpc_method: rpcMethod, outcome });
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
