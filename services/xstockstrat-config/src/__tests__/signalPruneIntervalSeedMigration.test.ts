/**
 * @AC-19 (feature 281): the *_portfolio_signal_prune_interval seed is one two-row global INSERT … DO NOTHING,
 * and its down deletes only the global rows of the key.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_portfolio_signal_prune_interval';
const KEY = 'portfolio.watchlist.signal_prune_interval_seconds';
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

function parseUp(): SeedRow[] {
  const stmts = splitStatements(findOne(SUFFIX, 'up'));
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

describe('signal prune interval seed migration (@AC-19)', () => {
  it('up is exactly one statement matching the two-row global INSERT … ON CONFLICT DO NOTHING', () => {
    assert.equal(parseUp().length, 2);
  });

  it('both rows target portfolio/KEY as an int consumed by xstockstrat-portfolio', () => {
    for (const r of parseUp()) {
      assert.equal(r.namespace, 'portfolio');
      assert.equal(r.key, KEY);
      assert.equal(r.valueType, 'int');
      assert.equal(r.consumingService, 'xstockstrat-portfolio');
    }
  });

  it('seeds exactly the production and staging environments', () => {
    assert.deepEqual(
      parseUp()
        .map((r) => r.environment)
        .sort(),
      ['production', 'staging'],
    );
  });

  it('seeds value_data = default_value = 300, an integer inside [60, 86400]', () => {
    for (const r of parseUp()) {
      assert.equal(r.valueData, '300');
      assert.equal(r.defaultValue, '300');
      const n = Number(r.valueData);
      assert.ok(Number.isInteger(n) && n >= 60 && n <= 86400, `${r.valueData} outside [60, 86400]`);
    }
  });

  it('down is only the DELETE of the global rows of the key', () => {
    assert.deepEqual(splitStatements(findOne(SUFFIX, 'down')), [
      `DELETE FROM config.config_values WHERE namespace = 'portfolio' AND key = '${KEY}' AND user_id IS NULL`,
    ]);
  });
});
