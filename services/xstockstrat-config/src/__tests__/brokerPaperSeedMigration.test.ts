import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_trading_broker_paper_per_environment';
const KEY = 'broker.paper';
const ACTOR = 'system:config-migration-feature-321';
const SEEDED: Record<string, string> = { staging: 'true', production: 'false' };
const HEAD =
  'INSERT INTO config.config_values (namespace, key, value_type, value_data, description, ' +
  'default_value, consuming_service, updated_by, environment, user_id) VALUES ';
const CONFLICT = " ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";

// One VALUES tuple in HEAD's column order; captures value_data, description, default_value and environment.
const ROW = new RegExp(
  `\\('trading', 'broker\\.paper', 'bool', '(true|false)', '((?:[^']|'')*)', '(true|false)', ` +
    `'xstockstrat-trading', '${ACTOR}', '([a-z]+)', NULL\\)`,
  'g',
);

function upInsert(): string {
  const statements = splitStatements(findOne(SUFFIX, 'up'));
  assert.equal(statements.length, 1, 'the up must be exactly one statement');
  return statements[0];
}

describe('trading broker.paper per-environment seed migration', () => {
  it('the up is one insert-if-absent INSERT into config.config_values', () => {
    const insert = upInsert();
    assert.ok(insert.startsWith(HEAD), `unexpected INSERT head: ${insert.slice(0, 120)}`);
    assert.ok(insert.endsWith(CONFLICT), 'the seed must end ON CONFLICT ... DO NOTHING');
  });

  it('seeds one global bool row per environment: staging true, production false', () => {
    const insert = upInsert();
    const values = insert.slice(HEAD.length, insert.length - CONFLICT.length);
    const rows = [...values.matchAll(ROW)];
    assert.equal(
      rows.map((m) => m[0]).join(', '),
      values,
      'every tuple must match the seed row shape',
    );
    assert.deepEqual(rows.map((m) => m[4]).sort(), ['production', 'staging']);
    for (const m of rows) {
      const env = m[4];
      assert.equal(m[1], SEEDED[env], `${env} value_data`);
      assert.equal(m[3], SEEDED[env], `${env} default_value`);
      assert.ok(m[2].trim().length > 0, `${env} has no description`);
    }
  });

  it('the stored key is namespace-relative', () => {
    assert.ok(!upInsert().includes(`'trading.${KEY}'`), 'stored key repeats its namespace');
  });

  it('the down is one DELETE of exactly the seeded rows, never an operator-changed one', () => {
    const statements = splitStatements(findOne(SUFFIX, 'down'));
    assert.equal(statements.length, 1);
    const del = statements[0];
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    for (const clause of [
      `updated_by = '${ACTOR}'`,
      'user_id IS NULL',
      "namespace = 'trading'",
      `key = '${KEY}'`,
      "(environment = 'staging' AND value_data = 'true')",
      "(environment = 'production' AND value_data = 'false')",
    ]) {
      assert.ok(del.includes(clause), `the DELETE is not restricted by ${clause}`);
    }
  });
});
