import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_analysis_pipeline_keys';
const ACTOR = 'system:config-migration-feature-pipeline-job-graph';
const HEAD =
  'INSERT INTO config.config_values (namespace, key, value_type, value_data, description, ' +
  'default_value, consuming_service, updated_by, environment, user_id) VALUES ';
const CONFLICT = " ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";

// Mirrors SCALAR_BOUNDS_REGISTRY: every seed must be writable through SetConfig.
const SEEDED: { key: string; type: 'bool' | 'int'; value: string; bounds?: [number, number] }[] = [
  { key: 'pipeline.worker_enabled', type: 'bool', value: 'true' },
  { key: 'pipeline.worker_concurrency', type: 'int', value: '4', bounds: [1, 16] },
  { key: 'pipeline.poll_interval_ms', type: 'int', value: '1000', bounds: [200, 5000] },
  { key: 'pipeline.lease_seconds', type: 'int', value: '60', bounds: [45, 600] },
  { key: 'pipeline.max_attempts', type: 'int', value: '5', bounds: [2, 20] },
  { key: 'pipeline.retention_days', type: 'int', value: '7', bounds: [1, 90] },
];

// One VALUES tuple in HEAD's column order: key, type, value, description, default, environment.
const ROW = new RegExp(
  `\\('analysis', '([a-z_.]+)', '(bool|int)', '([0-9a-z]+)', '((?:[^']|'')*)', '([0-9a-z]+)', ` +
    `'xstockstrat-analysis', '${ACTOR}', '([a-z]+)', NULL\\)`,
  'g',
);

function only(ext: 'up' | 'down'): string {
  const statements = splitStatements(findOne(SUFFIX, ext));
  assert.equal(statements.length, 1, `the ${ext} must be exactly one statement`);
  return statements[0];
}

describe('analysis pipeline job graph seed migration', () => {
  it('the up is one insert-if-absent INSERT into config.config_values', () => {
    const insert = only('up');
    assert.ok(insert.startsWith(HEAD), `unexpected INSERT head: ${insert.slice(0, 120)}`);
    assert.ok(insert.endsWith(CONFLICT), 'the seed must end ON CONFLICT ... DO NOTHING');
  });

  it('@AC-14 @feature-295 seeds each of the six keys once per environment with its type and value', () => {
    const insert = only('up');
    const values = insert.slice(HEAD.length, insert.length - CONFLICT.length);
    const rows = [...values.matchAll(ROW)];
    assert.equal(rows.map((m) => m[0]).join(', '), values, 'every tuple must match the seed row shape');
    const seen = rows.map((m) => `${m[1]}/${m[2]}/${m[3]}/${m[5]}/${m[6]}`).sort();
    const want = SEEDED.flatMap((s) =>
      ['production', 'staging'].map((env) => `${s.key}/${s.type}/${s.value}/${s.value}/${env}`),
    ).sort();
    assert.deepEqual(seen, want);
    for (const m of rows) assert.ok(m[4].trim().length > 0, `${m[1]}/${m[6]} has no description`);
  });

  it('the stored keys are namespace-relative', () => {
    const insert = only('up');
    assert.ok(!insert.includes("'analysis.pipeline."), 'a stored key repeats its namespace');
  });

  it('each seeded int lies inside its SetConfig bounds', () => {
    for (const s of SEEDED) {
      if (!s.bounds) continue;
      const v = Number(s.value);
      assert.ok(v >= s.bounds[0] && v <= s.bounds[1], `${s.key}=${v} outside [${s.bounds}]`);
    }
  });

  it('the down is one DELETE of exactly the untouched seed rows', () => {
    const del = only('down');
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    for (const clause of [
      "namespace = 'analysis'",
      "environment IN ('staging', 'production')",
      'user_id IS NULL',
      `updated_by = '${ACTOR}'`,
      ...SEEDED.map((s) => `(key = '${s.key}' AND value_data = '${s.value}')`),
    ]) {
      assert.ok(del.includes(clause), `the DELETE is not restricted by ${clause}`);
    }
    assert.match(del, /AND \(\(key = .* OR \(key = .*\)\)$/, 'the OR must be parenthesized');
  });
});
