/**
 * Form-tolerant SetConfig (feature 295 FR-1): a write in either key spelling lands on the stored row,
 * grants and bounds match on the canonical key, an ambiguous spelling is refused, and a table
 * constraint violation maps to INVALID_ARGUMENT. Real loopback gRPC server over an in-memory pool.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_ACCESS_SCOPE, HEADER_USER_ID } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

interface Row {
  namespace: string;
  key: string;
  environment: string;
  user_id: string | null;
  value_data: string;
  is_secret: boolean;
}

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

const ADMIN = { [HEADER_ACCESS_SCOPE]: '7', [HEADER_USER_ID]: 'tester' };
const ENV = 'staging'; // resolveEnv's default for an unset request environment

function row(namespace: string, key: string, value: string, userId: string | null = null): Row {
  return { namespace, key, environment: ENV, user_id: userId, value_data: value, is_secret: false };
}

function param(sql: string, params: unknown[], re: RegExp): unknown {
  const m = sql.match(re);
  return m ? params[Number(m[1]) - 1] : undefined;
}

/** Evaluates the config_values WHERE shapes SetConfig issues: `key = $n` or `key IN ($n, $m)`, exact or global scope. */
function selectRows(store: Row[], sql: string, params: unknown[]): Row[] {
  const ns = param(sql, params, /namespace\s*=\s*\$(\d+)/i);
  const env = param(sql, params, /environment\s*=\s*\$(\d+)/i);
  const inList = sql.match(/\bkey\s+IN\s*\(([^)]*)\)/i);
  const keys = inList
    ? [...inList[1].matchAll(/\$(\d+)/g)].map((m) => params[Number(m[1]) - 1])
    : [param(sql, params, /\bkey\s*=\s*\$(\d+)/i)];
  let userMatch: (r: Row) => boolean;
  if (/user_id\s+IS\s+NULL/i.test(sql)) {
    userMatch = (r) => r.user_id === null;
  } else {
    const uid = param(
      sql,
      params,
      /COALESCE\(\s*user_id\s*,\s*''\s*\)\s*=\s*COALESCE\(\s*\$(\d+)/i,
    );
    userMatch = (r) => (r.user_id ?? '') === ((uid as string | null) ?? '');
  }
  const hits = store.filter(
    (r) => r.namespace === ns && keys.includes(r.key) && r.environment === env && userMatch(r),
  );
  const limit = sql.match(/LIMIT\s+(\d+)/i);
  return limit ? hits.slice(0, Number(limit[1])) : hits;
}

