import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = '_alpaca_adaptive_rate_limit_keys';
const ACTOR = 'system:config-migration-feature-alpaca-adaptive-rate-limit';
const HEAD =
  'INSERT INTO config.config_values (namespace, key, value_type, value_data, description, ' +
  'default_value, consuming_service, updated_by, environment, user_id) VALUES ';
const CONFLICT = " ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";

const SEEDED = [
  {
    namespace: 'marketdata',
    key: 'alpaca.adaptive_rate_limit_enabled',
    service: 'xstockstrat-marketdata',
  },
  {
    namespace: 'trading',
    key: 'broker.adaptive_rate_limit_enabled',
    service: 'xstockstrat-trading',
  },
];

// The row a fresh database holds (written by 041) and the text feature 347 @AC-37 pins.
const OLD_DESCRIPTION =
  'Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client ' +
  'waits on before every REST call; `0` disables rate limiting.';
const NEW_DESCRIPTION =
  'Static ceiling on outbound Alpaca REST calls per second. The effective rate is the lower of this ' +
  'ceiling and what the X-RateLimit response headers allow (alpaca.adaptive_rate_limit_enabled). Read ' +
  'live per request into a token-bucket limiter the client waits on before every REST call; `0` ' +
  'disables only this ceiling.';

// One VALUES tuple in HEAD's column order: namespace, key, description, consuming service, environment.
const ROW = new RegExp(
  `\\('([a-z]+)', '([a-z_.]+)', 'bool', 'true', '((?:[^']|'')*)', 'true', ` +
    `'([a-z-]+)', '${ACTOR}', '([a-z]+)', NULL\\)`,
  'g',
);

function statements(ext: 'up' | 'down'): string[] {
  const out = splitStatements(findOne(SUFFIX, ext));
  assert.equal(out.length, 2, `the ${ext} must be exactly two statements`);
  return out;
}

describe('alpaca adaptive rate limit seed migration', () => {
  it('the up is one insert-if-absent INSERT and one UPDATE of config.config_values', () => {
    const [insert, update] = statements('up');
    assert.ok(insert.startsWith(HEAD), `unexpected INSERT head: ${insert.slice(0, 120)}`);
    assert.ok(insert.endsWith(CONFLICT), 'the seed must end ON CONFLICT ... DO NOTHING');
    assert.match(update, /^UPDATE config\.config_values SET description = '/);
  });

  it('@AC-37 seeds each kill switch once per environment as a global bool row at true', () => {
    const [insert] = statements('up');
    const values = insert.slice(HEAD.length, insert.length - CONFLICT.length);
    const rows = [...values.matchAll(ROW)];
    assert.equal(
      rows.map((m) => m[0]).join(', '),
      values,
      'every tuple must match the seed row shape',
    );
    const seen = rows.map((m) => `${m[1]}/${m[2]}/${m[4]}/${m[5]}`).sort();
    const want = SEEDED.flatMap((s) =>
      ['production', 'staging'].map((env) => `${s.namespace}/${s.key}/${s.service}/${env}`),
    ).sort();
    assert.deepEqual(seen, want);
    for (const m of rows) assert.ok(m[3].trim().length > 0, `${m[1]}/${m[2]} has no description`);
  });

  it('the stored keys are namespace-relative', () => {
    const [insert] = statements('up');
    for (const s of SEEDED) {
      assert.ok(!s.key.startsWith(`${s.namespace}.`), `${s.key} repeats its namespace`);
      assert.ok(!insert.includes(`'${s.namespace}.${s.key}'`), `stored key ${s.key} is prefixed`);
    }
  });

  it('@AC-37 rewords the ceiling description only where it is still the seeded text', () => {
    const [, update] = statements('up');
    assert.equal(
      update,
      `UPDATE config.config_values SET description = '${NEW_DESCRIPTION}' ` +
        `WHERE namespace = 'marketdata' AND key = 'backfill.rate_limit_rps' ` +
        `AND description = '${OLD_DESCRIPTION}'`,
    );
  });

  it('the guard text is the description a fresh database really holds', () => {
    const heal = findOne('_heal_config_keys_to_reader_catalog', 'up');
    assert.ok(heal.includes(`'${OLD_DESCRIPTION}'`), 'OLD_DESCRIPTION is not the text 041 writes');
  });

  it('the down deletes only untouched seed rows and swaps the description back', () => {
    const [del, update] = statements('down');
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    for (const clause of [
      `updated_by = '${ACTOR}'`,
      'user_id IS NULL',
      "value_data = 'true'",
      ...SEEDED.map((s) => `(namespace = '${s.namespace}' AND key = '${s.key}')`),
    ]) {
      assert.ok(del.includes(clause), `the DELETE is not restricted by ${clause}`);
    }
    assert.match(
      del,
      /AND \(\(namespace = .* OR \(namespace = .*\)\)$/,
      'the OR must be parenthesized',
    );
    assert.equal(
      update,
      `UPDATE config.config_values SET description = '${OLD_DESCRIPTION}' ` +
        `WHERE namespace = 'marketdata' AND key = 'backfill.rate_limit_rps' ` +
        `AND description = '${NEW_DESCRIPTION}'`,
    );
  });
});
