// Unit tests for the stub→row resolver — a recording fake stands in for pg.Client; no real DB.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { makeEventRow, toTrimmedStub } from './fixtures/ledgerEvents';

let resolveEventRow: any;
let streamResolveTimeoutMs: any;
let makeListenerClient: any;

// This import must throw on failure — never wrap it or early-return on a missing subject;
// a swallowed import turns every case into a silent pass.
before(async () => {
  const mod = await import('../services/eventRowResolver.js');
  resolveEventRow = mod.resolveEventRow;
  streamResolveTimeoutMs = mod.streamResolveTimeoutMs;
  makeListenerClient = mod.makeListenerClient;
});

const STUB = toTrimmedStub(makeEventRow());

function makeFakeClient(opts: { rows?: any[]; selectError?: any } = {}) {
  const calls: any[] = [];
  return {
    calls,
    async query(cfg: any) {
      calls.push(cfg);
      if (/^SET statement_timeout/.test(cfg.text)) return { rows: [] };
      if (opts.selectError) throw opts.selectError;
      return { rows: opts.rows ?? [] };
    },
  };
}

const selects = (calls: any[]) => calls.filter((c) => /^SELECT/.test(c.text));
const sets = (calls: any[]) => calls.filter((c) => /^SET statement_timeout/.test(c.text));

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.strictEqual(
      typeof resolveEventRow,
      'function',
      'resolveEventRow must import — never skip silently',
    );
  });
});

describe('resolveEventRow', () => {
  it('issues one PK SELECT with the stub recorded_at text and query_timeout = 2B', async () => {
    const fake = makeFakeClient({ rows: [{ event_id: STUB.event_id }] });
    await resolveEventRow(fake, STUB, 2000);
    const sel = selects(fake.calls);
    assert.strictEqual(sel.length, 1);
    assert.match(sel[0].text, /WHERE event_id = \$1 AND recorded_at = \$2::timestamptz/);
    assert.deepStrictEqual(sel[0].values, [STUB.event_id, STUB.recorded_at]);
    assert.strictEqual(typeof sel[0].values[1], 'string');
    assert.strictEqual(sel[0].values[1], '2026-10-21T12:00:00.123456+00:00');
    assert.strictEqual(sel[0].query_timeout, 4000);
  });

  it('returns rows[0] when present', async () => {
    const row = { event_id: STUB.event_id, sequence: '7' };
    const got = await resolveEventRow(
      makeFakeClient({ rows: [row, { event_id: 'other' }] }),
      STUB,
      2000,
    );
    assert.strictEqual(got, row);
  });

  it('returns null when no row matches (AC-7)', async () => {
    const got = await resolveEventRow(makeFakeClient({ rows: [] }), STUB, 2000);
    assert.strictEqual(got, null);
  });

  it("propagates a 'Query read timeout' rejection unchanged", async () => {
    const err = new Error('Query read timeout');
    await assert.rejects(
      resolveEventRow(makeFakeClient({ selectError: err }), STUB, 2000),
      (e: any) => {
        assert.strictEqual(e, err);
        assert.strictEqual(e.message, 'Query read timeout');
        return true;
      },
    );
  });

  it('propagates a Postgres 57014 rejection unchanged', async () => {
    const err: any = new Error('canceling statement due to statement timeout');
    err.code = '57014';
    await assert.rejects(
      resolveEventRow(makeFakeClient({ selectError: err }), STUB, 2000),
      (e: any) => {
        assert.strictEqual(e, err);
        assert.strictEqual(e.message, 'canceling statement due to statement timeout');
        assert.strictEqual(e.code, '57014');
        return true;
      },
    );
  });
});

describe('resolveEventRow SET-on-change (AC-9)', () => {
  it('SETs the bound once per client and value, before the SELECT', async () => {
    const fake = makeFakeClient({ rows: [] });

    await resolveEventRow(fake, STUB, 2000);
    assert.strictEqual(fake.calls.length, 2);
    assert.strictEqual(fake.calls[0].text, 'SET statement_timeout = 2000');
    assert.strictEqual(fake.calls[0].query_timeout, 4000);
    assert.match(fake.calls[1].text, /^SELECT/);

    await resolveEventRow(fake, STUB, 2000);
    assert.strictEqual(sets(fake.calls).length, 1, 'same B on the same client must not SET again');
    assert.strictEqual(fake.calls.length, 3);

    await resolveEventRow(fake, STUB, 200);
    assert.strictEqual(fake.calls[3].text, 'SET statement_timeout = 200');
    assert.strictEqual(fake.calls[3].query_timeout, 400);
    assert.strictEqual(fake.calls[4].query_timeout, 400);
    assert.strictEqual(sets(fake.calls).length, 2);

    const other = makeFakeClient({ rows: [] });
    await resolveEventRow(other, STUB, 200);
    assert.strictEqual(other.calls[0].text, 'SET statement_timeout = 200');
    assert.strictEqual(sets(other.calls).length, 1);
  });
});

describe('streamResolveTimeoutMs (AC-9 clamp)', () => {
  const cfg = (v: number) => ({ getInt: () => v });

  it('returns a positive configured value', () => {
    assert.strictEqual(streamResolveTimeoutMs(cfg(200)), 200);
  });

  it('falls back to 2000 for 0, negative, NaN and Infinity', () => {
    for (const v of [0, -5, NaN, Infinity]) {
      assert.strictEqual(streamResolveTimeoutMs(cfg(v)), 2000, `value ${v}`);
    }
  });

  it('floors a fractional value', () => {
    assert.strictEqual(streamResolveTimeoutMs(cfg(250.9)), 250);
  });

  it('returns 2000 when the key is absent (getInt yields the passed default)', () => {
    const seen: any[] = [];
    const absent = {
      getInt: (key: string, def: number) => {
        seen.push(key);
        return def;
      },
    };
    assert.strictEqual(streamResolveTimeoutMs(absent), 2000);
    assert.deepStrictEqual(seen, ['ledger.stream.resolve_timeout_ms']);
  });
});

describe('makeListenerClient', () => {
  it('builds an unconnected pg.Client carrying the startup statement_timeout', () => {
    const client: any = makeListenerClient('postgres://x', false, { getInt: () => 300 })();
    const internals: any = client;
    assert.ok(client instanceof Client);
    assert.strictEqual(internals._connected, false);
    assert.strictEqual(internals.connectionParameters.statement_timeout, 300);
  });
});