describe('form-tolerant SetConfig — spelling, canonical grants/bounds, error mapping', () => {
  let server: grpc.Server;
  let client: any;
  let store: Row[] = [];
  let queries: { sql: string; params: unknown[] }[] = [];
  let insertError: unknown = null;

  const inserts = () => queries.filter((q) => q.sql.includes('INSERT INTO config.config_values'));
  const find = (ns: string, key: string, userId: string | null = null) =>
    store.filter((r) => r.namespace === ns && r.key === key && r.user_id === userId);

  before(async () => {
    const pool: any = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO config.config_values')) {
          if (insertError) throw insertError;
          const cols = sql
            .match(/config\.config_values\s*\(([^)]*)\)/)![1]
            .split(',')
            .map((c) => c.trim());
          const v = (c: string) => params[cols.indexOf(c)];
          const r: Row = {
            namespace: v('namespace') as string,
            key: v('key') as string,
            environment: v('environment') as string,
            user_id: (v('user_id') as string | null) ?? null,
            value_data: v('value_data') as string,
            is_secret: v('is_secret') === true,
          };
          const hit = store.find(
            (s) =>
              s.namespace === r.namespace &&
              s.key === r.key &&
              s.environment === r.environment &&
              (s.user_id ?? '') === (r.user_id ?? ''),
          );
          if (hit) Object.assign(hit, r);
          else store.push(r);
          return { rows: [] };
        }
        if (/^\s*SELECT\b[\s\S]*FROM config\.config_values/i.test(sql)) {
          return { rows: selectRows(store, sql, params) };
        }
        return { rows: [] };
      },
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };

    server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(pool) as unknown as grpc.UntypedServiceImplementation,
    );
    const port: number = await new Promise((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
        err ? reject(err) : resolve(p),
      );
    });
    const { ConfigServiceClient } = await import('@xstockstrat/proto/config/v1/config');
    client = new ConfigServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });

  after(() => {
    client?.close();
    server?.forceShutdown();
  });

  beforeEach(() => {
    store = [];
    queries = [];
    insertError = null;
  });

  function setConfig(
    namespace: string,
    key: string,
    value: Record<string, unknown>,
    headers: Record<string, string> = ADMIN,
    userId = '',
    extra: Record<string, unknown> = {},
  ) {
    const request = { namespace, key, value, userId, reason: 'spelling test', ...extra };
    return new Promise<{ err: any; res: any }>((resolve) => {
      client.setConfig(request, md(headers), (err: any, res: any) => resolve({ err, res }));
    });
  }

  it('@AC-1 a prefixed key is refused before any authz or DB call', async () => {
    store = [row('marketdata', 'backfill.batch_size', '1000')];
    const { err } = await setConfig('marketdata', 'marketdata.backfill.batch_size', { intVal: 500 });
    assert.equal(err?.code, grpc.status.INVALID_ARGUMENT);
    assert.match(
      err.details ?? err.message,
      /must be namespace-relative: send "backfill\.batch_size" with namespace "marketdata"/,
    );
    assert.equal(queries.length, 0, 'the pre-check runs before any authz or DB call');
    assert.equal(inserts().length, 0);
  });

  it('@AC-1 a relative write updates the stored relative row, globally and per-user', async () => {
    store = [row('marketdata', 'backfill.batch_size', '1000')];

    const admin = await setConfig('marketdata', 'backfill.batch_size', { intVal: 500 });
    assert.equal(admin.err, null);
    assert.equal(inserts().length, 1);
    assert.equal(inserts()[0].params[1], 'backfill.batch_size');
    assert.equal(find('marketdata', 'backfill.batch_size')[0]?.value_data, '500');

    queries = [];
    const user = await setConfig(
      'marketdata',
      'backfill.batch_size',
      { intVal: 700 },
      { [HEADER_USER_ID]: 'u-1' },
      'u-1',
    );
    assert.equal(user.err, null, 'a first per-user override of the global row is allowed');
    assert.equal(find('marketdata', 'backfill.batch_size', 'u-1')[0]?.value_data, '700');
    assert.equal(find('marketdata', 'backfill.batch_size')[0]?.value_data, '500');
  });

  it('@AC-1 create_key with a prefixed key is refused', async () => {
    const { err } = await setConfig(
      'marketdata',
      'marketdata.backfill.batch_size',
      { intVal: 500 },
      ADMIN,
      '',
      { createKey: true },
    );
    assert.equal(err?.code, grpc.status.INVALID_ARGUMENT);
    assert.equal(inserts().length, 0);
  });

  const POLLER = { 'x-internal-caller': 'trading-reconciliation-poller' };

  it('@AC-5 the previous-image poller key is canonicalised, with a WARN', async (t) => {
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    t.mock.method(process.stdout, 'write', (chunk: any, ...rest: any[]) => {
      out.push(String(chunk));
      return write(chunk, ...rest);
    });
    store = [row('platform', 'trading_state', 'ACTIVE')];
    const { err } = await setConfig(
      'platform',
      'platform.trading_state',
      { stringVal: 'REDUCE_ONLY' },
      POLLER,
    );
    assert.equal(err, null, 'the poller exception must let the write through');
    assert.equal(inserts()[0].params[1], 'trading_state', 'the row is written under the relative key');
    assert.equal(find('platform', 'trading_state')[0]?.value_data, 'REDUCE_ONLY');
    assert.ok(
      out.some((l) => l.includes('SetConfig canonicalised internal-caller key')),
      'a WARN records the canonicalisation',
    );
  });

  it('@AC-5 the poller exception does not widen the direction restriction', async () => {
    store = [row('platform', 'trading_state', 'HALTED')];
    const { err } = await setConfig(
      'platform',
      'platform.trading_state',
      { stringVal: 'ACTIVE' },
      POLLER,
    );
    assert.equal(err?.code, grpc.status.PERMISSION_DENIED);
    assert.equal(inserts().length, 0);
  });

  for (const [label, ns, key, userId, extra] of [
    ['create_key', 'platform', 'platform.trading_state', '', { createKey: true }],
    ['a per-user target', 'platform', 'platform.trading_state', 'u-1', {}],
    ['another namespace', 'marketdata', 'marketdata.trading_state', '', {}],
  ] as const) {
    it(`@AC-1 the poller exception does not cover ${label}`, async () => {
      store = [row(ns, key.slice(ns.length + 1), 'ACTIVE')];
      const { err } = await setConfig(ns, key, { stringVal: 'REDUCE_ONLY' }, POLLER, userId, extra);
      assert.equal(err?.code, grpc.status.INVALID_ARGUMENT);
      assert.equal(inserts().length, 0);
    });
  }

  it('@AC-25 the internal-caller grant matches the relative trading_state spelling', async () => {
    store = [row('platform', 'trading_state', 'ACTIVE')];
    const { err } = await setConfig(
      'platform',
      'trading_state',
      { stringVal: 'REDUCE_ONLY' },
      {
        'x-internal-caller': 'trading-reconciliation-poller',
      },
    );
    assert.equal(err, null, 'the grant must match on the canonical key');
    assert.equal(find('platform', 'trading_state')[0]?.value_data, 'REDUCE_ONLY');
  });

  it('@AC-25 an admin write of opportunity.max_universe_size = 0 hits the [1, 1000] bound', async () => {
    store = [row('analysis', 'opportunity.max_universe_size', '200')];
    const { err } = await setConfig('analysis', 'opportunity.max_universe_size', { intVal: 0 });
    assert.equal(err?.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /\[1, 1000\]/);
    assert.equal(inserts().length, 0);
  });

  const NEW_BOUNDS: { ns: string; key: string; min: number; max: number }[] = [
    { ns: 'indicators', key: 'sandbox.timeout_ms', min: 100, max: 33000 },
    { ns: 'indicators', key: 'sandbox.startup_grace_ms', min: 1000, max: 10000 },
    { ns: 'analysis', key: 'compute.max_worker_threads', min: 1, max: 16 },
  ];

  it('@AC-31 indicators.sandbox.timeout_ms = 40000 is rejected by the [100, 33000] bound', async () => {
    store = [row('indicators', 'sandbox.timeout_ms', '5000')];
    const { err } = await setConfig('indicators', 'sandbox.timeout_ms', {
      intVal: 40000,
    });
    assert.equal(err?.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /\[100, 33000\]/);
    assert.equal(inserts().length, 0);
  });

  for (const { ns, key, min, max } of NEW_BOUNDS) {
    {
      const k = key;
      it(`@AC-31 bounds ${ns}/${k} to [${min}, ${max}]`, async () => {
        for (const v of [min - 1, max + 1]) {
          store = [row(ns, key, String(min))];
          queries = [];
          const { err } = await setConfig(ns, k, { intVal: v });
          assert.equal(err?.code, grpc.status.INVALID_ARGUMENT, `${v} must be rejected`);
          assert.match(err.details ?? err.message, new RegExp(`\\[${min}, ${max}\\]`));
          assert.equal(inserts().length, 0, `no INSERT for out-of-range ${v}`);
        }
        for (const v of [min, max]) {
          store = [row(ns, key, String(min))];
          queries = [];
          assert.equal(
            (await setConfig(ns, k, { intVal: v })).err,
            null,
            `${v} is inside [${min}, ${max}]`,
          );
          assert.equal(
            find(ns, key)[0]?.value_data,
            String(v),
            'the stored row holds the in-bounds value',
          );
        }
      });
    }
  }

  it('@AC-34 refuses an admin write when both global spellings exist', async () => {
    store = [
      row('analysis', 'backtest.max_duration_seconds', '300'),
      row('analysis', 'analysis.backtest.max_duration_seconds', '60'),
    ];
    const before = JSON.stringify(store);
    const { err } = await setConfig('analysis', 'backtest.max_duration_seconds', { intVal: 90 });
    assert.equal(err?.code, grpc.status.FAILED_PRECONDITION);
    const msg = err.details ?? err.message;
    assert.ok(msg.includes('analysis.backtest.max_duration_seconds'), msg);
    assert.match(msg, /(^|[^.\w])backtest\.max_duration_seconds/, msg);
    assert.equal(inserts().length, 0, 'no write');
    assert.equal(JSON.stringify(store), before, 'no row changes');
  });

  it('@AC-34 refuses a per-user write whose spelling differs from the global row', async () => {
    store = [
      row('analysis', 'analysis.backtest.max_duration_seconds', '60'),
      row('analysis', 'backtest.max_duration_seconds', '300', 'u-1'),
    ];
    const before = JSON.stringify(store);
    const { err } = await setConfig(
      'analysis',
      'backtest.max_duration_seconds',
      { intVal: 90 },
      { [HEADER_USER_ID]: 'u-1' },
      'u-1',
    );
    assert.equal(err?.code, grpc.status.FAILED_PRECONDITION);
    const msg = err.details ?? err.message;
    assert.ok(msg.includes('analysis.backtest.max_duration_seconds'), msg);
    assert.match(msg, /(^|[^.\w])backtest\.max_duration_seconds/, msg);
    assert.equal(inserts().length, 0, 'no write');
    assert.equal(JSON.stringify(store), before, 'no row changes');
  });

  for (const [pgCode, grpcCode] of [
    ['23514', grpc.status.INVALID_ARGUMENT],
    ['23505', grpc.status.INVALID_ARGUMENT],
    ['08006', grpc.status.INTERNAL],
  ] as const) {
    it(`@AC-35 an upsert failing with pg code ${pgCode} returns gRPC ${grpcCode}`, async () => {
      store = [row('marketdata', 'backfill.batch_size', '1000')];
      insertError = Object.assign(new Error(`pg error ${pgCode}`), { code: pgCode });
      const { err } = await setConfig('marketdata', 'backfill.batch_size', {
        intVal: 500,
      });
      assert.equal(inserts().length, 1, 'the upsert was attempted');
      assert.equal(err?.code, grpcCode);
    });
  }
});
