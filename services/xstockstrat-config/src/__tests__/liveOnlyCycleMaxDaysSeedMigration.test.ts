import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_analysis_live_only_cycle_max_days';
const KEY = 'opportunity.live_only_cycle_max_days';
const ACTOR = 'system:config-migration-feature-opportunity-live-only-rotation';
const SEEDED = 3;
// The SetConfig bounds of this key (SCALAR_BOUNDS_REGISTRY); the seed must be writable through SetConfig.
const BOUNDS = { min: 1, max: 30 };
const HEAD =
  'INSERT INTO config.config_values (namespace, key, value_type, value_data, description, ' +
  'default_value, consuming_service, updated_by, environment, user_id) VALUES ';
const CONFLICT = " ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";

// One VALUES tuple in HEAD's column order; captures the description and the environment.
const ROW = new RegExp(
  `\\('analysis', '${KEY.replace('.', '\\.')}', 'int', '${SEEDED}', '((?:[^']|'')*)', '${SEEDED}', ` +
    `'xstockstrat-analysis', '${ACTOR}', '([a-z]+)', NULL\\)`,
  'g',
);

function upInsert(): string {
  const statements = splitStatements(findOne(SUFFIX, 'up'));
  assert.equal(statements.length, 1, 'the up must be exactly one statement');
  return statements[0];
}

describe('analysis opportunity.live_only_cycle_max_days seed migration', () => {
  it('the up is one insert-if-absent INSERT into config.config_values', () => {
    const insert = upInsert();
    assert.ok(insert.startsWith(HEAD), `unexpected INSERT head: ${insert.slice(0, 120)}`);
    assert.ok(insert.endsWith(CONFLICT), 'the seed must end ON CONFLICT ... DO NOTHING');
  });

  it('seeds one global int row at 3 per environment, nothing else', () => {
    const insert = upInsert();
    const values = insert.slice(HEAD.length, insert.length - CONFLICT.length);
    const rows = [...values.matchAll(ROW)];
    assert.equal(
      rows.map((m) => m[0]).join(', '),
      values,
      'every tuple must match the seed row shape',
    );
    assert.deepEqual(rows.map((m) => m[2]).sort(), ['production', 'staging']);
    for (const m of rows) assert.ok(m[1].trim().length > 0, `${m[2]} has no description`);
  });

  it('the stored key is namespace-relative', () => {
    assert.ok(!upInsert().includes(`'analysis.${KEY}'`), 'stored key repeats its namespace');
  });

  it('the seeded value lies inside the SetConfig bounds', () => {
    assert.ok(SEEDED >= BOUNDS.min && SEEDED <= BOUNDS.max);
  });

  it('the down is one DELETE of exactly the seeded row, never an operator-changed one', () => {
    const statements = splitStatements(findOne(SUFFIX, 'down'));
    assert.equal(statements.length, 1);
    const del = statements[0];
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    for (const clause of [
      `updated_by = '${ACTOR}'`,
      'user_id IS NULL',
      "namespace = 'analysis'",
      `key = '${KEY}'`,
      `value_data = '${SEEDED}'`,
    ]) {
      assert.ok(del.includes(clause), `the DELETE is not restricted by ${clause}`);
    }
  });
});
