// Feature 306 @AC-1 (295 @AC-2 preserved): the snapshot carries exactly the stored keys, whatever the
// relative_keys_v1 marker row says; the server no longer reads or serves it.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import { MIGRATIONS_DIR } from './migrationSql';

let ConfigServiceImpl: typeof import('../grpc/configServiceImpl').ConfigServiceImpl;

before(async () => {
  ConfigServiceImpl = (await import('../grpc/configServiceImpl.js')).ConfigServiceImpl;
});

const NS = 'indicators';
const STORED: Record<string, number> = {
  'sandbox.timeout_ms': 5000,
  'sandbox.startup_grace_ms': 3000,
};
const flush = () => new Promise<void>((r) => setImmediate(r));

// 'no-table' = the to_regclass probe returns null; 'no-row' = table exists, marker row absent.
type MarkerState = 'no-table' | 'no-row' | 'row';

interface StoredRow {
  key: string;
  type: string;
  data: string;
}
const DEFAULT_ROWS: StoredRow[] = Object.entries(STORED).map(([key, v]) => ({
  key,
  type: 'int',
  data: String(v),
}));

function makePool(marker: MarkerState, ns: string = NS, stored: StoredRow[] = DEFAULT_ROWS) {
  const selects: string[] = [];
  const rows = stored.map(({ key, type, data }) => ({
    namespace: ns,
    key,
    value_type: type,
    value_data: data,
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

async function snapshotFor(marker: MarkerState, ns: string = NS, stored: StoredRow[] = DEFAULT_ROWS) {
  const { pool, selects } = makePool(marker, ns, stored);
  const impl = new ConfigServiceImpl(pool);
  await impl.initialize();
  const call: any = new EventEmitter();
  call.request = {
    namespace: ns,
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

describe('config serves only stored keys (features 295 @AC-2, 306 @AC-1)', () => {
  for (const marker of ['no-table', 'no-row', 'row'] as const) {
    it(`@AC-1 with the marker (${marker}) the snapshot keys equal the stored keys exactly`, async () => {
      const { snap, selects } = await snapshotFor(marker);
      assert.deepStrictEqual(Object.keys(snap.values).sort(), Object.keys(STORED).sort());
      for (const [k, v] of Object.entries(STORED)) assert.strictEqual(snap.values[k].intVal, v);
      assert.ok(selects.length > 0);
      assert.ok(
        selects.every((s) => !s.includes('config_markers') && !new RegExp('marker' + '_active').test(s)),
        'the reload SELECT no longer probes the marker',
      );
    });
  }

  it('@AC-1 a relative stored key is not doubled into its prefixed spelling', async () => {
    const { snap } = await snapshotFor('row', 'indicators', [
      { key: 'sandbox.timeout_ms', type: 'int', data: '15000' },
    ]);
    assert.deepStrictEqual(Object.keys(snap.values), ['sandbox.timeout_ms']);
    assert.strictEqual(snap.values['sandbox.timeout_ms'].intVal, 15000);
  });

  it('@AC-1 a bool key keeps its stored false and no prefixed twin', async () => {
    const { snap } = await snapshotFor('row', 'trading', [
      { key: 'risk.bracket_orders_enabled', type: 'bool', data: 'false' },
    ]);
    assert.deepStrictEqual(Object.keys(snap.values), ['risk.bracket_orders_enabled']);
    assert.strictEqual(snap.values['risk.bracket_orders_enabled'].boolVal, false);
  });

  it('exactly one migration writes the relative_keys_v1 marker row, and it is the contract of 040', () => {
    // Other migrations may keep their own latch rows in config_markers; only the alias-activation marker is unique.
    const ups = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.up\.sql$/.test(f));
    const writers = ups.filter((f) =>
      /INSERT\s+INTO\s+config\.config_markers\s*\([^)]*\)\s*VALUES\s*\(\s*'relative_keys_v1'/i.test(
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
