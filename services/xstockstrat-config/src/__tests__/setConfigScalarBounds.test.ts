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

import { HEADER_ACCESS_SCOPE } from '../grpc/authz';
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

  function setConfig(value: Record<string, unknown>, key = KEY) {
    const request = { namespace: NS, key, value, author: 'tester', reason: 'bounds test' };
    const metadata = md({ [HEADER_ACCESS_SCOPE]: '7' }); // admin scope for a global write
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
    assert.equal(insertQuery(), undefined);
  });

  it('rejects a non-numeric value and writes nothing — AC-12', async () => {
    queries = [];
    const { err } = await setConfig({ stringVal: 'abc' });
    assert.ok(err, 'a non-numeric write to a scalar-bounded key must be rejected (NaN)');
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
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
});
