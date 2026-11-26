import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_ui_chart_history_bars';
const KEY = 'chart.indicator_history_bars';
const ACTOR = 'system:config-migration-feature-fix-indicator-pane-warmup';
const HEAD =
  'INSERT INTO config.config_values (namespace, key, value_type, value_data, description, ' +
  'default_value, consuming_service, updated_by, environment, user_id) VALUES ';
const CONFLICT = " ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";

// One VALUES tuple in HEAD's column order; captures the description and the environment.
const ROW = new RegExp(
  `\\('ui', '${KEY.replace('.', '\\.')}', 'int', '200', '((?:[^']|'')*)', '200', ` +
    `'xstockstrat-ui', '${ACTOR}', '([a-z]+)', NULL\\)`,
  'g',
);

function upInsert(): string {
  const statements = splitStatements(findOne(SUFFIX, 'up'));
  assert.equal(statements.length, 1, 'the up must be exactly one statement');
  return statements[0];
}

describe('ui chart.indicator_history_bars seed migration', () => {
  it('the up is one insert-if-absent INSERT into config.config_values', () => {
    const insert = upInsert();
    assert.ok(insert.startsWith(HEAD), `unexpected INSERT head: ${insert.slice(0, 120)}`);
    assert.ok(insert.endsWith(CONFLICT), 'the seed must end ON CONFLICT ... DO NOTHING');
  });

  it('@AC-1 @AC-3 seeds one global int row at 200 per environment, nothing else', () => {
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
    assert.ok(!upInsert().includes(`'ui.${KEY}'`), 'stored key repeats its namespace');
  });

  it('the description names the default, the ceiling and the lock-budget runbook', () => {
    for (const m of upInsert().matchAll(ROW)) {
      for (const word of ['200', '1000', 'ohlcv-lock-budget-tuning']) {
        assert.ok(m[1].includes(word), `${m[2]} description does not name ${word}`);
      }
    }
  });

  it('the down is one DELETE of exactly the seeded row, never an operator-changed one', () => {
    const statements = splitStatements(findOne(SUFFIX, 'down'));
    assert.equal(statements.length, 1);
    const del = statements[0];
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    for (const clause of [
      `updated_by = '${ACTOR}'`,
      'user_id IS NULL',
      "namespace = 'ui'",
      `key = '${KEY}'`,
      "value_data = '200'",
    ]) {
      assert.ok(del.includes(clause), `the DELETE is not restricted by ${clause}`);
    }
  });
});
