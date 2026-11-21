import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = 'notify_commsgun_channel_keys';
const ACTOR = 'system:config-migration-feature-notify-commsgun-channel';
const CONFLICT = "ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";
const ENVIRONMENTS = ['staging', 'production'];
const SECRET_KEY = 'commsgun.app_key';

// Seeded value_data per plain key; commsgun.app_id differs per environment and is asserted apart.
const PLAIN_KEYS: Record<string, { type: string; value: string | null }> = {
  'fanout.email_provider': { type: 'string', value: 'auto' },
  'commsgun.enqueue_url': { type: 'string', value: '' },
  'commsgun.app_id': { type: 'string', value: null },
  'commsgun.to_email': { type: 'string', value: '' },
  'commsgun.max_attempts': { type: 'int', value: '8' },
  'commsgun.backoff_base_seconds': { type: 'int', value: '30' },
  'commsgun.backoff_max_seconds': { type: 'int', value: '3600' },
  'commsgun.request_timeout_seconds': { type: 'int', value: '10' },
};
const APP_ID_BY_ENV: Record<string, string> = {
  production: 'xstockstrat',
  staging: 'xstockstrat-staging',
};

// Splits on commas outside single-quoted literals and parentheses; a literal keeps its quotes.
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      cur += c;
      if (c === "'") {
        if (text[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inQuote = false;
        }
      }
    } else if (c === "'") {
      inQuote = true;
      cur += c;
    } else if (c === '(') {
      depth++;
      cur += c;
    } else if (c === ')') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unquote(literal: string): string {
  assert.match(literal, /^'.*'$/s, `expected a string literal, got ${literal}`);
  return literal.slice(1, -1).replace(/''/g, "'");
}

interface Insert {
  columns: string[];
  rows: Array<Record<string, string>>;
  tail: string;
}

function parseInsert(stmt: string): Insert {
  const head = /^INSERT INTO config\.config_values \(([^)]*)\) VALUES /.exec(stmt);
  assert.ok(head, `not an INSERT into config.config_values: ${stmt.slice(0, 60)}`);
  const columns = head[1].split(',').map((c) => c.trim());
  const conflictAt = stmt.indexOf(' ON CONFLICT ');
  assert.ok(conflictAt > 0, 'the INSERT has no ON CONFLICT clause');
  const tuples = splitTopLevel(stmt.slice(head[0].length, conflictAt));
  const rows = tuples.map((tuple) => {
    assert.match(tuple, /^\(.*\)$/s, `not a VALUES tuple: ${tuple.slice(0, 40)}`);
    const cells = splitTopLevel(tuple.slice(1, -1));
    assert.equal(
      cells.length,
      columns.length,
      `tuple width differs from the column list: ${tuple.slice(0, 60)}`,
    );
    return Object.fromEntries(columns.map((col, i) => [col, cells[i]]));
  });
  return { columns, rows, tail: stmt.slice(conflictAt + 1) };
}

const upInserts = (): Insert[] => splitStatements(findOne(SUFFIX, 'up')).map(parseInsert);
const allRows = (): Array<Record<string, string>> => upInserts().flatMap((i) => i.rows);

describe('notify commsgun channel seed migration', () => {
  it('the up is exactly two INSERTs into config.config_values, both insert-if-absent', () => {
    const statements = splitStatements(findOne(SUFFIX, 'up'));
    assert.equal(statements.length, 2);
    for (const insert of statements.map(parseInsert)) {
      assert.equal(insert.tail, CONFLICT);
    }
  });

  it('@AC-16 seeds fanout.email_provider as auto and one global row per plain key and environment', () => {
    const plain = allRows().filter((r) => unquote(r.key) !== SECRET_KEY);
    assert.equal(plain.length, Object.keys(PLAIN_KEYS).length * ENVIRONMENTS.length);
    for (const [key, want] of Object.entries(PLAIN_KEYS)) {
      for (const env of ENVIRONMENTS) {
        const rows = plain.filter((r) => unquote(r.key) === key && unquote(r.environment) === env);
        assert.equal(rows.length, 1, `${key} / ${env}`);
        const row = rows[0];
        assert.equal(unquote(row.namespace), 'notify');
        assert.equal(unquote(row.value_type), want.type, key);
        if (want.value !== null) assert.equal(unquote(row.value_data), want.value, key);
        assert.equal(row.user_id, 'NULL');
        assert.equal(unquote(row.updated_by), ACTOR);
        assert.equal(unquote(row.consuming_service), 'xstockstrat-notify');
        assert.ok(unquote(row.description).trim().length > 0, `${key} has no description`);
        assert.ok(
          !('is_secret' in row) || row.is_secret === 'FALSE',
          `${key} must not be a secret`,
        );
      }
    }
    for (const row of allRows()) {
      assert.ok(
        !unquote(row.key).startsWith('notify.'),
        `stored key repeats its namespace: ${row.key}`,
      );
    }
  });

  it('@AC-16 seeds commsgun.app_key as a value-less secret row per environment', () => {
    const insert = upInserts().find((i) => i.rows.some((r) => unquote(r.key) === SECRET_KEY));
    assert.ok(insert, 'no INSERT seeds commsgun.app_key');
    assert.ok(!insert.columns.includes('value_encrypted'), 'a migration must not write ciphertext');
    assert.deepEqual(
      insert.rows.map((r) => unquote(r.environment)).sort(),
      [...ENVIRONMENTS].sort(),
    );
    for (const row of insert.rows) {
      assert.equal(unquote(row.key), SECRET_KEY);
      assert.equal(unquote(row.namespace), 'notify');
      assert.equal(row.is_secret, 'TRUE');
      assert.equal(unquote(row.value_data), '[redacted]');
      assert.equal(unquote(row.default_value), '');
      assert.equal(row.user_id, 'NULL');
      assert.equal(unquote(row.updated_by), ACTOR);
    }
  });

  it('@AC-24 seeds commsgun.app_id per environment', () => {
    const rows = allRows().filter((r) => unquote(r.key) === 'commsgun.app_id');
    const byEnv = Object.fromEntries(
      rows.map((r) => [unquote(r.environment), unquote(r.value_data)]),
    );
    assert.deepEqual(byEnv, APP_ID_BY_ENV);
    for (const row of rows) assert.equal(unquote(row.default_value), '');
  });

  it('the down is one DELETE of the rows the up wrote, and never a secret that has been set', () => {
    const statements = splitStatements(findOne(SUFFIX, 'down'));
    assert.equal(statements.length, 1);
    const del = statements[0];
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    assert.ok(
      del.includes(`updated_by = '${ACTOR}'`),
      'the DELETE is not restricted to the sentinel actor',
    );
    assert.ok(del.includes('user_id IS NULL'), 'the DELETE is not restricted to global rows');
    for (const key of [...Object.keys(PLAIN_KEYS), SECRET_KEY]) {
      assert.ok(del.includes(`key = '${key}'`), `the DELETE does not name ${key}`);
    }
    const secretArm = new RegExp(
      `\\(([^()]*key = '${SECRET_KEY.replace('.', '\\.')}'[^()]*)\\)`,
    ).exec(del);
    assert.ok(secretArm, 'no arm for commsgun.app_key');
    assert.ok(
      secretArm[1].includes('value_encrypted IS NULL'),
      'the secret arm must require NULL ciphertext',
    );
    assert.ok(secretArm[1].includes('is_secret'), 'the secret arm must require a secret row');
  });
});
