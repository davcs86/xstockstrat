import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Compiled into dist/__tests__/, so two levels up is the service root.
const MIGRATIONS = join(__dirname, '..', '..', 'migrations');
const MIGRATION = '042_marketdata_bar_ingest_backoff';
const FULL_KEY = "'marketdata.stream.bar_ingest_backoff_ms'";
const BARE_KEY = "'stream.bar_ingest_backoff_ms'";

const normalise = (stmt: string): string => stmt.replace(/\s+/g, ' ').trim().toLowerCase();

// The seed's description literal contains ';' and its header comment an apostrophe, so comment lines are dropped
// first and statements split only outside single-quoted literals.
function splitStatements(sql: string): string[] {
  sql = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    if (ch === ';' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  return [...out, current];
}

function loadStatements(direction: 'up' | 'down'): string[] {
  return splitStatements(readFileSync(join(MIGRATIONS, `${MIGRATION}.${direction}.sql`), 'utf8'))
    .map(normalise)
    .filter((s) => s.length > 0);
}

// One VALUES tuple in the seed's column order; the description literal may contain doubled quotes.
const SEED_ROW = new RegExp(
  "\\('marketdata', 'marketdata\\.stream\\.bar_ingest_backoff_ms', 'int', '21600000', '(?:[^']|'')*', " +
    "'21600000', 'xstockstrat-marketdata', '([a-z]+)', null\\)",
  'g',
);

describe('marketdata.stream.bar_ingest_backoff_ms seed migration', () => {
  it('@AC-11 the up seeds the full-dotted int key at 21600000 for staging and production, globally', () => {
    const inserts = loadStatements('up').filter((s) =>
      s.startsWith('insert into config.config_values'),
    );
    assert.equal(
      inserts.length,
      1,
      `${MIGRATION}.up.sql must hold exactly one INSERT into config.config_values`,
    );
    const insert = inserts[0];

    assert.ok(
      insert.startsWith(
        'insert into config.config_values (namespace, key, value_type, value_data, description, default_value, ' +
          'consuming_service, environment, user_id) values',
      ),
      'column list must match the tuple shape asserted below',
    );
    assert.ok(
      insert.includes(FULL_KEY),
      'the key column must be the full dotted string the reader reads',
    );
    assert.ok(!insert.includes(BARE_KEY), 'a namespace-stripped key is a silent reader-orphan');

    const envs = [...insert.matchAll(SEED_ROW)].map((m) => m[1]).sort();
    assert.deepEqual(
      envs,
      ['production', 'staging'],
      'one int row at 21600000 per environment, user_id NULL',
    );
  });

  it('@AC-11 the up never overwrites an existing runtime value', () => {
    const [insert] = loadStatements('up').filter((s) =>
      s.startsWith('insert into config.config_values'),
    );
    assert.ok(
      insert.endsWith(
        "on conflict (namespace, key, environment, coalesce(user_id, '')) do nothing",
      ),
      'the seed must end ON CONFLICT ... DO NOTHING',
    );
  });

  it('@AC-11 the down deletes the key in namespace marketdata', () => {
    const deletes = loadStatements('down').filter((s) =>
      s.startsWith('delete from config.config_values'),
    );
    assert.equal(
      deletes.length,
      1,
      `${MIGRATION}.down.sql must hold exactly one DELETE from config.config_values`,
    );
    assert.equal(
      deletes[0],
      `delete from config.config_values where namespace = 'marketdata' and key = ${FULL_KEY}`,
    );
  });
});
