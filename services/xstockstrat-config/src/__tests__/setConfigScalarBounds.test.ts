/**
 * Server-side scalar-bounds enforcement for analysis.scoring.signal_decay_half_life_hours
 * (feature 161). Same in-process loopback gRPC harness as tradingStateValidation.test.ts — a real
 * grpc.Server + real service definition + real impl, dialled by the generated client with real
 * Metadata, so the guard is proven end-to-end over the wire (the fails.md 2026-07-27 rationale).
 *
 * The decay value is written as `floatVal` — the shape the agent's set_config actually sends. This
 * is the round-3 fail-open regression guard: a string-only bounds read would coerce a float_val to
 * '' → Number('') === 0 → pass unchecked, so an out-of-range floatVal that is REJECTED proves the
 * guard parses the float_val (via extractValueData), not string_val only.
 *
 * The recording pool returns a row for the existence SELECT so every case reaches the bounds guard
 * in front of an already-registered key, not confounded by the existence gate (feature 091).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_ACCESS_SCOPE, HEADER_USER_ID } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

const NS = 'analysis';
const KEY = 'scoring.signal_decay_half_life_hours';

describe('signal_decay_half_life_hours write-time scalar bounds', () => {
  let server: grpc.Server;
  let client: any;
  let queries: { sql: string; params?: unknown[] }[] = [];

  function insertQuery() {
    return queries.find((q) => q.sql.includes('INSERT INTO config.config_values'));
  }

  before(async () => {
    const recordingPool: any = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT is_secret FROM config.config_values')) {
          return { rows: [{ is_secret: false }] }; // registered, non-secret
        }
        return { rows: [] };
      },
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };

    server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(recordingPool) as unknown as grpc.UntypedServiceImplementation,
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

  function setConfig(value: Record<string, unknown>, key = KEY, namespace = NS) {
    const request = { namespace, key, value, author: 'tester', reason: 'bounds test' };
    const metadata = md({ [HEADER_ACCESS_SCOPE]: '7', [HEADER_USER_ID]: 'tester' }); // admin scope for a global write
    return new Promise<{ err: any; res: any }>((resolve) => {
      client.setConfig(request, metadata, (err: any, res: any) => resolve({ err, res }));
    });
  }

  it('accepts the min boundary 0 (disable decay) without create_key — AC-7', async () => {
    queries = [];
    const { err } = await setConfig({ floatVal: 0 });
    assert.equal(err, null, '0 is valid (min inclusive) — never a falsy-zero trap');
    assert.ok(insertQuery(), 'the INSERT must run for a valid value');
  });

  it('accepts a valid mid-range value 720', async () => {
    queries = [];
    const { err } = await setConfig({ floatVal: 720 });
    assert.equal(err, null);
    assert.ok(insertQuery());
  });

  it('rejects an above-max value 9000 with INVALID_ARGUMENT and writes nothing — AC-11', async () => {
    // Round-3 fail-open guard: a string-only read would coerce this float_val to 0 and pass.
    queries = [];
    const { err } = await setConfig({ floatVal: 9000 });
    assert.ok(err, 'expected a gRPC error for an out-of-range value');
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /\[0, 8760\]/);
    assert.equal(insertQuery(), undefined, 'no INSERT may run for an out-of-range value');
  });

  it('rejects a negative value -1 and writes nothing — AC-12', async () => {
    queries = [];
    const { err } = await setConfig({ floatVal: -1 });
    assert.ok(err);
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /\[0, 8760\]/);
    assert.equal(insertQuery(), undefined);
  });

  it('rejects a non-numeric value and writes nothing — AC-12', async () => {
    queries = [];
    const { err } = await setConfig({ stringVal: 'abc' });
    assert.ok(err, 'a non-numeric write to a scalar-bounded key must be rejected (NaN)');
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /\[0, 8760\]/);
    assert.equal(insertQuery(), undefined);
  });

  it('does not affect writes to a different, unbounded key', async () => {
    queries = [];
    const { err } = await setConfig({ floatVal: 99999 }, 'scoring.some_other_key');
    assert.equal(err, null, 'an unbounded key must be unaffected by the scalar-bounds guard');
    assert.ok(insertQuery());
  });

  // feature 177 FR-1: analysis.readiness.stale_after_seconds bounded [0, 86399] so a served-stale
  // readiness verdict never crosses a daily-bar boundary.
  const READINESS_KEY = 'readiness.stale_after_seconds';

  it('accepts readiness.stale_after_seconds = 0 (always stale) and = 86399 (max)', async () => {
    queries = [];
    assert.equal((await setConfig({ intVal: 0 }, READINESS_KEY)).err, null, '0 is valid (min inclusive)');
    assert.ok(insertQuery());
    queries = [];
    assert.equal((await setConfig({ intVal: 86399 }, READINESS_KEY)).err, null, '86399 is the inclusive max');
    assert.ok(insertQuery());
  });

  it('rejects readiness.stale_after_seconds = 86400 (crosses the daily-bar boundary)', async () => {
    queries = [];
    const { err } = await setConfig({ intVal: 86400 }, READINESS_KEY);
    assert.ok(err, 'expected a gRPC error for an out-of-range value');
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /\[0, 86399\]/);
    assert.equal(insertQuery(), undefined, 'no INSERT may run for an out-of-range value');
  });

  // feature 182: the analysis.readiness_materializer.* keys are seeded with a FULL-DOTTED `key` column
  // (migration 027) so the analysis reader's exact-string lookup resolves them. These write-bounds are
  // therefore keyed on the natural full-dotted name and depend on the robust two-operand registry lookup
  // (bare `key` first, then `${namespace}.${key}`). Sent with the full-dotted key the same way config-ui
  // echoes the DB `key` column.
  const RM_REFRESH = 'analysis.readiness_materializer.refresh_hour_utc'; // [0,23]
  const RM_WINDOW = 'analysis.readiness_materializer.valid_window_hours'; // [1,168]
  const RM_CONC = 'analysis.readiness_materializer.max_concurrent_bars_fetches'; // [1,5]
  const RM_ENABLED = 'analysis.readiness_materializer.enabled'; // bool, unbounded

  it('accepts in-bounds readiness_materializer tuning writes without create_key — AC-7, AC-5', async () => {
    // AC-5: the request carries no create_key; reaching the INSERT proves the registered (seeded) row
    // satisfies the existence gate — the recording pool's {is_secret:false} row models the seed.
    queries = [];
    assert.equal((await setConfig({ intVal: 6 }, RM_REFRESH)).err, null, 'refresh_hour_utc=6 in [0,23]');
    assert.ok(insertQuery(), 'a valid in-bounds write must reach the INSERT (registered, no create_key)');
    queries = [];
    assert.equal((await setConfig({ intVal: 5 }, RM_CONC)).err, null, 'max_concurrent_bars_fetches=5 (inclusive max)');
    assert.ok(insertQuery());
    queries = [];
    assert.equal((await setConfig({ intVal: 168 }, RM_WINDOW)).err, null, 'valid_window_hours=168 (inclusive max)');
    assert.ok(insertQuery());
  });

  it('rejects out-of-bounds readiness_materializer writes with INVALID_ARGUMENT, nothing written — AC-8', async () => {
    // The feature-141 SEV-2 guard: an operator cannot set concurrency above marketdata's pool ceiling.
    queries = [];
    let r = await setConfig({ intVal: 10000 }, RM_CONC);
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'concurrency 10000 must be rejected');
    assert.match(r.err.details ?? r.err.message, /\[1, 5\]/);
    assert.equal(insertQuery(), undefined, 'no INSERT for an out-of-range value');
    queries = [];
    r = await setConfig({ intVal: 0 }, RM_CONC); // below-min: 0 is not "unlimited", it is out of [1,5]
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'concurrency 0 is below min');
    assert.match(r.err.details ?? r.err.message, /\[1, 5\]/);
    assert.equal(insertQuery(), undefined);
    queries = [];
    r = await setConfig({ intVal: 99 }, RM_REFRESH);
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'refresh_hour_utc 99 is out of [0,23]');
    assert.match(r.err.details ?? r.err.message, /\[0, 23\]/);
    assert.equal(insertQuery(), undefined);
    queries = [];
    r = await setConfig({ intVal: 0 }, RM_WINDOW); // below-min: reader clamps 1h, the write edge rejects 0
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'valid_window_hours 0 is below min');
    assert.match(r.err.details ?? r.err.message, /\[1, 168\]/);
    assert.equal(insertQuery(), undefined);
  });

  it('leaves the unbounded enabled key unaffected — bounds are write-edge only — AC-9', async () => {
    // Bounds are a write-edge guard on the three numeric keys only; they touch no WatchConfig/GetConfig
    // read path and no other key. enabled has no numeric bound, so a boolVal write is always accepted.
    queries = [];
    const { err } = await setConfig({ boolVal: true }, RM_ENABLED);
    assert.equal(err, null, 'enabled is a bool with no numeric bound — accepted');
    assert.ok(insertQuery(), 'the enabled write must reach the INSERT');
  });

  // feature 184: the analysis.opportunity.* keys are seeded full-dotted (migration 028) and gain
  // write-side SCALAR_BOUNDS_REGISTRY bounds on the justified footgun set. Sent full-dotted, the same
  // way config-ui echoes the DB `key` column, and resolved by the two-operand registry lookup.
  const OPP_REFRESH = 'analysis.opportunity.refresh_hour_utc'; // [0,23], lower-0 legitimate (midnight)
  const OPP_CONC = 'analysis.opportunity.max_concurrent_bars_fetches'; // [1,5], feature-141 SEV-2 guard
  const OPP_WEIGHT = 'analysis.opportunity.signal_rank_weight'; // [0,1] float, lower-0 legitimate
  const OPP_UNIVERSE = 'analysis.opportunity.max_universe_size'; // [1,1000]

  it('rejects out-of-bounds opportunity tuning writes with INVALID_ARGUMENT, nothing written — AC-4', async () => {
    queries = [];
    let r = await setConfig({ intVal: 10000 }, OPP_CONC);
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'max_concurrent_bars_fetches 10000 must be rejected');
    assert.match(r.err.details ?? r.err.message, /\[1, 5\]/);
    assert.equal(insertQuery(), undefined, 'no INSERT for an out-of-range value');
    queries = [];
    r = await setConfig({ intVal: 0 }, OPP_CONC); // feature 244 @AC-8: the reader honours 0, so the write edge must reject it
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'max_concurrent_bars_fetches 0 is below min');
    assert.match(r.err.details ?? r.err.message, /\[1, 5\]/);
    assert.equal(insertQuery(), undefined);
    queries = [];
    r = await setConfig({ intVal: 99 }, OPP_REFRESH);
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'refresh_hour_utc 99 is out of [0,23]');
    assert.match(r.err.details ?? r.err.message, /\[0, 23\]/);
    assert.equal(insertQuery(), undefined);
    queries = [];
    // floatVal is the wire shape the agent sends for a float key — the round-3 fail-open guard.
    r = await setConfig({ floatVal: 1.5 }, OPP_WEIGHT);
    assert.equal(r.err?.code, grpc.status.INVALID_ARGUMENT, 'signal_rank_weight 1.5 is out of [0,1]');
    assert.match(r.err.details ?? r.err.message, /\[0, 1\]/);
    assert.equal(insertQuery(), undefined);
  });

  it('accepts an in-bounds opportunity write without create_key — AC-5', async () => {
    // AC-5: the request carries no create_key; reaching the INSERT proves the seeded row satisfies the
    // existence gate (the recording pool's {is_secret:false} row models the migration-028 seed).
    queries = [];
    const { err } = await setConfig({ intVal: 50 }, OPP_UNIVERSE);
    assert.equal(err, null, 'max_universe_size=50 in [1,1000]');
    assert.ok(insertQuery(), 'a valid in-bounds write must reach the INSERT (registered, no create_key)');
    queries = [];
    assert.equal((await setConfig({ intVal: 5 }, OPP_CONC)).err, null, 'max_concurrent_bars_fetches=5 (inclusive max)');
    assert.ok(insertQuery());
  });

  it('accepts a bounded key whose lower edge is a legitimate 0 — AC-8', async () => {
    // The C-16 guard the whole lower-bound split rests on: a min>=1 on these two keys would silently
    // make a currently-settable, documented value unsettable. refresh_hour_utc=0 is midnight;
    // signal_rank_weight=0 is a valid weight within [0,1].
    queries = [];
    assert.equal((await setConfig({ intVal: 0 }, OPP_REFRESH)).err, null, 'refresh_hour_utc=0 (midnight) is accepted');
    assert.ok(insertQuery(), 'the lower-edge-0 write must reach the INSERT');
    queries = [];
    assert.equal((await setConfig({ floatVal: 0 }, OPP_WEIGHT)).err, null, 'signal_rank_weight=0 is accepted (min inclusive)');
    assert.ok(insertQuery());
  });

  // features 227/229/231: read-path timeout, quote-window/retention and mark keys must be bounded under both
  // key-column forms (G8), so the nested budgets and the 31d retention > 720h lookback floor survive any write.
  const TIMEOUT_KEY_FORMS: { ns: string; key: string; field: 'intVal' | 'floatVal'; min: number; max: number }[] = [
    { ns: 'analysis', key: 'opportunity.read_db_budget_ms', field: 'intVal', min: 1000, max: 20000 },
    { ns: 'analysis', key: 'analysis.opportunity.read_db_budget_ms', field: 'intVal', min: 1000, max: 20000 },
    { ns: 'analysis', key: 'opportunity.live_enrich_timeout_ms', field: 'intVal', min: 500, max: 4000 },
    { ns: 'analysis', key: 'analysis.opportunity.live_enrich_timeout_ms', field: 'intVal', min: 500, max: 4000 },
    { ns: 'marketdata', key: 'price.batch_timeout_ms', field: 'intVal', min: 500, max: 2500 },
    { ns: 'marketdata', key: 'marketdata.price.batch_timeout_ms', field: 'intVal', min: 500, max: 2500 },
    { ns: 'agent', key: 'opportunities.read_timeout_seconds', field: 'floatVal', min: 30, max: 55 },
    { ns: 'agent', key: 'agent.opportunities.read_timeout_seconds', field: 'floatVal', min: 30, max: 55 },
    { ns: 'portfolio', key: 'marketdata.quote_timeout_ms', field: 'intVal', min: 500, max: 8000 },
    { ns: 'portfolio', key: 'portfolio.marketdata.quote_timeout_ms', field: 'intVal', min: 500, max: 8000 },
    { ns: 'marketdata', key: 'quotes.latest_lookback_hours', field: 'intVal', min: 24, max: 720 },
    { ns: 'marketdata', key: 'marketdata.quotes.latest_lookback_hours', field: 'intVal', min: 24, max: 720 },
    { ns: 'marketdata', key: 'quotes.batch_timeout_ms', field: 'intVal', min: 500, max: 5000 },
    { ns: 'marketdata', key: 'marketdata.quotes.batch_timeout_ms', field: 'intVal', min: 500, max: 5000 },
    { ns: 'marketdata', key: 'retention.quotes_days', field: 'intVal', min: 31, max: 3650 },
    { ns: 'marketdata', key: 'marketdata.retention.quotes_days', field: 'intVal', min: 31, max: 3650 },
    { ns: 'marketdata', key: 'quotes.mark_timeout_ms', field: 'intVal', min: 100, max: 2500 },
    { ns: 'marketdata', key: 'marketdata.quotes.mark_timeout_ms', field: 'intVal', min: 100, max: 2500 },
    { ns: 'marketdata', key: 'quotes.mark_close_max_age_hours', field: 'intVal', min: 120, max: 720 },
    { ns: 'marketdata', key: 'marketdata.quotes.mark_close_max_age_hours', field: 'intVal', min: 120, max: 720 },
    { ns: 'portfolio', key: 'marketdata.last_close_lookback_days', field: 'intVal', min: 5, max: 60 },
    { ns: 'portfolio', key: 'portfolio.marketdata.last_close_lookback_days', field: 'intVal', min: 5, max: 60 },
  ];

  for (const { ns, key, field, min, max } of TIMEOUT_KEY_FORMS) {
    it(`accepts ${ns}/${key} at its bounds [${min}, ${max}]`, async () => {
      for (const v of [min, max]) {
        queries = [];
        assert.equal((await setConfig({ [field]: v }, key, ns)).err, null, `${v} is inside [${min}, ${max}]`);
        assert.ok(insertQuery(), `an in-bounds write of ${v} must reach the INSERT`);
      }
    });

    it(`rejects ${ns}/${key} just outside [${min}, ${max}] and writes nothing`, async () => {
      for (const v of [min - 1, max + 1]) {
        queries = [];
        const { err } = await setConfig({ [field]: v }, key, ns);
        assert.equal(err?.code, grpc.status.INVALID_ARGUMENT, `${v} must be rejected`);
        assert.match(err.details ?? err.message, new RegExp(`\\[${min}, ${max}\\]`));
        assert.equal(insertQuery(), undefined, `no INSERT for out-of-range ${v}`);
      }
    });
  }

  it('bounds the float agent timeout key when written as an intVal too', async () => {
    queries = [];
    assert.equal((await setConfig({ intVal: 30 }, 'opportunities.read_timeout_seconds', 'agent')).err, null);
    assert.ok(insertQuery());
    queries = [];
    const { err } = await setConfig({ intVal: 56 }, 'opportunities.read_timeout_seconds', 'agent');
    assert.equal(err?.code, grpc.status.INVALID_ARGUMENT, 'intVal 56 is above the 55s ceiling');
    assert.match(err.details ?? err.message, /\[30, 55\]/);
    assert.equal(insertQuery(), undefined);
  });
});
