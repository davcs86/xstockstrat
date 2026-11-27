// Feature 328: the operator sweep is \ir'd inside BEGIN ... ROLLBACK by its rerun assertion, so it must stay one
// statement; the preview's predicate must stay byte-identical to the sweep's.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { splitStatements } from './migrationSql';

const SWEEP = path.resolve(__dirname, '../../../../scripts/config-heal/mcp-credential-orphan-sweep.sql');
const PREVIEW = path.resolve(__dirname, '../../../../scripts/config-heal/mcp-credential-orphan-sweep-preview.sql');
const FILES = { sweep: SWEEP, preview: PREVIEW } as const;
const BEGIN_MARKER = '-- mcp_orphan:begin';
const END_MARKER = '-- mcp_orphan:end';

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function withoutMetaCommands(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.startsWith('\\'))
    .join('\n');
}

function markerBlock(sql: string, name: string): string {
  const lines = sql.split('\n');
  const begins = lines.flatMap((l, i) => (l === BEGIN_MARKER ? [i] : []));
  const ends = lines.flatMap((l, i) => (l === END_MARKER ? [i] : []));
  assert.equal(begins.length, 1, `${name}: expected exactly one ${BEGIN_MARKER}`);
  assert.equal(ends.length, 1, `${name}: expected exactly one ${END_MARKER}`);
  assert.ok(ends[0] > begins[0], `${name}: ${END_MARKER} precedes ${BEGIN_MARKER}`);
  return lines.slice(begins[0] + 1, ends[0]).join('\n');
}

describe('feature 328 mcp_credential orphan sweep', () => {
  it('is a single statement per file (O-21)', () => {
    for (const [name, file] of Object.entries(FILES)) {
      const stmts = splitStatements(withoutMetaCommands(read(file)));
      assert.equal(stmts.length, 1, `${name}: expected 1 statement, got ${stmts.length}`);
      assert.ok(stmts[0].startsWith(name === 'sweep' ? 'WITH' : 'SELECT'), `${name} starts with ${stmts[0].slice(0, 20)}`);
    }
  });

  it('holds no transaction statement', () => {
    for (const [name, file] of Object.entries(FILES)) {
      assert.doesNotMatch(withoutMetaCommands(read(file)), /^\s*(BEGIN|COMMIT|ROLLBACK)\b/im, `${name} issues a transaction statement`);
    }
  });

  it('references nt in the final SELECT', () => {
    const lines = read(SWEEP).split('\n');
    const at = lines.map((l) => l.startsWith('SELECT')).lastIndexOf(true);
    assert.notEqual(at, -1, 'sweep has no column-0 SELECT');
    assert.match(lines.slice(at).join('\n'), /FROM nt\b/, 'the final SELECT does not reference nt');
  });

  it('keeps the predicate block byte-identical in sweep and preview (D-6)', () => {
    const sweep = markerBlock(read(SWEEP), 'sweep');
    const preview = markerBlock(read(PREVIEW), 'preview');
    assert.ok(sweep.trim().length > 0, 'the marker block is empty');
    assert.ok(sweep === preview, 'sweep and preview predicate blocks differ');
  });

  it('matches only unreferenced, aged, per-user ingest mcp_credential secrets of the same owner', () => {
    const block = markerBlock(read(SWEEP), 'sweep');
    assert.ok(block.includes('v.updated_at'), 'grace must key on updated_at');
    assert.ok(!block.includes('created_at'), 'grace must not key on created_at');
    assert.ok(block.includes("GREATEST(:'grace_hours'::int, 1)"), 'missing the 1h grace floor');
    assert.ok(block.includes("starts_with(v.key, 'mcp_credential.')"), 'missing the literal prefix test');
    assert.doesNotMatch(block, /\bLIKE\b/i, 'LIKE treats _ as a wildcard');
    for (const part of [
      'v.is_secret',
      'v.user_id IS NOT NULL',
      "v.namespace = 'ingest'",
      'NOT EXISTS',
      's.user_id = v.user_id',
      "substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key",
    ]) {
      assert.ok(block.includes(part), `predicate is missing ${part}`);
    }
  });

  it('notifies once per namespace, environment and user with all CONFIG-4 fields (D-7)', () => {
    const sql = read(SWEEP);
    assert.ok(sql.includes('GROUP BY namespace, environment, user_id'), 'notify is not grouped per scope');
    assert.ok(!sql.includes('DISTINCT ON'), 'DISTINCT ON with an aggregate is invalid SQL');
    const at = sql.indexOf('json_build_object(');
    assert.notEqual(at, -1, 'no json_build_object payload');
    const payload = sql.slice(at, sql.indexOf('::text', at));
    for (const key of ["'namespace'", "'key'", "'environment'", "'user_id'"]) {
      assert.ok(payload.includes(key), `notify payload is missing ${key}`);
    }
  });

  it('audits as the sweep actor (D-4)', () => {
    assert.ok(read(SWEEP).includes("'system:config-heal-mcp-credential-sweep'"));
  });

  it('never names ciphertext, snapshots, latches or the 296 report table (D-3, O-23)', () => {
    for (const [name, file] of Object.entries(FILES)) {
      const sql = read(file);
      for (const token of ['value_encrypted', 'premigration', 'config_markers', 'config_keys_report_296']) {
        assert.ok(!sql.includes(token), `${name} contains ${token}`);
      }
    }
  });

  it('defaults grace_hours to 24 in its psql header', () => {
    for (const [name, file] of Object.entries(FILES)) {
      const lines = read(file).split('\n');
      assert.ok(lines.some((l) => l.startsWith('\\if :{?grace_hours}')), `${name} has no \\if :{?grace_hours} header`);
      assert.ok(lines.includes('\\set grace_hours 24'), `${name} has no \\set grace_hours 24 default`);
    }
  });
});
