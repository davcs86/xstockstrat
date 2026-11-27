import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findOne, splitStatements } from './migrationSql';

const SUFFIX = 'authelia_sso_keys';
const ACTOR = 'system:config-migration-feature-authelia-sso';
const CONFLICT = "ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING";
const ENVIRONMENTS = ['staging', 'production'];
const SECRET = { namespace: 'ui', key: 'oidc.client_secret' };

// namespace/key → [value_data, default_value, consuming_service] of each plain row.
const PLAIN: Record<string, [string, string, string]> = {
  'identity/auth.mode': ['local', 'local', 'xstockstrat-identity'],
  'ui/oidc.issuer': ['', '', 'xstockstrat-ui'],
  'ui/oidc.client_id': ['', '', 'xstockstrat-ui'],
  'ui/oidc.mcp_client_id': ['', '', 'xstockstrat-ui'],
  'ui/oidc.mcp_client_id_readonly': ['', '', 'xstockstrat-ui'],
  'ui/oidc.mcp_client_id_claude_code': ['', '', 'xstockstrat-ui'],
  'ui/oidc.mcp_client_id_claude_code_readonly': ['', '', 'xstockstrat-ui'],
  'agent/oidc.issuer': ['', '', 'xstockstrat-agent'],
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
    } else if (c === '(' || c === ')') {
      depth += c === '(' ? 1 : -1;
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
  const rows = splitTopLevel(stmt.slice(head[0].length, conflictAt)).map((tuple) => {
    const cells = splitTopLevel(tuple.slice(1, -1));
    assert.equal(cells.length, columns.length, `tuple width differs: ${tuple.slice(0, 60)}`);
    return Object.fromEntries(columns.map((col, i) => [col, cells[i]]));
  });
  return { columns, rows, tail: stmt.slice(conflictAt + 1) };
}

const upSql = (): string => findOne(SUFFIX, 'up');
const upInserts = (): Insert[] => splitStatements(upSql()).map(parseInsert);
const allRows = (): Array<Record<string, string>> => upInserts().flatMap((i) => i.rows);
const id = (r: Record<string, string>): string => `${unquote(r.namespace)}/${unquote(r.key)}`;

describe('authelia-sso seed migration', () => {
  it('the up is exactly two insert-if-absent INSERTs and sends no notify', () => {
    const inserts = upInserts();
    assert.equal(inserts.length, 2);
    for (const insert of inserts) assert.equal(insert.tail, CONFLICT);
    assert.ok(!/pg_notify/i.test(upSql()), 'the seed must not notify (D-109)');
  });

  it('seeds the 9 keys as one global sentinel row per environment (18)', () => {
    const rows = allRows();
    assert.equal(rows.length, 18);
    for (const want of [...Object.keys(PLAIN), `${SECRET.namespace}/${SECRET.key}`]) {
      const envs = rows.filter((r) => id(r) === want).map((r) => unquote(r.environment));
      assert.deepEqual(envs.sort(), [...ENVIRONMENTS].sort(), want);
    }
    for (const row of rows) {
      assert.equal(row.user_id, 'NULL');
      assert.equal(unquote(row.updated_by), ACTOR);
      assert.equal(unquote(row.value_type), 'string');
      assert.ok(unquote(row.description).trim().length > 0, `${id(row)} has no description`);
    }
  });

  it('@AC-1 @feature-296 every stored key is namespace-relative', () => {
    for (const row of allRows()) {
      assert.ok(!/^(identity|ui|agent)\./.test(unquote(row.key)), `prefixed key: ${row.key}`);
    }
  });

  it('@AC-41 seeds auth.mode as local, the code default, in both environments', () => {
    const mode = allRows().filter((r) => id(r) === 'identity/auth.mode');
    assert.equal(mode.length, 2);
    for (const row of mode) {
      assert.equal(unquote(row.value_data), 'local');
      assert.equal(unquote(row.default_value), 'local');
    }
  });

  it('every other plain row seeds an empty value equal to its default', () => {
    for (const row of allRows().filter((r) => id(r) in PLAIN)) {
      const [value, def, svc] = PLAIN[id(row)];
      assert.equal(unquote(row.value_data), value, id(row));
      assert.equal(unquote(row.default_value), def, id(row));
      assert.equal(unquote(row.consuming_service), svc, id(row));
      assert.ok(!('is_secret' in row) || row.is_secret === 'FALSE', `${id(row)} is not a secret`);
    }
  });

  it('seeds ui/oidc.client_secret as a value-less secret row per environment', () => {
    const insert = upInserts().find((i) => i.rows.some((r) => unquote(r.key) === SECRET.key));
    assert.ok(insert, 'no INSERT seeds oidc.client_secret');
    assert.ok(!insert.columns.includes('value_encrypted'), 'a migration must not write ciphertext');
    assert.equal(insert.rows.length, 2);
    for (const row of insert.rows) {
      assert.equal(id(row), `${SECRET.namespace}/${SECRET.key}`);
      assert.equal(row.is_secret, 'TRUE');
      assert.equal(unquote(row.value_data), '[redacted]');
      assert.equal(unquote(row.default_value), '');
      assert.equal(unquote(row.consuming_service), 'xstockstrat-ui');
    }
  });

  it('the down deletes only sentinel rows still at their seed value, never a set secret', () => {
    const statements = splitStatements(findOne(SUFFIX, 'down'));
    assert.equal(statements.length, 1);
    const del = statements[0];
    assert.match(del, /^DELETE FROM config\.config_values WHERE /);
    assert.ok(del.includes(`updated_by = '${ACTOR}'`), 'not restricted to the sentinel actor');
    assert.ok(del.includes('user_id IS NULL'), 'not restricted to global rows');
    assert.ok(del.includes("key = 'auth.mode' AND value_data = 'local'"), 'auth.mode arm');
    for (const key of Object.keys(PLAIN).map((k) => k.split('/')[1])) {
      assert.ok(del.includes(`'${key}'`), `the DELETE does not name ${key}`);
    }
    const secretArm = /\(([^()]*key = 'oidc\.client_secret'[^()]*)\)/.exec(del);
    assert.ok(secretArm, 'no arm for oidc.client_secret');
    assert.ok(secretArm[1].includes('value_encrypted IS NULL'), 'secret arm needs NULL ciphertext');
    assert.ok(secretArm[1].includes('is_secret'), 'secret arm needs a secret row');
  });
});
