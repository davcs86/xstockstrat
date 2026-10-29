// LEDGER-8: runs on the LISTEN client: single-statement PK read / session SET only;
// never a transaction or bulk read.
import { Client, ClientConfig, QueryConfig } from 'pg';
import type { ConfigWatcher } from './configWatcher';

export const RESOLVE_TIMEOUT_KEY = 'ledger.stream.resolve_timeout_ms';

const DEFAULT_RESOLVE_TIMEOUT_MS = 2000;

const appliedTimeout = new WeakMap<object, number>();

export function streamResolveTimeoutMs(config: Pick<ConfigWatcher, 'getInt'>): number {
  const v = config.getInt(RESOLVE_TIMEOUT_KEY, DEFAULT_RESOLVE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_RESOLVE_TIMEOUT_MS;
}

export async function resolveEventRow(
  q: Pick<Client, 'query'>,
  stub: any,
  timeoutMs: number,
): Promise<any | null> {
  const queryTimeout = 2 * timeoutMs;
  if (appliedTimeout.get(q) !== timeoutMs) {
    const set: QueryConfig & { query_timeout?: number } = {
      text: `SET statement_timeout = ${timeoutMs}`,
      query_timeout: queryTimeout,
    };
    await q.query(set);
    appliedTimeout.set(q, timeoutMs);
  }
  const select: QueryConfig & { query_timeout?: number } = {
    text: 'SELECT * FROM ledger.events WHERE event_id = $1 AND recorded_at = $2::timestamptz',
    values: [stub.event_id, stub.recorded_at],
    query_timeout: queryTimeout,
  };
  const result = await q.query(select);
  return result.rows[0] ?? null;
}

export function makeListenerClient(
  connectionString: string,
  ssl: ClientConfig['ssl'],
  config: Pick<ConfigWatcher, 'getInt'>,
): () => Client {
  return () =>
    new Client({ connectionString, ssl, statement_timeout: streamResolveTimeoutMs(config) });
}

export function makeResolveRow(
  config: Pick<ConfigWatcher, 'getInt'>,
): (client: Pick<Client, 'query'>, stub: any) => Promise<any | null> {
  return (c, s) => resolveEventRow(c, s, streamResolveTimeoutMs(config));
}
