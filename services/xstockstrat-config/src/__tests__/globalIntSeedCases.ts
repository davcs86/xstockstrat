// Test-only helper (not a suite: the test glob matches *.test.js only); call inside a describe().
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

export interface GlobalIntSeed {
  suffix: string;
  namespace: string;
  key: string;
  consumingService: string;
  value: number;
  min: number;
  max: number;
}

const LIT = "'((?:[^']|'')*)'";
const ROW = `\\(${Array(8).fill(LIT).join(', ')}, NULL\\)`;
const INSERT_RE = new RegExp(
  `^INSERT INTO config\\.config_values \\(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id\\) VALUES ${ROW}, ${ROW} ON CONFLICT \\(namespace, key, environment, COALESCE\\(user_id, ''\\)\\) DO NOTHING$`,
);

interface SeedRow {
  namespace: string;
  key: string;
  valueType: string;
  valueData: string;
  defaultValue: string;
  consumingService: string;
  environment: string;
}

function parseUp(suffix: string): SeedRow[] {
  const stmts = splitStatements(findOne(suffix, 'up'));
  assert.equal(stmts.length, 1, `up must be exactly one statement, got ${stmts.length}`);
  const m = INSERT_RE.exec(stmts[0]);
  assert.ok(m, `up is not the two-row global INSERT … ON CONFLICT DO NOTHING: ${stmts[0]}`);
  return [1, 9].map((o) => ({
    namespace: m[o],
    key: m[o + 1],
    valueType: m[o + 2],
    valueData: m[o + 3],
    defaultValue: m[o + 5],
    consumingService: m[o + 6],
    environment: m[o + 7],
  }));
}

export function globalIntSeedCases(seed: GlobalIntSeed): void {
  it(`${seed.key}: up is exactly one statement matching the two-row global INSERT … ON CONFLICT DO NOTHING`, () => {
    assert.equal(parseUp(seed.suffix).length, 2);
  });

  it(`${seed.key}: both rows target ${seed.namespace}/KEY as an int consumed by ${seed.consumingService}`, () => {
    for (const r of parseUp(seed.suffix)) {
      assert.equal(r.namespace, seed.namespace);
      assert.equal(r.key, seed.key);
      assert.equal(r.valueType, 'int');
      assert.equal(r.consumingService, seed.consumingService);
    }
  });

  it(`${seed.key}: seeds exactly the production and staging environments`, () => {
    assert.deepEqual(
      parseUp(seed.suffix)
        .map((r) => r.environment)
        .sort(),
      ['production', 'staging'],
    );
  });

  it(`${seed.key}: seeds value_data = default_value = ${seed.value}, an integer inside [${seed.min}, ${seed.max}]`, () => {
    for (const r of parseUp(seed.suffix)) {
      assert.equal(r.valueData, String(seed.value));
      assert.equal(r.defaultValue, String(seed.value));
      const n = Number(r.valueData);
      assert.ok(
        Number.isInteger(n) && n >= seed.min && n <= seed.max,
        `${r.valueData} outside [${seed.min}, ${seed.max}]`,
      );
    }
  });

  it(`${seed.key}: down is only the DELETE of the global rows of the key`, () => {
    assert.deepEqual(splitStatements(findOne(seed.suffix, 'down')), [
      `DELETE FROM config.config_values WHERE namespace = '${seed.namespace}' AND key = '${seed.key}' AND user_id IS NULL`,
    ]);
  });
}
