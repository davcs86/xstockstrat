// Feature 295 @AC-2 (@preserve): without the relative_keys_v1 marker the snapshot carries exactly the
// stored spellings; with it, withLegacyAliases adds each key's alternate spelling.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import { altSpelling } from '../grpc/authz';
import { MIGRATIONS_DIR } from './migrationSql';

let ConfigServiceImpl: typeof import('../grpc/configServiceImpl').ConfigServiceImpl;

before(async () => {
  ConfigServiceImpl = (await import('../grpc/configServiceImpl.js')).ConfigServiceImpl;
});

const NS = 'indicators';
const MARKER_PROBE = "to_regclass('config.config_markers')";
const STORED: Record<string, number> = {
  'indicators.sandbox.timeout_ms': 5000,
  'sandbox.startup_grace_ms': 3000,
};
const flush = () => new Promise<void>((r) => setImmediate(r));

// 'no-table' = the to_regclass probe returns null; 'no-row' = table exists, marker row absent.
type MarkerState = 'no-table' | 'no-row' | 'row';

function makePool(marker: MarkerState) {
  const selects: string[] = [];
  const rows = Object.entries(STORED).map(([key, v]) => ({
    namespace: NS,
    key,
    value_type: 'int',
    value_data: String(v),
    is_secret: false,
    environment: 'staging',
    updated_at: new Date(0),
  }));
  const pool: any = {
    connect: async () =>
      Object.assign(new EventEmitter(), {
        query: async () => ({ rows: [] }),
        release: () => undefined,
      }),
    query: async (sql: string, params: unknown[] = []) => {
      const extra = sql.includes('config_markers') ? { marker_active: marker === 'row' } : {};
      if (/user_id = \$3/.test(sql)) return { rows: [] };
      if (/WHERE user_id IS NULL/.test(sql) && params.length === 0) {
        selects.push(sql);
        return { rows: rows.map((r) => ({ ...r, ...extra })) };
      }
      throw new Error(`unrouted SQL: ${sql}`);
    },
  };
  return { pool, selects };
}

async function snapshotFor(marker: MarkerState) {
  const { pool, selects } = makePool(marker);
  const impl = new ConfigServiceImpl(pool);
  await impl.initialize();
  const call: any = new EventEmitter();
  call.request = {
    namespace: NS,
    environment: 'ENVIRONMENT_STAGING',
    user_id: '',
    client_id: 'c1',
  };
  call.metadata = new grpc.Metadata();
  call.writes = [] as any[];
  call.write = (p: any) => {
    call.writes.push(p);
    return true;
  };
  call.destroy = () => undefined;
  impl.watchConfig(call);
  await flush();
  assert.strictEqual(call.writes.length, 1, 'the SNAPSHOT reached the subscriber');
  return { snap: call.writes[0], selects };
}

describe('config dormant legacy alias (feature 295)', () => {
  for (const marker of ['no-table', 'no-row'] as const) {
    it(`@AC-2 without the marker (${marker}) the snapshot keys equal the stored keys exactly`, async () => {
      const { snap } = await snapshotFor(marker);
      assert.deepStrictEqual(Object.keys(snap.values).sort(), Object.keys(STORED).sort());
      for (const [k, v] of Object.entries(STORED)) assert.strictEqual(snap.values[k].intVal, v);
    });
  }

  it('@AC-2 with the marker row present the snapshot adds each alternate spelling', async () => {
    const { snap, selects } = await snapshotFor('row');
    assert.ok(
      selects.every((s) => s.includes(MARKER_PROBE)),
      'the reload SELECT guards the marker with to_regclass',
    );
    const expected = Object.keys(STORED).flatMap((k) => [k, altSpelling(NS, k)]);
    assert.deepStrictEqual(Object.keys(snap.values).sort(), expected.sort());
    for (const [k, v] of Object.entries(STORED)) {
      assert.strictEqual(
        snap.values[altSpelling(NS, k)].intVal,
        v,
        `alias of ${k} carries the stored value`,
      );
    }
  });

  it('exactly one migration writes the marker row, and it is the contract of 040', () => {
    const ups = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.up\.sql$/.test(f));
    const writers = ups.filter((f) =>
      /INSERT\s+INTO\s+config\.config_markers/i.test(
        fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'),
      ),
    );
    assert.strictEqual(writers.length, 1, `marker writers: ${writers.join(', ')}`);
    const head = fs
      .readFileSync(path.join(MIGRATIONS_DIR, writers[0]), 'utf8')
      .split('\n')
      .slice(0, 5)
      .join('\n');
    assert.match(
      head,
      /^-- contract-of: services\/xstockstrat-config\/migrations\/040_config_markers\.up\.sql$/m,
    );
  });
});
